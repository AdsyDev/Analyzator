// Colectarea GA4 și Search Console. Contract: docs/contracts/google.md.
//
// Configurare (source_connections):
//   google_service_account  · brand_id NULL · un JSON de service account per tenant, în Vault
//   ga4                     · per brand · external_account_id = property ID · timezone = fusul proprietății
//   gsc                     · per brand · external_account_id = site_url
// Fără credential configurat (sau invalid), conexiunile ga4/gsc ale tenantului raportează `not_connected`: nicio
// excepție, niciun sync_run, nicio cerere.
//
// Fluxul unei conexiuni: sync_run → token din Vault → checkCompatibility înainte de fiecare runReport →
// pagini → normalizare → upsert idempotent → reconciliere → acoperire → sync_run închis (niciodată `succeeded`
// dacă există erori sau acoperire incompletă).

import { getSourceToken, loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunResult } from '../shared/sync-runs.ts'
import type { Db, Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import {
  GA4_MAX_PAGES,
  GA4_PAGE_SIZE,
  GOOGLE_CREDENTIAL_PROVIDER,
  GOOGLE_LOOKBACK_DAYS,
  GOOGLE_SCHEMA_VERSION,
  GSC_DATA_STATE,
  GSC_MAX_PAGES,
  GSC_ROW_LIMIT,
  GSC_TIMEZONE,
  RECONCILE_TOLERANCE_PCT,
  RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
} from './config.ts'
import { createGoogleClients, type ClientFactory, type Ga4Client, type GscClient } from './clients.ts'
import { calendarDateIn, isValidTimeZone, lookbackWindow } from './dates.ts'
import { callWithRetry } from './errors.ts'
import { activeUsersIntervals } from './intervals.ts'
import {
  normalizeGa4ActiveUsers,
  normalizeGa4Daily,
  normalizeGa4KeyEvents,
  normalizeGscDaily,
  normalizeGscQueries,
  parseGa4Totals,
  parseGscDateTotals,
  sha256,
  type Ctx,
  type Issue,
} from './normalize.ts'
import { reconcileTotals, type ReconcileResult } from './reconcile.ts'
import { Ga4ReportSchema, GscResponseSchema, ServiceAccountSchema, type ServiceAccount } from './schemas.ts'

export type GoogleSource = 'ga4' | 'gsc'

export type GoogleDeps = {
  db: Db
  createClients?: ClientFactory
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  ga4PageSize?: number
  gscRowLimit?: number
  gscMaxPages?: number
}

export type GoogleOutcome =
  | { source: GoogleSource; connection_id: string; brand_id: string | null; status: 'not_connected'; reason: string }
  | {
      source: GoogleSource
      connection_id: string
      brand_id: string
      status: 'succeeded' | 'partial' | 'failed'
      sync_run_id: string
      rows_written: number
      api_calls: number
      errors: SyncRunError[]
      coverage: NonNullable<SyncRunResult['coverage']>
      reconciliations: Array<{ metric: string } & ReconcileResult>
    }

type BrandConnection = {
  id: string
  tenant_id: string
  brand_id: string | null
  provider: string
  external_account_id: string
  timezone: string
  status: string
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const KEYS = {
  web_daily: ['tenant_id', 'brand_id', 'date', 'channel_group', 'source_medium', 'landing_page_md5'],
  web_key_events: ['tenant_id', 'brand_id', 'date', 'event_name'],
  web_active_users_interval: ['tenant_id', 'brand_id', 'interval_start', 'interval_end'],
  search_daily: ['tenant_id', 'brand_id', 'date', 'device'],
  search_queries: ['tenant_id', 'brand_id', 'date', 'device', 'query_md5', 'page_md5'],
  source_reconciliations: ['tenant_id', 'brand_id', 'source', 'metric', 'period_start', 'period_end', 'property_ref'],
} as const

/** Punctul de intrare: colectează toate conexiunile ga4/gsc active (sau doar una dintre surse). */
export async function collectGoogle(deps: GoogleDeps, only?: GoogleSource): Promise<GoogleOutcome[]> {
  const { db } = deps
  const credentials = await loadActiveConnections(db, GOOGLE_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))

  // Tenanții cu credential configurat dar marcat lipsă/invalid: motivul se raportează pe fiecare conexiune.
  const credentialSkipReason = new Map<string, string>()
  const skippedRows = credentials.skipped.length
    ? await db.select<{ id: string; tenant_id: string }>('source_connections', `select=id,tenant_id&provider=eq.${GOOGLE_CREDENTIAL_PROVIDER}&status=eq.active`)
    : []
  for (const s of credentials.skipped) {
    const row = skippedRows.find((r) => r.id === s.id)
    if (row) credentialSkipReason.set(row.tenant_id, `credential Google ${s.reason}`)
  }

  const outcomes: GoogleOutcome[] = []
  for (const source of (only ? [only] : ['ga4', 'gsc']) as GoogleSource[]) {
    const connections = await db.select<BrandConnection>(
      'source_connections',
      `select=id,tenant_id,brand_id,provider,external_account_id,timezone,status&provider=eq.${source}&status=eq.active`,
    )
    for (const conn of connections) {
      if (conn.provider !== source || conn.status !== 'active') throw new Error(`Conexiunea ${conn.id} nu corespunde filtrului; opresc rularea.`)
      if (!conn.brand_id) {
        outcomes.push({ source, connection_id: conn.id, brand_id: null, status: 'not_connected', reason: 'conexiune fără brand' })
        continue
      }
      const credential = credentialByTenant.get(conn.tenant_id)
      if (!credential) {
        outcomes.push({
          source, connection_id: conn.id, brand_id: conn.brand_id, status: 'not_connected',
          reason: credentialSkipReason.get(conn.tenant_id) ?? 'credential Google neconfigurat pentru acest client',
        })
        continue
      }
      outcomes.push(await runConnection(deps, { ...conn, brand_id: conn.brand_id }, credential.id))
    }
  }
  return outcomes
}

// --------------------------------------------------------------------------------------------------------------------

type RunState = {
  errors: SyncRunError[]
  coverage: NonNullable<SyncRunResult['coverage']>
  rowsWritten: number
  calls: number
  fatal: boolean
  reconciliations: Array<{ metric: string } & ReconcileResult>
}

async function runConnection(deps: GoogleDeps, conn: BrandConnection & { brand_id: string }, credentialConnectionId: string): Promise<GoogleOutcome> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const source = conn.provider as GoogleSource
  const timezone = source === 'gsc' ? GSC_TIMEZONE : conn.timezone
  const state: RunState = { errors: [], coverage: {}, rowsWritten: 0, calls: 0, fatal: false, reconciliations: [] }
  const fail = (code: string, message: string, extra: Partial<SyncRunError> = {}) => state.errors.push({ code, status: null, message, ...extra })

  const window = isValidTimeZone(timezone) ? lookbackWindow(now(), timezone, GOOGLE_LOOKBACK_DAYS) : lookbackWindow(now(), GSC_TIMEZONE, GOOGLE_LOOKBACK_DAYS)
  const handle = await startSyncRun(
    db,
    { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source, source_connection_id: conn.id, period_start: window.start, period_end: window.end },
    now,
  )

  try {
    if (!isValidTimeZone(timezone)) {
      fail('invalid_timezone', `timezone invalid pe conexiune: ${timezone}`)
      state.fatal = true
    } else {
      const credentials = await loadCredentials(db, credentialConnectionId)
      if (!credentials.ok) {
        fail(credentials.code, credentials.message)
        state.fatal = true
      } else {
        const clients = (deps.createClients ?? createGoogleClients)(credentials.value)
        const ctxBase = { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_id: conn.id, sync_run_id: handle.id, schema_version: GOOGLE_SCHEMA_VERSION }
        if (source === 'ga4') await collectGa4(deps, clients.ga4, conn, ctxBase, window, state, now)
        else await collectGsc(deps, clients.gsc, conn, ctxBase, window, state, now)
      }
    }
  } catch (err) {
    state.fatal = true
    fail('exception', (err as Error).message)
  }

  // Apelurile către API se contorizează oricum (observabilitate; Google nu impune un buget zilnic de apeluri ca Clarity).
  try {
    await recordProviderCalls(db, {
      tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay(now()),
      purpose: 'collect', calls: state.calls, sync_run_id: handle.id,
    })
  } catch (err) {
    fail('call_count_not_recorded', (err as Error).message)
  }

  const incomplete = Object.values(state.coverage).some((c) => c.coverage < 1)
  const status: SyncRunResult['status'] =
    state.fatal || (state.rowsWritten === 0 && state.errors.length > 0 && !state.errors.every((e) => e.code === 'empty_report'))
      ? 'failed'
      : state.errors.length > 0 || incomplete || state.rowsWritten === 0
        ? 'partial'
        : 'succeeded'
  if (state.rowsWritten === 0 && !state.fatal && !state.errors.some((e) => e.code === 'empty_report')) {
    fail('empty_report', 'niciun rând primit de la sursă în fereastra de reimport')
  }
  await finishSyncRun(db, handle, { status, rows_written: state.rowsWritten, attempt_count: state.calls, errors: state.errors, coverage: state.coverage }, now)
  return {
    source, connection_id: conn.id, brand_id: conn.brand_id, status, sync_run_id: handle.id, rows_written: state.rowsWritten,
    api_calls: state.calls, errors: state.errors, coverage: state.coverage, reconciliations: state.reconciliations,
  }
}

