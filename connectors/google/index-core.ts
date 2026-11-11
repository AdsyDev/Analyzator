// Indexare (Etapa 3, L): Search Console URL Inspection pentru URL-urile prioritare ale brandului și pentru paginile cu cele
// mai multe clickuri. Un apel pe URL; rezultatul se scrie în `index_inspections`, o dată pe zi și URL.
// Forma răspunsului e derivată din documentația API-ului (urlInspection.index.inspect), neconfirmată pe un cont real.
// Contract: docs/contracts/google.md, secțiunea „Indexare”.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { calendarDateInBucharest } from '../shared/dates.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunResult } from '../shared/sync-runs.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { createInspectionClient, type InspectionClientFactory } from './clients.ts'
import { loadCredentials } from './collect-core.ts'
import { GOOGLE_CREDENTIAL_PROVIDER, GSC_PROVIDER, RETRY_ATTEMPTS, RETRY_BASE_DELAY_MS } from './config.ts'
import { addDaysIso } from './dates.ts'
import { callWithRetry } from './errors.ts'
import { sha256 } from './normalize.ts'

export const INDEX_SOURCE = 'gsc_index'
export const INDEX_SCHEMA_VERSION = 'docs-2026-11-11'
/** Paginile cu cele mai multe clickuri din ultimele 28 de zile, pe lângă lista agenției. */
export const INDEX_TOP_PAGES = 50
export const INDEX_TOP_PAGES_DAYS = 28
/** Plafon pe brand și rulare. Cota Google: 2.000 de inspecții pe zi și 600 pe minut, pe proprietate. */
export const INDEX_MAX_URLS = 200
/** Pauza dintre apeluri: sub 600 pe minut, cu rezervă. */
export const INDEX_PAUSE_MS = 150
const KEY = ['tenant_id', 'brand_id', 'url_md5', 'inspected_on'] as const

