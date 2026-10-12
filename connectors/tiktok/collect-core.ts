// Colectarea TikTok Ads: cost, afișări, clickuri și conversii pe zi și campanie, în paid_daily.
// Configurare: `tiktok_account` per client (conectat prin OAuth; tokenul în Vault) și `tiktok_ads` per brand
// (external_account_id = advertiser ID). La fiecare rulare tokenul se reînnoiește și se salvează (rotate_source_token).
// Contract: docs/contracts/tiktok-ads.md.

import { getSourceToken, loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { CallBudget, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { finishSyncRun, startSyncRun, type SyncRunError } from '../shared/sync-runs.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { isValidTimeZone, lookbackWindow } from '../google/dates.ts'
import { refreshTikTok, TikTokClient, type TtFailure } from './client.ts'
import { TIKTOK_CREDENTIAL_PROVIDER, TIKTOK_LOOKBACK_DAYS, TIKTOK_MAX_CALLS, TIKTOK_MAX_PAGES, TIKTOK_MAX_RANGE_DAYS, TIKTOK_PAGE_SIZE, TIKTOK_PROVIDER, TIKTOK_SOURCE } from './config.ts'
import { AdvertiserInfoSchema, ReportSchema, advertiserId, chunks, paidRow } from './normalize.ts'

export type TikTokEnv = { app?: { appId: string; secret: string } }
export type TikTokDeps = { db: Db; env: TikTokEnv; fetch?: FetchLike; sleep?: Sleep; now?: () => Date }
export type TikTokOutcome = {
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
const err = (f: TtFailure, dimension: string): SyncRunError => ({ code: f.kind, status: f.status, dimension, message: f.message })

export function tiktokEnvFrom(env: Record<string, string | undefined>): TikTokEnv {
  return env.TIKTOK_APP_ID && env.TIKTOK_APP_SECRET ? { app: { appId: env.TIKTOK_APP_ID, secret: env.TIKTOK_APP_SECRET } } : {}
}

export async function collectTikTok(deps: TikTokDeps): Promise<TikTokOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const fetchFn = deps.fetch ?? globalThis.fetch
  const credentials = await loadActiveConnections(db, TIKTOK_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))
  const connections = await db.select<BrandConnection>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${TIKTOK_PROVIDER}&status=eq.active`)

  const outcomes: TikTokOutcome[] = []
  const byTenant = new Map<string, Array<BrandConnection & { brand_id: string }>>()
  for (const c of connections) {
    if (c.provider !== TIKTOK_PROVIDER || c.status !== 'active') throw new Error(`Conexiunea ${c.id} nu corespunde filtrului; opresc rularea.`)
    const nc = (reason: string) => outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    if (!c.brand_id) nc('conexiune TikTok Ads fără brand')
    else if (!deps.env.app) nc('lipsesc TIKTOK_APP_ID / TIKTOK_APP_SECRET în mediul workerului')
    else if (!credentialByTenant.has(c.tenant_id)) nc('contul TikTok al clientului nu e conectat (sau a fost refuzat)')
    else {
      const list = byTenant.get(c.tenant_id) ?? []
      list.push({ ...c, brand_id: c.brand_id })
      byTenant.set(c.tenant_id, list)
    }
  }

  for (const [, list] of byTenant) {
    const credential = credentialByTenant.get(list[0]!.tenant_id)!
    const fail = (reason: string) => {
      for (const c of list) outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    }
    let stored: Record<string, unknown>
    try {
      stored = JSON.parse(await getSourceToken(db, credential.id)) as Record<string, unknown>
    } catch {
      stored = {}
    }
    let token = typeof stored.access_token === 'string' ? stored.access_token : null
    if (!token) {
      fail('credențialul TikTok stocat nu are forma așteptată; reconectează contul')
      continue
    }
    if (typeof stored.refresh_token === 'string') {
      const r = await refreshTikTok(fetchFn, deps.env.app!, stored.refresh_token)
      if (r.ok) {
        const kept = Object.fromEntries(Object.entries(r.data).filter(([k]) => /token|expire|advertiser_ids|scope/.test(k)))
        const next: Record<string, unknown> = { ...stored, ...kept, obtained_at: now().toISOString() }
        await db.rpc('rotate_source_token', { p_connection_id: credential.id, p_token: JSON.stringify(next) })
        token = String(next.access_token)
      } else {
        if (r.revoked) await db.rpc('record_source_validation', { p_connection_id: credential.id, p_ok: false, p_error: 'refresh refuzat' }).catch(() => undefined)
        fail(r.message)
        continue
      }
    }
    const client = new TikTokClient({ accessToken: token, budget: new CallBudget(TIKTOK_MAX_CALLS), fetch: deps.fetch, sleep: deps.sleep })
    for (const conn of list) {
      const before = client.budget.used
      try {
        outcomes.push(await runAdvertiser(deps, client, conn, now))
      } finally {
        await recordProviderCalls(db, { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay(now()), purpose: 'collect', calls: client.budget.used - before })
      }
    }
  }
  return outcomes
}

async function runAdvertiser(deps: TikTokDeps, client: TikTokClient, conn: BrandConnection & { brand_id: string }, now: () => Date): Promise<TikTokOutcome> {
  const { db } = deps
  assertUuid(conn.tenant_id, 'tenant_id')
  assertUuid(conn.brand_id, 'brand_id')
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
  const errors: SyncRunError[] = []
  const notes: string[] = []
  const id = advertiserId(conn.external_account_id)

  const infoRes = id ? await client.get('/advertiser/info/', { advertiser_ids: JSON.stringify([id]), fields: JSON.stringify(['name', 'currency', 'timezone', 'display_timezone']) }) : null
  const parsed = infoRes?.ok ? AdvertiserInfoSchema.safeParse(infoRes.data) : null
  const info = parsed?.success ? parsed.data.list[0]! : null
  const tzCandidate = info?.timezone ?? info?.display_timezone
  const tz = tzCandidate && isValidTimeZone(tzCandidate) ? tzCandidate : 'Europe/Bucharest'
  if (info && tz !== tzCandidate) notes.push(`fus orar TikTok necunoscut (${tzCandidate ?? 'lipsă'}); folosesc Europe/Bucharest`)
  const window = lookbackWindow(now(), tz, TIKTOK_LOOKBACK_DAYS)
  const handle = await startSyncRun(db, { ...scope, source: TIKTOK_SOURCE, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const done = async (status: 'succeeded' | 'partial' | 'failed', rows: number) => {
    for (const n of [...new Set(notes)]) errors.push({ code: 'parser_note', status: null, message: n })
    await finishSyncRun(db, handle, { status, rows_written: rows, attempt_count: 1, errors }, now)
    return { ...scope, connection_id: conn.id, status, sync_run_id: handle.id, rows_written: rows, errors }
  }

  try {
    if (!id) {
      errors.push({ code: 'invalid_account_id', status: null, message: `Advertiser ID invalid: ${conn.external_account_id}. Doar cifre.` })
      return await done('failed', 0)
    }
    if (infoRes && !infoRes.ok) {
      errors.push(err(infoRes, `advertiser:${id}`))
      return await done('failed', 0)
    }
    if (!info || !/^[A-Z]{3}$/.test(info.currency)) {
      errors.push({ code: 'invalid_payload', status: null, dimension: `advertiser:${id}`, message: 'Advertiserul nu are monedă citibilă.' })
      return await done('failed', 0)
    }

    const rows: Row[] = []
    const collectedAt = now().toISOString()
    outer: for (const part of chunks(window.start, window.end, TIKTOK_MAX_RANGE_DAYS)) {
      for (let page = 1; page <= TIKTOK_MAX_PAGES; page++) {
        const r = await client.get('/report/integrated/get/', {
          advertiser_id: id, report_type: 'BASIC', data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversion', 'campaign_name']),
          start_date: part.start, end_date: part.end, page, page_size: TIKTOK_PAGE_SIZE,
        })
        if (!r.ok) {
          errors.push(err(r, `report:${id}:${part.start}`))
          break outer
        }
        const p = ReportSchema.safeParse(r.data)
        if (!p.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: `report:${id}`, message: 'Forma raportului TikTok s-a schimbat.' })
          break outer
        }
        for (const row of p.data.list) rows.push(paidRow(row, { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, payload_hash: r.payloadHash, source_timezone: tz, currency: info.currency, account_id: id, account_name: info.name ?? null }, notes))
        if (page >= p.data.page_info.total_page) break
      }
    }
    const written = await upsertScoped(db, 'paid_daily', PAID_KEY, rows, scope)
    const real = errors.filter((e) => !e.code.startsWith('parser_'))
    return await done(real.length === 0 ? 'succeeded' : written > 0 ? 'partial' : 'failed', written)
  } catch (e) {
    errors.push({ code: 'exception', status: null, message: (e as Error).message })
    return await done('failed', 0)
  }
}