async function loadCredentials(db: Db, credentialConnectionId: string): Promise<{ ok: true; value: ServiceAccount } | { ok: false; code: string; message: string }> {
  let raw: string
  try {
    raw = await getSourceToken(db, credentialConnectionId)
  } catch (err) {
    return { ok: false, code: 'token_unavailable', message: (err as Error).message }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'credential_invalid_json', message: 'credentialul Google nu este JSON valid' }
  }
  const parsed = ServiceAccountSchema.safeParse(json)
  // Mesajul nu include valorile (cheia privată).
  if (!parsed.success) return { ok: false, code: 'credential_invalid', message: `service account JSON invalid (câmpuri: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')})` }
  return { ok: true, value: parsed.data }
}

function mkCtx(base: Omit<Ctx, 'collected_at' | 'payload_hash' | 'source_timezone'>, now: () => Date, hash: string, tz: string): Ctx {
  return { ...base, collected_at: now().toISOString(), payload_hash: hash, source_timezone: tz }
}

function noteIssues(state: RunState, label: string, issues: Issue[]): void {
  // Un singur rând de eroare per cod și raport, cu numărătoare (nu câte unul per rând respins).
  const counts = new Map<string, { n: number; sample: string }>()
  for (const i of issues) {
    const c = counts.get(i.code)
    if (c) c.n++
    else counts.set(i.code, { n: 1, sample: i.message })
  }
  for (const [code, { n, sample }] of counts) {
    state.errors.push({ code: `normalize_${code}`, dimension: label, status: null, message: `${n}× ${sample}` })
  }
}