const text = z.string().nullable().optional()
export const UrlInspectionSchema = z
  .object({
    inspectionResult: z
      .object({
        indexStatusResult: z
          .object({ verdict: text, coverageState: text, robotsTxtState: text, indexingState: text, pageFetchState: text, crawledAs: text, lastCrawlTime: text, googleCanonical: text, userCanonical: text })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough()

export type IndexDeps = { db: Db; createInspection?: InspectionClientFactory; now?: () => Date; sleep?: (ms: number) => Promise<void> }
export type IndexOutcome = {
  connection_id: string
  brand_id: string | null
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  reason?: string
  urls: number
  rows_written: number
  errors: SyncRunError[]
}

type BrandConnection = { id: string; tenant_id: string; brand_id: string | null; provider: string; external_account_id: string; status: string }
type Candidate = { url: string; origin: 'priority' | 'top_page' }

const md5 = (value: string) => createHash('md5').update(value).digest('hex')
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const cut = (v: string | null | undefined, max: number) => (typeof v === 'string' && v !== '' ? v.slice(0, max) : null)
const isHttpUrl = (u: string) => /^https?:\/\/\S+$/.test(u) && u.length <= 2048

/** URL-ul ține de proprietate? `sc-domain:` acoperă domeniul și subdomeniile; o proprietate URL-prefix, doar adresele de sub ea. */
export function urlInProperty(url: string, siteUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (siteUrl.startsWith('sc-domain:')) {
    const domain = siteUrl.slice('sc-domain:'.length).toLowerCase()
    const host = parsed.hostname.toLowerCase()
    return domain !== '' && (host === domain || host.endsWith(`.${domain}`))
  }
  return url.startsWith(siteUrl)
}

/** Timpul din răspuns ca ISO; o valoare care nu e o dată rămâne NULL, nu „acum”. */
function isoTime(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v === '') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export function inspectionRow(payload: z.infer<typeof UrlInspectionSchema>, c: Candidate, ctx: { tenant_id: string; brand_id: string; source_id: string; sync_run_id: string; inspected_on: string; collected_at: string }): Row {
  const r = payload.inspectionResult.indexStatusResult ?? {}
  return {
    tenant_id: ctx.tenant_id, brand_id: ctx.brand_id, url: c.url, url_md5: md5(c.url), inspected_on: ctx.inspected_on, origin: c.origin,
    verdict: cut(r.verdict, 64), coverage_state: cut(r.coverageState, 512), indexing_state: cut(r.indexingState, 64),
    robots_txt_state: cut(r.robotsTxtState, 64), page_fetch_state: cut(r.pageFetchState, 64), crawled_as: cut(r.crawledAs, 64),
    last_crawl_time: isoTime(r.lastCrawlTime), google_canonical: cut(r.googleCanonical, 2048), user_canonical: cut(r.userCanonical, 2048),
    source_id: ctx.source_id, sync_run_id: ctx.sync_run_id, collected_at: ctx.collected_at, payload_hash: sha256(payload), schema_version: INDEX_SCHEMA_VERSION,
  }
}

/** Lista de inspectat: întâi URL-urile agenției, apoi paginile cu cele mai multe clickuri, fără dubluri, până la plafon. */
export async function candidateUrls(db: Db, conn: { tenant_id: string; brand_id: string }, today: string): Promise<Candidate[]> {
  const scope = `tenant_id=eq.${conn.tenant_id}&brand_id=eq.${conn.brand_id}`
  const priority = await db.select<{ tenant_id: string; brand_id: string; url: string }>('index_urls', `select=tenant_id,brand_id,url&${scope}&order=url.asc&limit=${INDEX_MAX_URLS}`)
  const pages = await db.select<{ tenant_id: string; brand_id: string; page: string; clicks: number | string | null }>(
    'search_queries',
    `select=tenant_id,brand_id,page,clicks&${scope}&date=gte.${addDaysIso(today, -INDEX_TOP_PAGES_DAYS)}&order=clicks.desc.nullslast&limit=5000`,
  )
  // Serviciul ocolește RLS: fiecare rând citit e verificat din nou pe client și brand.
  for (const r of [...priority, ...pages]) if (r.tenant_id !== conn.tenant_id || r.brand_id !== conn.brand_id) throw new Error('Rând citit pentru alt client sau alt brand; opresc rularea.')

  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (url: string, origin: Candidate['origin']) => {
    if (!isHttpUrl(url) || seen.has(url) || out.length >= INDEX_MAX_URLS) return
    seen.add(url)
    out.push({ url, origin })
  }
  for (const p of [...priority].sort((a, b) => a.url.localeCompare(b.url))) add(p.url, 'priority')
  const clicks = new Map<string, number>()
  for (const p of pages) clicks.set(p.page, (clicks.get(p.page) ?? 0) + (Number(p.clicks) || 0))
  const top = [...clicks.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, INDEX_TOP_PAGES)
  for (const [page] of top) add(page, 'top_page')
  return out
}

/** Punctul de intrare: toate conexiunile Search Console active (sau doar brandul cerut). */
export async function collectIndex(deps: IndexDeps, options: { brandId?: string } = {}): Promise<IndexOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  if (options.brandId !== undefined) assertUuid(options.brandId, 'brand_id')
  const brandFilter = options.brandId ? `&brand_id=eq.${options.brandId}` : ''

  const credentials = await loadActiveConnections(db, GOOGLE_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))
  const connections = await db.select<BrandConnection>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${GSC_PROVIDER}&status=eq.active${brandFilter}`)

  const outcomes: IndexOutcome[] = []
  for (const conn of connections) {
    if (conn.provider !== GSC_PROVIDER || conn.status !== 'active') throw new Error(`Conexiunea ${conn.id} nu corespunde filtrului; opresc rularea.`)
    if (options.brandId && conn.brand_id !== options.brandId) throw new Error(`Conexiunea ${conn.id} nu e a brandului cerut; opresc rularea.`)
    const skip = (reason: string) => outcomes.push({ connection_id: conn.id, brand_id: conn.brand_id, status: 'not_connected', reason, urls: 0, rows_written: 0, errors: [] })
    if (!conn.brand_id) {
      skip('conexiune fără brand')
      continue
    }
    const credential = credentialByTenant.get(conn.tenant_id)
    if (!credential) {
      skip('credential Google neconfigurat sau invalid pentru acest client')
      continue
    }
    outcomes.push(await runIndex(deps, { ...conn, brand_id: conn.brand_id }, credential.id, now))
  }
  return outcomes
}

async function runIndex(deps: IndexDeps, conn: BrandConnection & { brand_id: string }, credentialConnectionId: string, now: () => Date): Promise<IndexOutcome> {
  const { db } = deps
  const sleep = deps.sleep ?? defaultSleep
  const today = calendarDateInBucharest(now())
  const siteUrl = conn.external_account_id.trim()
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
  const candidates = await candidateUrls(db, scope, today)
  // Fără nimic de inspectat nu se deschide o rulare: nu e un eșec și nu e o inspecție.
  if (candidates.length === 0) {
    return { connection_id: conn.id, brand_id: conn.brand_id, status: 'not_connected', reason: 'niciun URL de inspectat: lista prioritară e goală și nu există pagini cu clickuri în ultimele 28 de zile', urls: 0, rows_written: 0, errors: [] }
  }

  const handle = await startSyncRun(db, { ...scope, source: INDEX_SOURCE, source_connection_id: conn.id, period_start: today, period_end: today }, now)
  const errors: SyncRunError[] = []
  const rows: Row[] = []
  let calls = 0
  let fatal = false
  let written = 0
  try {
    const credentials = await loadCredentials(db, credentialConnectionId)
    if (!credentials.ok) {
      errors.push({ code: credentials.code, status: null, message: credentials.message })
      fatal = true
    } else {
      const client = (deps.createInspection ?? createInspectionClient)(credentials.value)
      for (const c of candidates) {
        if (!urlInProperty(c.url, siteUrl)) {
          errors.push({ code: 'url_outside_property', status: null, dimension: c.url, message: `URL-ul nu ține de proprietatea ${siteUrl}; nu a fost inspectat.` })
          continue
        }
        if (calls > 0) await sleep(INDEX_PAUSE_MS)
        const res = await callWithRetry(() => client.inspect({ siteUrl, inspectionUrl: c.url, languageCode: 'ro' }), { sleep, attempts: RETRY_ATTEMPTS, baseDelayMs: RETRY_BASE_DELAY_MS })
        calls += res.attempts
        if (!res.ok) {
          const status = typeof res.failure.code === 'number' ? res.failure.code : null
          if (res.failure.kind === 'bad_request') {
            // Un URL refuzat nu oprește restul listei.
            errors.push({ code: 'inspection_rejected', status, dimension: c.url, message: res.failure.message })
            continue
          }
          // Accesul refuzat, cota epuizată sau o cădere s-ar repeta la fiecare URL: rularea se oprește aici, cu ce s-a adunat.
          errors.push({ code: res.failure.kind, status, dimension: c.url, message: res.failure.message })
          fatal = res.failure.kind === 'access_denied'
          break
        }
        const parsed = UrlInspectionSchema.safeParse(res.value)
        if (!parsed.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: c.url, message: 'Forma răspunsului URL Inspection s-a schimbat.' })
          continue
        }
        rows.push(inspectionRow(parsed.data, c, { ...scope, source_id: conn.id, sync_run_id: handle.id, inspected_on: today, collected_at: now().toISOString() }))
      }
      written = await upsertScoped(db, 'index_inspections', KEY, rows, scope)
    }
  } catch (err) {
    fatal = true
    errors.push({ code: 'exception', status: null, message: (err as Error).message })
  }

  try {
    await recordProviderCalls(db, { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay(now()), purpose: 'collect', calls, sync_run_id: handle.id })
  } catch (err) {
    errors.push({ code: 'call_count_not_recorded', status: null, message: (err as Error).message })
  }

  const real = errors.filter((e) => e.code !== 'call_count_not_recorded')
  const status: SyncRunResult['status'] = (fatal && written === 0) || (real.length > 0 && written === 0) ? 'failed' : real.length > 0 ? 'partial' : 'succeeded'
  await finishSyncRun(db, handle, { status, rows_written: written, attempt_count: 1, errors }, now)
  return { connection_id: conn.id, brand_id: conn.brand_id, status, urls: candidates.length, rows_written: written, errors }
}
