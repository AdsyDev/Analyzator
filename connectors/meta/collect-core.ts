// Colectarea Meta Ads (Marketing API): cost, afișări și clickuri pe zi, la nivel de reclamă, în paid_daily.
// Configurare: `meta_account` per client (tokenul system user în Vault) și `meta_ads` per brand
// (external_account_id = contul de ads, `act_…`). Contract: docs/contracts/meta-ads.md.
// Fără token (lipsă sau invalid) conexiunile brandurilor raportează `not_connected`: fără sync_run, fără cereri.

import { getSourceToken, loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { CallBudget, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { finishSyncRun, startSyncRun, type SyncRunError } from '../shared/sync-runs.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { isValidTimeZone, lookbackWindow } from '../google/dates.ts'
import { MetaClient, type MetaFailure } from './client.ts'
import { INSIGHT_FIELDS, META_CREDENTIAL_PROVIDER, META_LOOKBACK_DAYS, META_MAX_CALLS, META_MAX_PAGES, META_PAGE_SIZE, META_PROVIDER, META_SOURCE } from './config.ts'
import { AccountSchema, InsightsSchema, accountNumber, paidRow } from './normalize.ts'

export type MetaDeps = { db: Db; fetch?: FetchLike; sleep?: Sleep; now?: () => Date }

export type MetaOutcome = {
  tenant_id: string
  brand_id: string | null
  connection_id: string
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  sync_run_id: string | null
  rows_written: number
  errors: SyncRunError[]
  reason?: string
}

export const PAID_KEY = ['tenant_id', 'brand_id', 'source', 'account_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date', 'breakdown_signature', 'attribution_config'] as const

type BrandConnection = { id: string; tenant_id: string; brand_id: string | null; provider: string; external_account_id: string; status: string }

const err = (f: MetaFailure, dimension: string): SyncRunError => ({ code: f.kind, status: f.status, dimension, message: f.message })

export async function collectMeta(deps: MetaDeps): Promise<MetaOutcome[]> {
  const { db } = deps
  const credentials = await loadActiveConnections(db, META_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))
  const skippedReason = new Map<string, string>()
  if (credentials.skipped.length) {
    const rows = await db.select<{ id: string; tenant_id: string }>('source_connections', `select=id,tenant_id&provider=eq.${META_CREDENTIAL_PROVIDER}&status=eq.active`)
    for (const s of credentials.skipped) {
      const row = rows.find((r) => r.id === s.id)
      if (row) skippedReason.set(row.tenant_id, `token Meta ${s.reason}`)
    }
  }

  const connections = await db.select<BrandConnection>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${META_PROVIDER}&status=eq.active`)
  const outcomes: MetaOutcome[] = []
  const byTenant = new Map<string, Array<BrandConnection & { brand_id: string }>>()
  for (const c of connections) {
    if (c.provider !== META_PROVIDER || c.status !== 'active') throw new Error(`Conexiunea ${c.id} nu corespunde filtrului; opresc rularea.`)
    const nc = (reason: string) => outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    if (!c.brand_id) nc('conexiune Meta Ads fără brand')
    else if (!credentialByTenant.has(c.tenant_id)) nc(skippedReason.get(c.tenant_id) ?? 'token Meta neconfigurat pentru acest client')
    else {
      const list = byTenant.get(c.tenant_id) ?? []
      list.push({ ...c, brand_id: c.brand_id })
      byTenant.set(c.tenant_id, list)
    }
  }

  for (const [, list] of byTenant) {
    const credential = credentialByTenant.get(list[0]!.tenant_id)!
    const token = await getSourceToken(db, credential.id)
    const client = new MetaClient({ token, budget: new CallBudget(META_MAX_CALLS), fetch: deps.fetch, sleep: deps.sleep })
    let tokenOk: boolean | null = null
    for (const [i, conn] of list.entries()) {
      const before = client.budget.used
      try {
        const o = await runAccount(deps, client, conn)
        if (o.errors.some((e) => e.code === 'access_denied')) tokenOk = false
        else if (o.status !== 'failed' && tokenOk === null) tokenOk = true
        outcomes.push(o)
      } finally {
        await recordProviderCalls(db, { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay((deps.now ?? (() => new Date()))()), purpose: 'collect', calls: client.budget.used - before })
      }
      // Un token refuzat nu mai e încercat pe celelalte conturi ale clientului: ele raportează motivul, fără cereri.
      if (tokenOk === false) {
        for (const rest of list.slice(i + 1)) {
          outcomes.push({ tenant_id: rest.tenant_id, brand_id: rest.brand_id, connection_id: rest.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason: 'token Meta refuzat la această rulare' })
        }
        break
      }
    }
    if (tokenOk !== null) {
      await db.rpc('record_source_validation', { p_connection_id: credential.id, p_ok: tokenOk, ...(tokenOk ? {} : { p_error: 'token Meta refuzat' }) }).catch(() => undefined)
    }
  }
  return outcomes
}

async function runAccount(deps: MetaDeps, client: MetaClient, conn: BrandConnection & { brand_id: string }): Promise<MetaOutcome> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  assertUuid(conn.tenant_id, 'tenant_id')
  assertUuid(conn.brand_id, 'brand_id')
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
  const errors: SyncRunError[] = []
  const notes: string[] = []
  const number = accountNumber(conn.external_account_id)

  // Contul întâi: moneda și fusul orar (datele zilnice sunt în fusul contului).
  const account = number ? await client.get(client.url(`/act_${number}`, { fields: 'id,name,currency,timezone_name' })) : null
  const parsedAccount = account?.ok ? AccountSchema.safeParse(account.payload) : null
  const tz = parsedAccount?.success && isValidTimeZone(parsedAccount.data.timezone_name) ? parsedAccount.data.timezone_name : 'Europe/Bucharest'
  const window = lookbackWindow(now(), tz, META_LOOKBACK_DAYS)
  const handle = await startSyncRun(db, { ...scope, source: META_SOURCE, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const done = async (status: MetaOutcome['status'] & ('succeeded' | 'partial' | 'failed'), rows: number) => {
    for (const n of [...new Set(notes)]) errors.push({ code: 'parser_note', status: null, message: n })
    await finishSyncRun(db, handle, { status, rows_written: rows, attempt_count: 1, errors }, now)
    return { ...scope, connection_id: conn.id, status, sync_run_id: handle.id, rows_written: rows, errors }
  }

  try {
    if (!number) {
      errors.push({ code: 'invalid_account_id', status: null, message: `ID de cont invalid: ${conn.external_account_id}. Forma așteptată: act_1234567890.` })
      return await done('failed', 0)
    }
    if (account && !account.ok) {
      errors.push(err(account, `account:act_${number}`))
      return await done('failed', 0)
    }
    if (!parsedAccount?.success || !/^[A-Z]{3}$/.test(parsedAccount.data.currency)) {
      errors.push({ code: 'invalid_payload', status: null, dimension: `account:act_${number}`, message: 'Contul nu are monedă sau fus orar citibile.' })
      return await done('failed', 0)
    }
    const currency = parsedAccount.data.currency

    const rows: Row[] = []
    let url: string | null = client.url(`/act_${number}/insights`, {
      level: 'ad', time_increment: 1, time_range: JSON.stringify({ since: window.start, until: window.end }),
      fields: INSIGHT_FIELDS.join(','), limit: META_PAGE_SIZE,
    })
    const collectedAt = now().toISOString()
    for (let page = 0; url && page < META_MAX_PAGES; page++) {
      const r = await client.get(url)
      if (!r.ok) {
        errors.push(err(r, `insights:act_${number}`))
        break
      }
      const parsed = InsightsSchema.safeParse(r.payload)
      if (!parsed.success) {
        errors.push({ code: 'invalid_payload', status: null, dimension: `insights:act_${number}`, message: 'Forma răspunsului /insights s-a schimbat.' })
        break
      }
      for (const row of parsed.data.data) {
        if (row.account_id !== number) throw new Error(`Raportul conține alt cont (${row.account_id}); opresc rularea.`)
        rows.push(paidRow(row, { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, payload_hash: r.payloadHash, source_timezone: tz, currency }, notes))
      }
      url = parsed.data.paging?.next ? MetaClient.cleanNext(parsed.data.paging.next) : null
      if (url && page === META_MAX_PAGES - 1) errors.push({ code: 'pagination_stalled', status: null, message: `Paginarea nu s-a terminat după ${META_MAX_PAGES} pagini.` })
    }
    const written = await upsertScoped(db, 'paid_daily', PAID_KEY, rows, scope)
    const real = errors.filter((e) => !e.code.startsWith('parser_'))
    return await done(real.length === 0 ? 'succeeded' : written > 0 ? 'partial' : 'failed', written)
  } catch (e) {
    errors.push({ code: 'exception', status: null, message: (e as Error).message })
    return await done('failed', 0)
  }
}