// --- GA4 ------------------------------------------------------------------------------------------------------------

type Ga4ReportSpec = { name: string; dimensions: string[]; metrics: string[]; interval?: { start: string; end: string } }

const GA4_DAILY: Ga4ReportSpec = {
  name: 'web_daily',
  dimensions: ['date', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'landingPagePlusQueryString'],
  metrics: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'],
}
const GA4_KEY_EVENTS: Ga4ReportSpec = { name: 'web_key_events', dimensions: ['date', 'eventName'], metrics: ['keyEvents'] }
const GA4_TOTALS: Ga4ReportSpec = { name: 'interval_totals', dimensions: [], metrics: ['sessions', 'engagedSessions', 'keyEvents'] }

export function ga4PropertyName(externalAccountId: string): string | null {
  const m = /^(?:properties\/)?(\d+)$/.exec(externalAccountId.trim())
  return m ? `properties/${m[1]}` : null
}

async function collectGa4(
  deps: GoogleDeps,
  client: Ga4Client,
  conn: BrandConnection & { brand_id: string },
  base: Omit<Ctx, 'collected_at' | 'payload_hash' | 'source_timezone'>,
  window: { start: string; end: string },
  state: RunState,
  now: () => Date,
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep
  const retry = { sleep, attempts: RETRY_ATTEMPTS, baseDelayMs: RETRY_BASE_DELAY_MS }
  const pageSize = deps.ga4PageSize ?? GA4_PAGE_SIZE
  const property = ga4PropertyName(conn.external_account_id)
  const fail = (code: string, message: string, extra: Partial<SyncRunError> = {}) => state.errors.push({ code, status: null, message, ...extra })
  if (!property) {
    fail('invalid_property_id', `property ID invalid: ${JSON.stringify(conn.external_account_id)} (așteptat numeric)`)
    state.fatal = true
    return
  }
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
  const compat = new Map<string, Awaited<ReturnType<Ga4Client['checkCompatibility']>> | 'failed'>()

  /** checkCompatibility înainte de runReport; combinațiile incompatibile ajung în sync_runs.errors. */
  const prepare = async (spec: Ga4ReportSpec): Promise<{ dimensions: string[]; metrics: string[] } | null> => {
    const key = `${spec.dimensions.join(',')}|${spec.metrics.join(',')}`
    let result = compat.get(key)
    if (!result) {
      const r = await callWithRetry(() => client.checkCompatibility({ property, dimensions: spec.dimensions, metrics: spec.metrics }), retry)
      state.calls += r.attempts
      if (!r.ok) {
        result = 'failed'
        fail('compatibility_check_failed', `${spec.name}: ${r.failure.message}`, { dimension: spec.name, status: typeof r.failure.code === 'number' ? r.failure.code : null })
        if (r.failure.kind === 'access_denied') {
          state.fatal = true
          fail('access_denied', 'contul de serviciu nu are acces la această proprietate GA4', { dimension: spec.name })
        }
      } else {
        result = r.value
      }
      compat.set(key, result)
    }
    if (result === 'failed') return null
    if (result.incompatibleDimensions.length) {
      fail('ga4_incompatible_dimensions', `${spec.name}: dimensiuni incompatibile (${result.incompatibleDimensions.join(', ')}); raport sărit`, { dimension: spec.name })
      return null
    }
    const metrics = spec.metrics.filter((m) => !result.incompatibleMetrics.includes(m))
    if (result.incompatibleMetrics.length) {
      fail('ga4_incompatible_metrics', `${spec.name}: metrici incompatibile cu dimensiunile (${result.incompatibleMetrics.join(', ')}); rămân NULL`, { dimension: spec.name })
    }
    if (metrics.length === 0) return null
    return { dimensions: spec.dimensions, metrics }
  }

  /** Toate paginile unui raport; întoarce răspunsurile validate (cu hash-ul paginii brute). */
  const fetchReport = async (spec: Ga4ReportSpec, effective: { dimensions: string[]; metrics: string[] }, range: { start: string; end: string }) => {
    const pages: Array<{ report: ReturnType<typeof Ga4ReportSchema.parse>; hash: string }> = []
    let offset = 0
    for (let page = 0; page < GA4_MAX_PAGES; page++) {
      const r = await callWithRetry(
        () => client.runReport({ property, ...effective, startDate: range.start, endDate: range.end, limit: pageSize, offset }),
        retry,
      )
      state.calls += r.attempts
      if (!r.ok) {
        fail(r.failure.kind, `${spec.name}: ${r.failure.message}`, { dimension: spec.name, status: typeof r.failure.code === 'number' ? r.failure.code : null })
        if (r.failure.kind === 'access_denied') {
          state.fatal = true
          fail('access_denied', 'contul de serviciu nu are acces la această proprietate GA4', { dimension: spec.name })
        }
        return { pages, complete: false }
      }
      const parsed = Ga4ReportSchema.safeParse(r.value)
      if (!parsed.success) {
        fail('invalid_payload', `${spec.name}: răspuns runReport invalid`, { dimension: spec.name })
        return { pages, complete: false }
      }
      pages.push({ report: parsed.data, hash: sha256(r.value) })
      const fetched = offset + (parsed.data.rows?.length ?? 0)
      const total = parsed.data.rowCount ?? fetched
      if (fetched >= total || (parsed.data.rows?.length ?? 0) === 0) return { pages, complete: true }
      offset = fetched
    }
    fail('ga4_too_many_pages', `${spec.name}: peste ${GA4_MAX_PAGES} pagini; raport trunchiat`, { dimension: spec.name })
    return { pages, complete: false }
  }

  const checkMetadata = (spec: Ga4ReportSpec, report: ReturnType<typeof Ga4ReportSchema.parse>): string => {
    const md = report.metadata
    if (md?.dataLossFromOtherRow) fail('ga4_data_loss_other_row', `${spec.name}: GA4 a grupat rânduri în „(other)” (cardinalitate mare); datele sunt incomplete`, { dimension: spec.name })
    if (md?.samplingMetadatas?.length) fail('ga4_sampled', `${spec.name}: raportul GA4 este eșantionat`, { dimension: spec.name })
    if (md?.subjectToThresholding) fail('ga4_thresholding', `${spec.name}: GA4 a aplicat pragul de confidențialitate (thresholding)`, { dimension: spec.name })
    const tz = md?.timeZone ?? conn.timezone
    if (md?.timeZone && md.timeZone !== conn.timezone) {
      fail('timezone_mismatch', `${spec.name}: fusul proprietății (${md.timeZone}) diferă de cel de pe conexiune (${conn.timezone}); se folosește fusul din răspuns`, { dimension: spec.name })
    }
    return tz
  }

  const write = async (table: keyof typeof KEYS, rows: Row[]) => {
    state.rowsWritten += await upsertScoped(deps.db, table, KEYS[table], rows, scope)
  }

  const ourRows = { sessions: [] as number[], engaged: [] as number[], keyEvents: [] as number[] }
  const daysSeen = { web_daily: new Set<string>(), web_key_events: new Set<string>() }
  let usedTz = conn.timezone

  // 1. web_daily
  const daily = await prepare(GA4_DAILY)
  if (daily && !state.fatal) {
    const { pages } = await fetchReport(GA4_DAILY, daily, window)
    const written: Row[] = []
    for (const p of pages) {
      usedTz = checkMetadata(GA4_DAILY, p.report)
      const n = normalizeGa4Daily(p.report, mkCtx(base, now, p.hash, usedTz))
      noteIssues(state, GA4_DAILY.name, n.issues)
      written.push(...n.rows)
    }
    await write('web_daily', written)
    for (const r of written) {
      daysSeen.web_daily.add(r.date as string)
      if (r.sessions !== null) ourRows.sessions.push(r.sessions as number)
      if (r.engaged_sessions !== null) ourRows.engaged.push(r.engaged_sessions as number)
    }
  }

  // 2. web_key_events
  const keyEvents = state.fatal ? null : await prepare(GA4_KEY_EVENTS)
  if (keyEvents && !state.fatal) {
    const { pages } = await fetchReport(GA4_KEY_EVENTS, keyEvents, window)
    const written: Row[] = []
    for (const p of pages) {
      const tz = checkMetadata(GA4_KEY_EVENTS, p.report)
      const n = normalizeGa4KeyEvents(p.report, mkCtx(base, now, p.hash, tz))
      noteIssues(state, GA4_KEY_EVENTS.name, n.issues)
      written.push(...n.rows)
    }
    await write('web_key_events', written)
    for (const r of written) {
      daysSeen.web_key_events.add(r.date as string)
      if (r.key_events !== null) ourRows.keyEvents.push(r.key_events as number)
    }
  }

  // 3. totalul raportat de sursă pe fereastră + reconciliere
  const totals = state.fatal ? null : await prepare(GA4_TOTALS)
  if (totals && !state.fatal) {
    const { pages } = await fetchReport(GA4_TOTALS, totals, window)
    const first = pages[0]
    if (first) {
      const tz = checkMetadata(GA4_TOTALS, first.report)
      const parsed = parseGa4Totals(first.report, ['sessions', 'engagedSessions', 'keyEvents'])
      noteIssues(state, GA4_TOTALS.name, parsed.issues)
      const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null)
      const checks: Array<[string, number | null, number | null]> = [
        ['sessions', sum(ourRows.sessions), parsed.totals.sessions ?? null],
        ['engaged_sessions', sum(ourRows.engaged), parsed.totals.engagedSessions ?? null],
        ['key_events', sum(ourRows.keyEvents), parsed.totals.keyEvents ?? null],
      ]
      await recordReconciliations(deps, state, conn, 'ga4', window, tz, property, checks, now, base.sync_run_id)
    }
  }

  // 4. utilizatori activi: câte un raport pe fiecare interval cerut (nesumabili)
  const active = state.fatal ? null : await prepare({ name: 'web_active_users_interval', dimensions: [], metrics: ['activeUsers'] })
  const intervals = activeUsersIntervals(calendarDateIn(now(), conn.timezone))
  let intervalsCovered = 0
  if (active && !state.fatal) {
    for (const interval of intervals) {
      const spec: Ga4ReportSpec = { name: 'web_active_users_interval', dimensions: [], metrics: ['activeUsers'], interval }
      const { pages } = await fetchReport(spec, active, interval)
      const first = pages[0]
      if (!first) continue
      const tz = checkMetadata(spec, first.report)
      const n = normalizeGa4ActiveUsers(first.report, mkCtx(base, now, first.hash, tz), interval)
      noteIssues(state, `${spec.name} ${interval.start}..${interval.end}`, n.issues)
      await write('web_active_users_interval', n.rows)
      intervalsCovered += n.rows.length
      if (state.fatal) break
    }
  }

  // Acoperire: zile cu rânduri / zile așteptate. O zi fără rânduri e neconfirmată, nu zero.
  const expectedDays = GOOGLE_LOOKBACK_DAYS
  const cov = (covered: number, expected: number) => ({ expected_days: expected, covered_days: covered, coverage: Math.round((covered / expected) * 10_000) / 10_000 })
  state.coverage.web_daily = cov(daysSeen.web_daily.size, expectedDays)
  state.coverage.web_key_events = cov(daysSeen.web_key_events.size, expectedDays)
  state.coverage.web_active_users_interval = cov(intervalsCovered, intervals.length)
  void usedTz
}

