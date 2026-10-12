// Colectarea Google Ads: cost, afișări, clickuri și conversii pe zi și campanie, în paid_daily.
// Configurare: `google_ads_account` per client (conectat prin OAuth; în Vault: refresh token + MCC) și `google_ads` per brand
// (external_account_id = customer ID). Secretele aplicației (OAuth client, developer token) vin din mediul workerului.
// Contract: docs/contracts/google-ads.md.

import { getSourceToken, loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { CallBudget, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { finishSyncRun, startSyncRun, type SyncRunError } from '../shared/sync-runs.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { isValidTimeZone, lookbackWindow } from '../google/dates.ts'
import { accessToken, GoogleAdsClient, type AdsFailure, type OAuthApp } from './client.ts'
import {
  CUSTOMER_QUERY,
  GOOGLE_ADS_CREDENTIAL_PROVIDER,
  GOOGLE_ADS_LOOKBACK_DAYS,
  GOOGLE_ADS_MAX_CALLS,
  GOOGLE_ADS_MAX_PAGES,
  GOOGLE_ADS_PROVIDER,
  GOOGLE_ADS_SOURCE,
  campaignQuery,
} from './config.ts'
import { CustomerSchema, SearchSchema, customerId, paidRow } from './normalize.ts'

export type GoogleAdsEnv = { oauth?: OAuthApp; developerToken?: string }
export type GoogleAdsDeps = { db: Db; env: GoogleAdsEnv; fetch?: FetchLike; sleep?: Sleep; now?: () => Date }

export type GoogleAdsOutcome = {
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
const err = (f: AdsFailure, dimension: string): SyncRunError => ({ code: f.kind, status: f.status, dimension, message: f.message })

export function googleAdsEnvFrom(env: Record<string, string | undefined>): GoogleAdsEnv {
  const id = env.GOOGLE_OAUTH_CLIENT_ID
  const secret = env.GOOGLE_OAUTH_CLIENT_SECRET
  return { oauth: id && secret ? { clientId: id, clientSecret: secret } : undefined, developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN || undefined }
}

export async function collectGoogleAds(deps: GoogleAdsDeps): Promise<GoogleAdsOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const fetchFn = deps.fetch ?? globalThis.fetch
  const credentials = await loadActiveConnections(db, GOOGLE_ADS_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))
  const connections = await db.select<BrandConnection>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${GOOGLE_ADS_PROVIDER}&status=eq.active`)

  const outcomes: GoogleAdsOutcome[] = []
  const byTenant = new Map<string, Array<BrandConnection & { brand_id: string }>>()
  const appMissing = !deps.env.oauth ? 'lipsesc GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET în mediul workerului' : !deps.env.developerToken ? 'lipsește GOOGLE_ADS_DEVELOPER_TOKEN în mediul workerului' : null
  for (const c of connections) {
    if (c.provider !== GOOGLE_ADS_PROVIDER || c.status !== 'active') throw new Error(`Conexiunea ${c.id} nu corespunde filtrului; opresc rularea.`)
    const nc = (reason: string) => outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    if (!c.brand_id) nc('conexiune Google Ads fără brand')
    else if (appMissing) nc(appMissing)
    else if (!credentialByTenant.has(c.tenant_id)) nc('contul Google Ads al clientului nu e conectat (sau a fost refuzat)')
    else {
      const list = byTenant.get(c.tenant_id) ?? []
      list.push({ ...c, brand_id: c.brand_id })
      byTenant.set(c.tenant_id, list)
    }
  }

  for (const [, list] of byTenant) {
    const credential = credentialByTenant.get(list[0]!.tenant_id)!
    let stored: { refresh_token?: unknown; login_customer_id?: unknown }
    try {
      stored = JSON.parse(await getSourceToken(db, credential.id)) as typeof stored
    } catch {
      stored = {}
    }
    const fail = (reason: string) => {
      for (const c of list) outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    }
    if (typeof stored.refresh_token !== 'string' || typeof stored.login_customer_id !== 'string') {
      fail('credențialul Google Ads stocat nu are forma așteptată; reconectează contul')
      continue
    }
    const at = await accessToken(fetchFn, deps.env.oauth!, stored.refresh_token)
    if (!at.ok) {
      if (at.revoked) await db.rpc('record_source_validation', { p_connection_id: credential.id, p_ok: false, p_error: 'invalid_grant' }).catch(() => undefined)
      fail(at.message)
      continue
    }
    const client = new GoogleAdsClient({ accessToken: at.token, developerToken: deps.env.developerToken!, loginCustomerId: stored.login_customer_id, budget: new CallBudget(GOOGLE_ADS_MAX_CALLS), fetch: deps.fetch, sleep: deps.sleep })
    for (const conn of list) {
      const before = client.budget.used
      try {
        outcomes.push(await runCustomer(deps, client, conn, now))
      } finally {
        await recordProviderCalls(db, { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay(now()), purpose: 'collect', calls: client.budget.used - before })
      }
    }
  }
  return outcomes
}

async function runCustomer(deps: GoogleAdsDeps, client: GoogleAdsClient, conn: BrandConnection & { brand_id: string }, now: () => Date): Promise<GoogleAdsOutcome> {
  const { db } = deps
  assertUuid(conn.tenant_id, 'tenant_id')
  assertUuid(conn.brand_id, 'brand_id')
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
  const errors: SyncRunError[] = []
  const notes: string[] = []
  const cid = customerId(conn.external_account_id)

  const customer = cid ? await client.search(cid, CUSTOMER_QUERY) : null
  const parsed = customer?.ok ? CustomerSchema.safeParse(customer.payload) : null
  const info = parsed?.success ? parsed.data.results[0]!.customer : null
  const tz = info && isValidTimeZone(info.timeZone) ? info.timeZone : 'Europe/Bucharest'
  const window = lookbackWindow(now(), tz, GOOGLE_ADS_LOOKBACK_DAYS)
  const handle = await startSyncRun(db, { ...scope, source: GOOGLE_ADS_SOURCE, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const done = async (status: 'succeeded' | 'partial' | 'failed', rows: number) => {
    const counted = new Map<string, number>()
    for (const n of notes) counted.set(n, (counted.get(n) ?? 0) + 1)
    for (const [n, c] of counted) errors.push({ code: 'parser_note', status: null, message: c > 1 ? `${n} (${c} rânduri)` : n })
    await finishSyncRun(db, handle, { status, rows_written: rows, attempt_count: 1, errors }, now)
    return { ...scope, connection_id: conn.id, status, sync_run_id: handle.id, rows_written: rows, errors }
  }

  try {
    if (!cid) {
      errors.push({ code: 'invalid_account_id', status: null, message: `Customer ID invalid: ${conn.external_account_id}. Forma așteptată: 123-456-7890.` })
      return await done('failed', 0)
    }
    if (customer && !customer.ok) {
      errors.push(err(customer, `customer:${cid}`))
      return await done('failed', 0)
    }
    if (!info || !/^[A-Z]{3}$/.test(info.currencyCode)) {
      errors.push({ code: 'invalid_payload', status: null, dimension: `customer:${cid}`, message: 'Contul nu are monedă sau fus orar citibile.' })
      return await done('failed', 0)
    }

    const rows: Row[] = []
    const collectedAt = now().toISOString()
    const query = campaignQuery(window.start, window.end)
    let pageToken: string | undefined
    for (let page = 0; page < GOOGLE_ADS_MAX_PAGES; page++) {
      const r = await client.search(cid, query, pageToken)
      if (!r.ok) {
        errors.push(err(r, `campaigns:${cid}`))
        break
      }
      const p = SearchSchema.safeParse(r.payload)
      if (!p.success) {
        errors.push({ code: 'invalid_payload', status: null, dimension: `campaigns:${cid}`, message: 'Forma răspunsului googleAds:search s-a schimbat.' })
        break
      }
      for (const row of p.data.results ?? []) {
        rows.push(paidRow(row, { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, payload_hash: r.payloadHash, source_timezone: tz, currency: info.currencyCode, account_id: cid, account_name: info.descriptiveName ?? null }, notes))
      }
      pageToken = p.data.nextPageToken || undefined
      if (!pageToken) break
      if (page === GOOGLE_ADS_MAX_PAGES - 1) errors.push({ code: 'pagination_stalled', status: null, message: `Paginarea nu s-a terminat după ${GOOGLE_ADS_MAX_PAGES} pagini.` })
    }
    const written = await upsertScoped(db, 'paid_daily', PAID_KEY, rows, scope)
    const real = errors.filter((e) => !e.code.startsWith('parser_'))
    return await done(real.length === 0 ? 'succeeded' : written > 0 ? 'partial' : 'failed', written)
  } catch (e) {
    errors.push({ code: 'exception', status: null, message: (e as Error).message })
    return await done('failed', 0)
  }
}