// --- Search Console ---------------------------------------------------------------------------------------------------

async function collectGsc(
  deps: GoogleDeps,
  client: GscClient,
  conn: BrandConnection & { brand_id: string },
  base: Omit<Ctx, 'collected_at' | 'payload_hash' | 'source_timezone'>,
  window: { start: string; end: string },
  state: RunState,
  now: () => Date,
): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep
  const retry = { sleep, attempts: RETRY_ATTEMPTS, baseDelayMs: RETRY_BASE_DELAY_MS }
  const rowLimit = deps.gscRowLimit ?? GSC_ROW_LIMIT
  const maxPages = deps.gscMaxPages ?? GSC_MAX_PAGES
  const fail = (code: string, message: string, extra: Partial<SyncRunError> = {}) => state.errors.push({ code, status: null, message, ...extra })
  const siteUrl = conn.external_account_id.trim()
  if (!/^(https?:\/\/\S+|sc-domain:[A-Za-z0-9.-]+)$/.test(siteUrl)) {
    fail('invalid_site_url', `site_url invalid: ${JSON.stringify(siteUrl)} (https://… sau sc-domain:…)`)
    state.fatal = true
    return
  }
  const scope = { tenant_id: conn.tenant_id, brand_id: conn.brand_id }

  /** Toate paginile (startRow) pentru o combinație de dimensiuni; `onPage` primește fiecare pagină validată. */
  const paginate = async (label: string, dimensions: string[], onPage: (res: ReturnType<typeof GscResponseSchema.parse>, hash: string) => Promise<void>): Promise<void> => {
    for (let page = 0; page < maxPages; page++) {
      const startRow = page * rowLimit
      const r = await callWithRetry(
        () => client.query({ siteUrl, startDate: window.start, endDate: window.end, dimensions, rowLimit, startRow, dataState: GSC_DATA_STATE }),
        retry,
      )
      state.calls += r.attempts
      if (!r.ok) {
        fail(r.failure.kind, `${label}: ${r.failure.message}`, { dimension: label, status: typeof r.failure.code === 'number' ? r.failure.code : null })
        if (r.failure.kind === 'access_denied') {
          state.fatal = true
          fail('access_denied', 'contul de serviciu nu are acces la această proprietate Search Console', { dimension: label })
        }
        return
      }
      const parsed = GscResponseSchema.safeParse(r.value)
      if (!parsed.success) {
        fail('invalid_payload', `${label}: răspuns Search Analytics invalid`, { dimension: label })
        return
      }
      await onPage(parsed.data, sha256(r.value))
      const n = parsed.data.rows?.length ?? 0
      if (n < rowLimit) return // ultima pagină
      if (page === maxPages - 1) fail('gsc_truncated', `${label}: plafon de ${maxPages} pagini atins; datele sunt trunchiate`, { dimension: label })
    }
  }

  const days = { search_daily: new Set<string>(), search_queries: new Set<string>() }
  const daily: Row[] = []

  // 1. search_daily (date × device): includ și interogările anonimizate
  await paginate('search_daily', ['date', 'device'], async (res, hash) => {
    const ctx = mkCtx(base, now, hash, GSC_TIMEZONE)
    const n = normalizeGscDaily(res, ctx, GSC_DATA_STATE)
    noteIssues(state, 'search_daily', n.issues)
    daily.push(...n.rows)
    state.rowsWritten += await upsertScoped(deps.db, 'search_daily', KEYS.search_daily, n.rows, scope)
    for (const r of n.rows) days.search_daily.add(r.date as string)
  })

  // 2. totaluri pe zi (fără device, fără query): referința pentru reconciliere
  const reported = { clicks: 0, impressions: 0, rows: 0, complete: false }
  if (!state.fatal) {
    let ok = true
    await paginate('search_totals_by_date', ['date'], async (res) => {
      const t = parseGscDateTotals(res)
      noteIssues(state, 'search_totals_by_date', t.issues)
      for (const v of t.byDate.values()) {
        reported.rows++
        if (v.clicks === null || v.impressions === null) ok = false
        reported.clicks += v.clicks ?? 0
        reported.impressions += v.impressions ?? 0
      }
    })
    reported.complete = ok && reported.rows > 0
  }
  if (reported.complete) {
    // Total pe rânduri distincte (cheia naturală): o pagină repetată nu poate dubla totalul.
    const distinct = [...new Map(daily.map((r) => [`${r.date}|${r.device}`, r])).values()]
    const sum = (col: 'clicks' | 'impressions') => {
      const xs = distinct.map((r) => r[col]).filter((v): v is number => typeof v === 'number')
      return xs.length ? xs.reduce((a, b) => a + b, 0) : null
    }
    await recordReconciliations(
      deps, state, conn, 'gsc', window, GSC_TIMEZONE, siteUrl,
      [['clicks', sum('clicks'), reported.clicks], ['impressions', sum('impressions'), reported.impressions]],
      now, base.sync_run_id,
    )
  }

  // 3. query × page (separat de totaluri; cel mai mare volum, ultimul)
  if (!state.fatal) {
    await paginate('search_queries', ['date', 'query', 'page', 'device'], async (res, hash) => {
      const n = normalizeGscQueries(res, mkCtx(base, now, hash, GSC_TIMEZONE), GSC_DATA_STATE)
      noteIssues(state, 'search_queries', n.issues)
      state.rowsWritten += await upsertScoped(deps.db, 'search_queries', KEYS.search_queries, n.rows, scope)
      for (const r of n.rows) days.search_queries.add(r.date as string)
    })
  }

  const cov = (covered: number) => ({ expected_days: GOOGLE_LOOKBACK_DAYS, covered_days: covered, coverage: Math.round((covered / GOOGLE_LOOKBACK_DAYS) * 10_000) / 10_000 })
  state.coverage.search_daily = cov(days.search_daily.size)
  state.coverage.search_queries = cov(days.search_queries.size)
}

// --- Reconciliere (comună) --------------------------------------------------------------------------------------------

async function recordReconciliations(
  deps: GoogleDeps,
  state: RunState,
  conn: BrandConnection & { brand_id: string },
  source: GoogleSource,
  window: { start: string; end: string },
  timezone: string,
  property: string,
  checks: Array<[metric: string, ours: number | null, reported: number | null]>,
  now: () => Date,
  syncRunId: string | null,
): Promise<void> {
  const tolerance = RECONCILE_TOLERANCE_PCT[source]
  const rows: Row[] = []
  for (const [metric, ours, reported] of checks) {
    const result = reconcileTotals({
      metric,
      ours: { total: ours, start: window.start, end: window.end, timezone, property },
      source: { total: reported, start: window.start, end: window.end, timezone, property },
      tolerancePct: tolerance,
    })
    state.reconciliations.push({ metric, ...result })
    if (result.status === 'mismatch') {
      state.errors.push({
        code: 'reconciliation_mismatch', dimension: metric, status: null,
        message: `${source} ${metric}: totalul nostru ${ours} diferă de cel raportat de sursă ${reported} (${result.difference_pct ?? 'n/a'}%, toleranță ${tolerance}%)`,
      })
    }
    rows.push({
      tenant_id: conn.tenant_id, brand_id: conn.brand_id, source, metric, period_start: window.start, period_end: window.end,
      source_timezone: timezone, property_ref: property, our_total: ours, source_total: reported,
      difference: result.difference, difference_pct: result.difference_pct, status: result.status, tolerance_pct: tolerance,
      reason: result.reason, sync_run_id: syncRunId, checked_at: now().toISOString(),
    })
  }
  await upsertScoped(deps.db, 'source_reconciliations', KEYS.source_reconciliations, rows, { tenant_id: conn.tenant_id, brand_id: conn.brand_id })
}

