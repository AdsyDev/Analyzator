// Colectarea Planable (Public API v1): social propriu (social_daily, social_posts) și Listening (mentions), per brand.
// Configurare: o conexiune `planable_account` per client (tokenul în Vault) și câte o conexiune `planable` per brand
// (external_account_id = workspace-ul). Contract: docs/contracts/planable.md.
//
// Fără token (lipsă sau invalid), conexiunile brandurilor clientului raportează `not_connected`: fără sync_run, fără cereri.
// Fiecare brand are două sync_runs: planable_analytics și planable_listening. Eșecul unui brand nu le oprește pe celelalte.

import { getSourceToken, loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { CallBudget, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunHandle, type SyncRunResult } from '../shared/sync-runs.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { addDaysIso, calendarDateIn, isValidTimeZone, lookbackWindow } from '../google/dates.ts'
import { createHash } from 'node:crypto'
import { PlanableClient, type GetResult, type Params } from './client.ts'
import {
  PLANABLE_CREDENTIAL_PROVIDER,
  PLANABLE_LOOKBACK_DAYS,
  PLANABLE_MAX_CALLS,
  PLANABLE_MAX_PAGES,
  PLANABLE_MENTIONS_PAGE_SIZE,
  PLANABLE_METRICS_PAGE_SIZE,
  PLANABLE_PAGE_SIZE,
  PLANABLE_PROVIDER,
  SOURCE_ANALYTICS,
  SOURCE_COMPETITORS,
  SOURCE_LISTENING,
  SOURCE_LISTENING_COMPETITORS,
  TRACKER_SOURCE_COMPETITORS,
  TRACKER_SOURCE_LISTENING,
  COMPETITOR_PLATFORMS,
  PLANABLE_COMPETITORS_SCHEMA_VERSION,
} from './config.ts'
import {
  KeywordsSchema,
  MentionsSchema,
  PageMetricsSchema,
  PagesSchema,
  PostMetricsSchema,
  PostsSchema,
  WorkspacesSchema,
  MENTION_SKIP_LABELS,
  mentionFieldShape,
  builtMentionIdentity,
  builtMentionNativeId,
  CompetitorComparisonSchema,
  CompetitorSeriesSchema,
  TrackedCompetitorsSchema,
  competitorMentionRow,
  coveredFrom,
  platformOf,
  type TrackedCompetitor,
  hasNoLink,
  mentionRow,
  mentionSkipReasons,
  ownAccounts,
  socialDailyRows,
  socialPostRow,
  type Mention,
  type MentionSkipReason,
  type Page,
  type PageMetricsItem,
  type Post,
} from './normalize.ts'

export type PlanableSource = typeof SOURCE_ANALYTICS | typeof SOURCE_LISTENING | typeof SOURCE_LISTENING_COMPETITORS | typeof SOURCE_COMPETITORS

export type PlanableDeps = { db: Db; fetch?: FetchLike; sleep?: Sleep; now?: () => Date }

export type PlanableOutcome = {
  tenant_id: string
  brand_id: string | null
  connection_id: string
  source: PlanableSource
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  sync_run_id: string | null
  rows_written: number
  errors: SyncRunError[]
  reason?: string
}

export const KEYS = {
  social_daily: ['tenant_id', 'brand_id', 'platform', 'account_id', 'date'],
  social_posts: ['tenant_id', 'brand_id', 'platform', 'account_id', 'post_id', 'snapshot_date', 'metrics_scope'],
  mentions: ['tenant_id', 'brand_id', 'native_id'],
  competitor_mentions: ['tenant_id', 'brand_id', 'keyword_id', 'native_id'],
  competitor_trackers: ['tenant_id', 'brand_id', 'source', 'external_id'],
  competitor_social_daily: ['tenant_id', 'brand_id', 'platform', 'profile_id', 'date'],
} as const

type BrandConnection = { id: string; tenant_id: string; brand_id: string | null; provider: string; external_account_id: string; status: string }
type Workspaces = { ok: true; timezones: Map<string, string> } | { ok: false; error: SyncRunError; credentialInvalid: boolean }

/** Notele de parser (câmpuri necunoscute, valori invalide) se raportează, dar nu schimbă statusul rulării. */
const isNote = (e: SyncRunError) => e.code.startsWith('parser_')

function statusOf(errors: SyncRunError[], rows: number, fatal: boolean): SyncRunResult['status'] {
  const real = errors.filter((e) => !isNote(e))
  if (fatal && rows === 0) return 'failed'
  if (real.length > 0) return rows > 0 ? 'partial' : 'failed'
  return 'succeeded'
}

/** Tipurile de cuvinte Listening care nu sunt ale brandului; restul (inclusiv un tip necunoscut) rămân la brand, ca înainte. */
const NON_BRAND_KEYWORD_TYPES = ['competitor', 'topic']

/** Dimensiunea notelor despre mențiuni sărite; `collect.ts` le scrie în jurnalul rulării. */
export const MENTIONS_SKIPPED = 'mentions_skipped'
export const MENTIONS_WITHOUT_LINK = 'mentions_without_link'

type SkippedGroup = { count: number; filled: Map<string, number>; empty: Map<string, number>; links: Map<string, number> }
const FIELD_LIST_MAX = 40

/** „a, b (3), c”: numele câmpurilor în ordine alfabetică; numărul apare doar când câmpul nu e în toate mențiunile grupului. */
function fieldList(fields: Map<string, number>, total: number): string {
  const names = [...fields.keys()].sort((a, b) => a.localeCompare(b))
  const shown = names.slice(0, FIELD_LIST_MAX).map((n) => (fields.get(n) === total ? n : `${n} (${fields.get(n)})`))
  if (names.length > FIELD_LIST_MAX) shown.push(`și încă ${names.length - FIELD_LIST_MAX}`)
  return shown.length ? shown.join(', ') : 'niciunul'
}

/**
 * Două note pe (rețea, motiv), cele mai numeroase întâi: câte mențiuni au fost sărite și ce câmpuri aveau (doar numele lor,
 * niciodată valorile). O mențiune găsită de două cuvinte urmărite se numără de două ori: fără URL nu avem cu ce o deduplica.
 */
function skippedMentionNotes(skipped: Map<string, SkippedGroup>): SyncRunError[] {
  return [...skipped.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .flatMap(([key, g]) => {
      const cut = key.lastIndexOf('|')
      const platform = key.slice(0, cut)
      const why = (key.slice(cut + 1).split('+') as MentionSkipReason[]).map((r) => MENTION_SKIP_LABELS[r]).join(' și ')
      const note = (message: string): SyncRunError => ({ code: 'parser_note', status: null, dimension: MENTIONS_SKIPPED, message })
      return [
        note(`${g.count} ${g.count === 1 ? 'mențiune sărită' : 'mențiuni sărite'} din ${platform}: ${why}`),
        note(`câmpurile lor (${platform}): cu valoare: ${fieldList(g.filled, g.count)}; goale: ${fieldList(g.empty, g.count)}; cu link http(s): ${fieldList(g.links, g.count)}`),
      ]
    })
}

/**
 * O notă pe rețea pentru mențiunile scrise fără link: câte sunt și câte nu au nici text. Sunt în `mentions`, cu `url` NULL și
 * cheia construită; nota spune de ce feed-ul nu le poate arăta. Nu schimbă statusul rulării.
 */
function withoutLinkNotes(unlinked: Map<string, { count: number; withoutText: number }>): SyncRunError[] {
  return [...unlinked.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([platform, g]) => ({
      code: 'parser_note',
      status: null,
      dimension: MENTIONS_WITHOUT_LINK,
      message: `${g.count} ${g.count === 1 ? 'mențiune scrisă' : 'mențiuni scrise'} din ${platform} fără link de la sursă (${g.withoutText} și fără text); cheia e construită din rețea, autor și dată`,
    }))
}

function httpError(r: Extract<GetResult, { ok: false }>, dimension: string): SyncRunError {
  return { code: r.kind, status: r.status, dimension, message: r.message }
}

/** Punctul de intrare: toate conexiunile `planable` active, grupate pe client. */
export async function collectPlanable(deps: PlanableDeps): Promise<PlanableOutcome[]> {
  const { db } = deps
  const credentials = await loadActiveConnections(db, PLANABLE_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c]))
  const skippedReason = new Map<string, string>()
  if (credentials.skipped.length) {
    const rows = await db.select<{ id: string; tenant_id: string }>('source_connections', `select=id,tenant_id&provider=eq.${PLANABLE_CREDENTIAL_PROVIDER}&status=eq.active`)
    for (const s of credentials.skipped) {
      const row = rows.find((r) => r.id === s.id)
      if (row) skippedReason.set(row.tenant_id, `token Planable ${s.reason}`)
    }
  }

  const connections = await db.select<BrandConnection>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${PLANABLE_PROVIDER}&status=eq.active`)
  const byTenant = new Map<string, Array<BrandConnection & { brand_id: string }>>()
  const outcomes: PlanableOutcome[] = []
  const notConnected = (c: BrandConnection, reason: string) => {
    for (const source of [SOURCE_ANALYTICS, SOURCE_LISTENING, SOURCE_LISTENING_COMPETITORS, SOURCE_COMPETITORS] as const) {
      outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, source, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    }
  }
  for (const c of connections) {
    if (c.provider !== PLANABLE_PROVIDER || c.status !== 'active') throw new Error(`Conexiunea ${c.id} nu corespunde filtrului; opresc rularea.`)
    if (!c.brand_id) {
      notConnected(c, 'conexiune Planable fără brand')
      continue
    }
    if (!credentialByTenant.has(c.tenant_id)) {
      notConnected(c, skippedReason.get(c.tenant_id) ?? 'token Planable neconfigurat pentru acest client')
      continue
    }
    const list = byTenant.get(c.tenant_id) ?? []
    list.push({ ...c, brand_id: c.brand_id })
    byTenant.set(c.tenant_id, list)
  }

  for (const [tenantId, list] of byTenant) {
    const credential = credentialByTenant.get(tenantId)!
    outcomes.push(...(await collectTenant(deps, credential.id, list)))
  }
  return outcomes
}

async function collectTenant(deps: PlanableDeps, credentialId: string, list: Array<BrandConnection & { brand_id: string }>): Promise<PlanableOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const token = await getSourceToken(db, credentialId)
  const client = new PlanableClient({ token, budget: new CallBudget(PLANABLE_MAX_CALLS), fetch: deps.fetch, sleep: deps.sleep })

  const ws = await loadWorkspaces(client)
  // Apelul /workspaces e al contului clientului, nu al unui brand.
  await recordProviderCalls(db, { tenant_id: list[0]!.tenant_id, brand_id: null, source_connection_id: credentialId, call_date_utc: utcDay(now()), purpose: 'collect', calls: client.budget.used })
  if (!ws.ok && ws.credentialInvalid) {
    await db.rpc('record_source_validation', { p_connection_id: credentialId, p_ok: false, p_error: `HTTP ${ws.error.status ?? ''}`.trim() }).catch(() => undefined)
  } else if (ws.ok) {
    await db.rpc('record_source_validation', { p_connection_id: credentialId, p_ok: true }).catch(() => undefined)
  }

  const out: PlanableOutcome[] = []
  for (const conn of list) {
    const before = client.budget.used
    try {
      const timezone = ws.ok ? ws.timezones.get(conn.external_account_id) : undefined
      const workspaceError: SyncRunError | null = !ws.ok
        ? ws.error
        : timezone === undefined
          ? { code: 'workspace_not_found', status: null, dimension: `workspace:${conn.external_account_id}`, message: 'Workspace-ul nu există sau tokenul nu are acces la el.' }
          : null
      const tz = timezone && isValidTimeZone(timezone) ? timezone : 'Europe/Bucharest'
      out.push(await runAnalytics(deps, client, conn, tz, workspaceError, now))
      out.push(await runListening(deps, client, conn, tz, workspaceError, now))
      out.push(await runCompetitorListening(deps, client, conn, tz, workspaceError, now))
      out.push(await runCompetitorProfiles(deps, client, conn, tz, workspaceError, now))
    } finally {
      const calls = client.budget.used - before
      await recordProviderCalls(db, { tenant_id: conn.tenant_id, brand_id: conn.brand_id, source_connection_id: conn.id, call_date_utc: utcDay(now()), purpose: 'collect', calls })
    }
  }
  return out
}

async function loadWorkspaces(client: PlanableClient): Promise<Workspaces> {
  const r = await client.get('/workspaces')
  if (!r.ok) return { ok: false, error: httpError(r, 'workspaces'), credentialInvalid: r.status === 401 }
  const parsed = WorkspacesSchema.safeParse(r.payload)
  if (!parsed.success) return { ok: false, error: { code: 'invalid_payload', status: null, dimension: 'workspaces', message: 'Forma răspunsului /workspaces s-a schimbat.' }, credentialInvalid: false }
  return { ok: true, timezones: new Map(parsed.data.data.map((w) => [w.id, w.timezone])) }
}

/** Paginare offset/limit cu `pagination.hasMore`; se oprește la eșec, la formă invalidă sau la plafonul de pagini. */
async function paginate<T>(
  client: PlanableClient,
  path: string,
  params: Params,
  pageSize: number,
  parse: (payload: unknown) => { items: T[]; hasMore: boolean } | null,
  dimension: string,
): Promise<{ items: Array<{ item: T; hash: string }>; error: SyncRunError | null }> {
  const items: Array<{ item: T; hash: string }> = []
  for (let page = 0; page < PLANABLE_MAX_PAGES; page++) {
    const r = await client.get(path, { ...params, offset: page * pageSize, limit: pageSize })
    if (!r.ok) return { items, error: httpError(r, dimension) }
    const p = parse(r.payload)
    if (!p) return { items, error: { code: 'invalid_payload', status: null, dimension, message: `Forma răspunsului ${dimension} s-a schimbat.` } }
    for (const item of p.items) items.push({ item, hash: r.payloadHash })
    if (!p.hasMore || p.items.length === 0) return { items, error: null }
  }
  return { items, error: { code: 'pagination_stalled', status: null, dimension, message: `Paginarea nu s-a terminat după ${PLANABLE_MAX_PAGES} pagini.` } }
}

function scopeOf(conn: { tenant_id: string; brand_id: string }) {
  assertUuid(conn.tenant_id, 'tenant_id')
  assertUuid(conn.brand_id, 'brand_id')
  return { tenant_id: conn.tenant_id, brand_id: conn.brand_id }
}

async function finish(deps: PlanableDeps, handle: SyncRunHandle, conn: BrandConnection & { brand_id: string }, source: PlanableSource, errors: SyncRunError[], rows: number, fatal: boolean, now: () => Date, coverage?: SyncRunResult['coverage']): Promise<PlanableOutcome> {
  const status = statusOf(errors, rows, fatal)
  await finishSyncRun(deps.db, handle, { status, rows_written: rows, attempt_count: 1, errors, ...(coverage ? { coverage } : {}) }, now)
  return { tenant_id: conn.tenant_id, brand_id: conn.brand_id, connection_id: conn.id, source, status, sync_run_id: handle.id, rows_written: rows, errors }
}

async function runAnalytics(deps: PlanableDeps, client: PlanableClient, conn: BrandConnection & { brand_id: string }, tz: string, workspaceError: SyncRunError | null, now: () => Date): Promise<PlanableOutcome> {
  const { db } = deps
  const window = lookbackWindow(now(), tz, PLANABLE_LOOKBACK_DAYS)
  const scope = scopeOf(conn)
  const handle = await startSyncRun(db, { ...scope, source: SOURCE_ANALYTICS, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const errors: SyncRunError[] = []
  let rows = 0
  try {
    if (workspaceError) return await finish(deps, handle, conn, SOURCE_ANALYTICS, [workspaceError], 0, true, now)
    const notes: string[] = []
    const collectedAt = now().toISOString()
    const provenance = { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, source_timezone: tz }

    const pages = await paginate<Page>(client, '/pages', { workspaceId: conn.external_account_id }, PLANABLE_PAGE_SIZE, (p) => {
      const r = PagesSchema.safeParse(p)
      return r.success ? { items: r.data.data, hasMore: r.data.pagination.hasMore } : null
    }, 'pages')
    if (pages.error) errors.push(pages.error)
    if (pages.error && pages.items.length === 0) return await finish(deps, handle, conn, SOURCE_ANALYTICS, errors, 0, true, now)

    const daily: Row[] = []
    const posts: Row[] = []
    const startIso = `${window.start}T00:00:00.000Z`
    const endIso = `${window.end}T23:59:59.999Z`
    for (const { item: page } of pages.items) {
      if (page.workspaceId !== conn.external_account_id) throw new Error(`Pagina ${page.id} aparține altui workspace; opresc rularea.`)
      if (!page.isConnected) {
        notes.push(`pagina ${page.id} (${page.platform}) nu e conectată în Planable`)
        continue
      }
      const metrics = await paginate<PageMetricsItem>(client, `/pages/${encodeURIComponent(page.id)}/metrics`, { startDate: startIso, endDate: endIso }, PLANABLE_METRICS_PAGE_SIZE, (p) => {
        const r = PageMetricsSchema.safeParse(p)
        return r.success ? { items: r.data.data, hasMore: r.data.pagination.hasMore } : null
      }, `page_metrics:${page.id}`)
      if (metrics.error) errors.push(metrics.error)
      const hashes = new Map(metrics.items.map((m) => [m.item, m.hash]))
      daily.push(...socialDailyRows(page, metrics.items.filter((m) => m.item.pageId === page.id).map((m) => m.item), tz, { ...provenance, hashes }, notes))

      const list = await paginate<Post>(client, '/posts', { workspaceId: conn.external_account_id, pageId: page.id, scheduledAfter: startIso, scheduledBefore: endIso }, PLANABLE_PAGE_SIZE, (p) => {
        const r = PostsSchema.safeParse(p)
        return r.success ? { items: r.data.data, hasMore: r.data.pagination.hasMore } : null
      }, `posts:${page.id}`)
      if (list.error) errors.push(list.error)
      for (const { item: post } of list.items) {
        if (!post.published || post.archived || !post.scheduledAt) continue
        const r = await client.get(`/posts/${encodeURIComponent(post.id)}/metrics`)
        if (!r.ok) {
          // 404 = postare fără metrici încă (documentat: „Post not found or metrics missing”): notă, nu eroare.
          if (r.status === 404) notes.push(`postarea ${post.id} nu are încă metrici`)
          else errors.push(httpError(r, `post_metrics:${post.id}`))
          continue
        }
        const parsed = PostMetricsSchema.safeParse(r.payload)
        if (!parsed.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: `post_metrics:${post.id}`, message: 'Forma răspunsului de metrici s-a schimbat.' })
          continue
        }
        posts.push(socialPostRow(post, parsed.data.data, tz, { ...provenance, payload_hash: r.payloadHash }, notes))
      }
    }

    rows += await upsertScoped(db, 'social_daily', KEYS.social_daily, daily, scope)
    rows += await upsertScoped(db, 'social_posts', KEYS.social_posts, posts, scope)
    for (const n of [...new Set(notes)]) errors.push({ code: 'parser_note', status: null, message: n })
    const covered = new Set(daily.map((r) => r.date as string).filter((d) => d >= window.start && d <= window.end)).size
    return await finish(deps, handle, conn, SOURCE_ANALYTICS, errors, rows, false, now, {
      social_daily: { expected_days: PLANABLE_LOOKBACK_DAYS, covered_days: covered, coverage: Math.round((covered / PLANABLE_LOOKBACK_DAYS) * 10_000) / 10_000 },
    })
  } catch (err) {
    errors.push({ code: 'exception', status: null, message: (err as Error).message })
    return await finish(deps, handle, conn, SOURCE_ANALYTICS, errors, rows, true, now)
  }
}

async function runListening(deps: PlanableDeps, client: PlanableClient, conn: BrandConnection & { brand_id: string }, tz: string, workspaceError: SyncRunError | null, now: () => Date): Promise<PlanableOutcome> {
  const { db } = deps
  const window = lookbackWindow(now(), tz, PLANABLE_LOOKBACK_DAYS)
  const scope = scopeOf(conn)
  // Cuvintele urmărite se citesc înaintea rulării: un workspace fără Listening configurat nu e o rulare eșuată.
  const kw = workspaceError ? null : await client.get('/keywords', { workspaceId: conn.external_account_id, type: 'brand' })
  const parsedKeywords = kw?.ok ? KeywordsSchema.safeParse(kw.payload) : null
  // Dacă API-ul ignoră parametrul `type`, cuvintele de tip „competitor” și „topic” nu devin mențiuni ale brandului (deciziile Y).
  const keywords = parsedKeywords?.success
    ? { success: true as const, data: { ...parsedKeywords.data, data: parsedKeywords.data.data.filter((k) => !NON_BRAND_KEYWORD_TYPES.includes(k.type.toLowerCase())) } }
    : parsedKeywords
  if (keywords?.success && keywords.data.data.length === 0) {
    return { tenant_id: conn.tenant_id, brand_id: conn.brand_id, connection_id: conn.id, source: SOURCE_LISTENING, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason: 'niciun cuvânt de tip „brand” urmărit în Planable Listening' }
  }
  const handle = await startSyncRun(db, { ...scope, source: SOURCE_LISTENING, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const errors: SyncRunError[] = []
  let rows = 0
  try {
    if (workspaceError) return await finish(deps, handle, conn, SOURCE_LISTENING, [workspaceError], 0, true, now)
    if (kw && !kw.ok) return await finish(deps, handle, conn, SOURCE_LISTENING, [httpError(kw, 'keywords')], 0, true, now)
    if (!keywords?.success) return await finish(deps, handle, conn, SOURCE_LISTENING, [{ code: 'invalid_payload', status: null, dimension: 'keywords', message: 'Forma răspunsului /keywords s-a schimbat.' }], 0, true, now)

    const collectedAt = now().toISOString()
    const provenance = { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, source_timezone: tz }
    // Paginile workspace-ului = conturile proprii ale brandului; fără ele, „cont propriu” rămâne necunoscut (null), nu fals.
    const pages = await paginate<Page>(client, '/pages', { workspaceId: conn.external_account_id }, PLANABLE_PAGE_SIZE, (p) => {
      const r = PagesSchema.safeParse(p)
      return r.success ? { items: r.data.data, hasMore: r.data.pagination.hasMore } : null
    }, 'pages')
    if (pages.error) errors.push(pages.error)
    const own = pages.error && pages.items.length === 0 ? null : ownAccounts(pages.items.map(({ item }) => item).filter((pg) => pg.workspaceId === conn.external_account_id))
    const mentions: Row[] = []
    // Mențiunile fără link, grupate pe identitate (rețea, autor, moment, text). Aceeași mențiune găsită de două cuvinte
    // urmărite se scrie o dată: pe fiecare identitate rămâne cea mai lungă listă dintre cuvinte, nu suma lor.
    type Unlinked = { m: Mention; payloadHash: string }
    const withoutLink = new Map<string, Unlinked[]>()
    // Mențiunile sărite, numărate pe rețea și motiv: o notă pe grup, nu una pe mențiune.
    const skipped = new Map<string, SkippedGroup>()
    for (const k of keywords.data.data) {
      const ofKeyword = new Map<string, Unlinked[]>()
      let cursor: number | undefined
      for (let page = 0; page < PLANABLE_MAX_PAGES; page++) {
        const r = await client.get(`/keywords/${encodeURIComponent(k.keywordId)}/mentions`, {
          workspaceId: conn.external_account_id, startDate: `${window.start}T00:00:00.000Z`, endDate: `${window.end}T23:59:59.999Z`, sortBy: 'recency', limit: PLANABLE_MENTIONS_PAGE_SIZE, cursor,
        })
        if (!r.ok) {
          errors.push(httpError(r, `mentions:${k.keywordId}`))
          break
        }
        const parsed = MentionsSchema.safeParse(r.payload)
        if (!parsed.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: `mentions:${k.keywordId}`, message: 'Forma răspunsului de mențiuni s-a schimbat.' })
          break
        }
        for (const m of parsed.data.data as Mention[]) {
          const reasons = mentionSkipReasons(m)
          if (reasons.length > 0) {
            // Rețeaua vine din API ca text liber (același câmp ca `mentions.source_name`): curățată și limitată, ca notele să rămână puține.
            const platform = m.platform.trim().toLowerCase().replace(/[^\p{L}\p{N}_ .-]+/gu, '_').slice(0, 64)
            const key = `${platform || 'rețea necunoscută'}|${reasons.join('+')}`
            const group = skipped.get(key) ?? { count: 0, filled: new Map(), empty: new Map(), links: new Map() }
            group.count++
            const shape = mentionFieldShape(m as Record<string, unknown>)
            for (const kind of ['filled', 'empty', 'links'] as const) for (const name of new Set(shape[kind])) group[kind].set(name, (group[kind].get(name) ?? 0) + 1)
            skipped.set(key, group)
            continue
          }
          if (hasNoLink(m)) {
            const identity = builtMentionIdentity(m)
            const same = ofKeyword.get(identity) ?? []
            same.push({ m, payloadHash: r.payloadHash })
            ofKeyword.set(identity, same)
            continue
          }
          mentions.push(mentionRow(m, { ...provenance, payload_hash: r.payloadHash }, own))
        }
        const next = parsed.data.pagination.nextCursor
        if (next === null || next === cursor || parsed.data.data.length === 0) break
        cursor = next
      }
      for (const [identity, same] of ofKeyword) if (same.length > (withoutLink.get(identity)?.length ?? 0)) withoutLink.set(identity, same)
    }

    // Cheia construită: identitatea plus numărul de ordine printre mențiunile identice. Ordinea lor e fixată după sentiment,
    // ca aceeași rulare repetată să dea aceleași rânduri.
    const unlinked = new Map<string, { count: number; withoutText: number }>()
    for (const [identity, same] of withoutLink) {
      const ordered = [...same].sort((a, b) => (a.m.sentiment ?? '').localeCompare(b.m.sentiment ?? ''))
      ordered.forEach(({ m, payloadHash }, i) => {
        mentions.push(mentionRow(m, { ...provenance, payload_hash: payloadHash }, own, builtMentionNativeId(identity, i + 1)))
        const platform = m.platform.trim().toLowerCase().replace(/[^\p{L}\p{N}_ .-]+/gu, '_').slice(0, 64) || 'rețea necunoscută'
        const g = unlinked.get(platform) ?? { count: 0, withoutText: 0 }
        g.count++
        if (typeof m.text !== 'string' || m.text.trim() === '') g.withoutText++
        unlinked.set(platform, g)
      })
    }
    errors.push(...withoutLinkNotes(unlinked))
    errors.push(...skippedMentionNotes(skipped))

    // Corecțiile umane au prioritate: mențiunile cu sentiment revizuit se actualizează fără câmpul sentiment (ca la CSV).
    const reviewed = new Set<string>()
    for (let offset = 0; ; offset += 1000) {
      const page = await db.select<{ native_id: string }>('mentions', `select=native_id&tenant_id=eq.${scope.tenant_id}&brand_id=eq.${scope.brand_id}&sentiment_reviewed_by=not.is.null&order=native_id.asc&limit=1000&offset=${offset}`)
      for (const p of page) reviewed.add(p.native_id)
      if (page.length < 1000) break
    }
    const free = mentions.filter((m) => !reviewed.has(m.native_id as string))
    const locked = mentions.filter((m) => reviewed.has(m.native_id as string)).map(({ sentiment: _s, ...rest }) => rest)
    rows += await upsertScoped(db, 'mentions', KEYS.mentions, free, scope)
    rows += await upsertScoped(db, 'mentions', KEYS.mentions, locked, scope)
    return await finish(deps, handle, conn, SOURCE_LISTENING, errors, rows, false, now)
  } catch (err) {
    errors.push({ code: 'exception', status: null, message: (err as Error).message })
    return await finish(deps, handle, conn, SOURCE_LISTENING, errors, rows, true, now)
  }
}

/**
 * Mențiunile cuvintelor de tip „competitor” (deciziile Y) → `competitor_mentions`, pe cuvânt, și `competitor_trackers` (ce cuvinte
 * s-au citit și ce zile acoperă). Atribuirea la competitori se face în SQL, după setul în vigoare: aici nu se ghicește nimic.
 * Un workspace fără cuvinte de tip „competitor” nu e o rulare eșuată: `not_connected`, fără sync_run.
 */
async function runCompetitorListening(deps: PlanableDeps, client: PlanableClient, conn: BrandConnection & { brand_id: string }, tz: string, workspaceError: SyncRunError | null, now: () => Date): Promise<PlanableOutcome> {
  const { db } = deps
  const window = lookbackWindow(now(), tz, PLANABLE_LOOKBACK_DAYS)
  const scope = scopeOf(conn)
  const kw = workspaceError ? null : await client.get('/keywords', { workspaceId: conn.external_account_id, type: 'competitor' })
  const parsed = kw?.ok ? KeywordsSchema.safeParse(kw.payload) : null
  // Filtrul pe tip se repetă local: dacă API-ul ignoră parametrul, cuvintele brandului nu ajung la competitori.
  const keywords = parsed?.success ? parsed.data.data.filter((k) => k.type.toLowerCase() === 'competitor') : null
  if (keywords && keywords.length === 0) {
    return { tenant_id: conn.tenant_id, brand_id: conn.brand_id, connection_id: conn.id, source: SOURCE_LISTENING_COMPETITORS, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason: 'niciun cuvânt de tip „competitor” urmărit în Planable Listening' }
  }
  const handle = await startSyncRun(db, { ...scope, source: SOURCE_LISTENING_COMPETITORS, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const errors: SyncRunError[] = []
  let rows = 0
  try {
    if (workspaceError) return await finish(deps, handle, conn, SOURCE_LISTENING_COMPETITORS, [workspaceError], 0, true, now)
    if (kw && !kw.ok) return await finish(deps, handle, conn, SOURCE_LISTENING_COMPETITORS, [httpError(kw, 'keywords:competitor')], 0, true, now)
    if (!keywords) return await finish(deps, handle, conn, SOURCE_LISTENING_COMPETITORS, [{ code: 'invalid_payload', status: null, dimension: 'keywords:competitor', message: 'Forma răspunsului /keywords s-a schimbat.' }], 0, true, now)

    const collectedAt = now().toISOString()
    const provenance = { ...scope, source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt }
    const previous = new Map(
      (await db.select<{ external_id: string; covered_from: string | null; covered_to: string }>(
        'competitor_trackers',
        `select=external_id,covered_from,covered_to&tenant_id=eq.${scope.tenant_id}&brand_id=eq.${scope.brand_id}&source=eq.${TRACKER_SOURCE_LISTENING}`,
      )).map((t) => [t.external_id, t]),
    )
    const mentions: Row[] = []
    const trackers: Row[] = []
    const skipped = new Map<string, SkippedGroup>()
    for (const k of keywords) {
      const label = k.text.trim()
      if (label === '' || label.length > 200) {
        errors.push({ code: 'parser_note', status: null, dimension: `keywords:${k.keywordId}`, message: 'cuvânt de tip „competitor” fără text sau mai lung de 200 de caractere; sărit' })
        continue
      }
      let complete = true
      // Mențiunile fără link, pe identitate, în cuvântul curent: identicele primesc numere de ordine (ca la brand, deciziile R).
      const withoutLink = new Map<string, Array<{ m: Mention; payloadHash: string }>>()
      let cursor: number | undefined
      let page = 0
      for (; page < PLANABLE_MAX_PAGES; page++) {
        const r = await client.get(`/keywords/${encodeURIComponent(k.keywordId)}/mentions`, {
          workspaceId: conn.external_account_id, startDate: `${window.start}T00:00:00.000Z`, endDate: `${window.end}T23:59:59.999Z`, sortBy: 'recency', limit: PLANABLE_MENTIONS_PAGE_SIZE, cursor,
        })
        if (!r.ok) {
          errors.push(httpError(r, `mentions:${k.keywordId}`))
          complete = false
          break
        }
        const p = MentionsSchema.safeParse(r.payload)
        if (!p.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: `mentions:${k.keywordId}`, message: 'Forma răspunsului de mențiuni s-a schimbat.' })
          complete = false
          break
        }
        for (const m of p.data.data as Mention[]) {
          const reasons = mentionSkipReasons(m)
          if (reasons.length > 0) {
            const platform = m.platform.trim().toLowerCase().replace(/[^\p{L}\p{N}_ .-]+/gu, '_').slice(0, 64)
            const key = `${platform || 'rețea necunoscută'}|${reasons.join('+')}`
            const group = skipped.get(key) ?? { count: 0, filled: new Map(), empty: new Map(), links: new Map() }
            group.count++
            const shape = mentionFieldShape(m as Record<string, unknown>)
            for (const kind of ['filled', 'empty', 'links'] as const) for (const name of new Set(shape[kind])) group[kind].set(name, (group[kind].get(name) ?? 0) + 1)
            skipped.set(key, group)
            continue
          }
          if (hasNoLink(m)) {
            const identity = builtMentionIdentity(m)
            const same = withoutLink.get(identity) ?? []
            same.push({ m, payloadHash: r.payloadHash })
            withoutLink.set(identity, same)
            continue
          }
          mentions.push(competitorMentionRow(m, k.keywordId, { ...provenance, payload_hash: r.payloadHash }))
        }
        const next = p.data.pagination.nextCursor
        if (next === null || next === cursor || p.data.data.length === 0) break
        cursor = next
      }
      if (page === PLANABLE_MAX_PAGES) {
        errors.push({ code: 'pagination_stalled', status: null, dimension: `mentions:${k.keywordId}`, message: `Paginarea nu s-a terminat după ${PLANABLE_MAX_PAGES} pagini.` })
        complete = false
      }
      for (const [identity, same] of withoutLink) {
        const ordered = [...same].sort((a, b) => (a.m.sentiment ?? '').localeCompare(b.m.sentiment ?? ''))
        ordered.forEach(({ m, payloadHash }, i) => mentions.push(competitorMentionRow(m, k.keywordId, { ...provenance, payload_hash: payloadHash }, builtMentionNativeId(identity, i + 1))))
      }
      trackers.push({
        ...scope,
        source: TRACKER_SOURCE_LISTENING,
        external_id: k.keywordId,
        label,
        covered_from: coveredFrom(previous.get(k.keywordId), window.start),
        covered_to: window.end,
        complete,
        last_seen_at: collectedAt,
        source_id: conn.id,
        sync_run_id: handle.id,
      })
    }
    errors.push(...skippedMentionNotes(skipped))
    // Întâi mențiunile, apoi ce s-a citit: un cuvânt apare acoperit doar după ce mențiunile lui sunt scrise.
    rows += await upsertScoped(db, 'competitor_mentions', KEYS.competitor_mentions, mentions, scope)
    rows += await upsertScoped(db, 'competitor_trackers', KEYS.competitor_trackers, trackers, scope)
    return await finish(deps, handle, conn, SOURCE_LISTENING_COMPETITORS, errors, rows, false, now)
  } catch (err) {
    errors.push({ code: 'exception', status: null, message: (err as Error).message })
    return await finish(deps, handle, conn, SOURCE_LISTENING_COMPETITORS, errors, rows, true, now)
  }
}

/** Diferența fusului față de UTC într-un moment dat (ms), din Intl: corectă și la trecerea la ora de vară. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]))
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - instant.getTime()
}

/** Începutul și sfârșitul unei zile calendaristice din fusul dat, ca momente UTC (ISO). */
export function zonedDayBounds(isoDate: string, timeZone: string): { start: string; end: string } {
  const at = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number]
    const guess = Date.UTC(y, m - 1, d)
    const first = guess - tzOffsetMs(new Date(guess), timeZone)
    return guess - tzOffsetMs(new Date(first), timeZone)
  }
  return { start: new Date(at(isoDate)).toISOString(), end: new Date(at(addDaysIso(isoDate, 1)) - 1).toISOString() }
}

/**
 * Planable Competitors (deciziile Y, specificația din 23 nov. 2026): pentru fiecare pagină a workspace-ului pe o platformă
 * suportată, profilurile urmărite (`/pages/{id}/competitors`), urmăritorii pe zi (`/competitors/metrics`) și, pe fiecare zi
 * a ferestrei, postările și interacțiunile lor (`/competitors/comparison` cu fereastra unei zile). Pagina proprie din aceeași
 * comparație se scrie cu `is_own`. Atribuirea profilurilor la competitori se face în SQL, după setul în vigoare.
 * Fără profiluri urmărite: `not_connected`, fără sync_run.
 */
async function runCompetitorProfiles(deps: PlanableDeps, client: PlanableClient, conn: BrandConnection & { brand_id: string }, tz: string, workspaceError: SyncRunError | null, now: () => Date): Promise<PlanableOutcome> {
  const { db } = deps
  const window = lookbackWindow(now(), tz, PLANABLE_LOOKBACK_DAYS)
  const scope = scopeOf(conn)
  const discoveryErrors: SyncRunError[] = []
  const tracked: Array<{ page: Page; competitors: TrackedCompetitor[] }> = []
  if (!workspaceError) {
    const pages = await paginate<Page>(client, '/pages', { workspaceId: conn.external_account_id }, PLANABLE_PAGE_SIZE, (p) => {
      const r = PagesSchema.safeParse(p)
      return r.success ? { items: r.data.data, hasMore: r.data.pagination.hasMore } : null
    }, 'pages')
    if (pages.error) discoveryErrors.push(pages.error)
    for (const { item: page } of pages.items) {
      if (page.workspaceId !== conn.external_account_id || !page.isConnected || !COMPETITOR_PLATFORMS.includes(platformOf(page.platform))) continue
      const r = await client.get(`/pages/${encodeURIComponent(page.id)}/competitors`)
      // 400 = tipul paginii nu are competitor analytics (documentat): nu e o eroare a rulării.
      if (!r.ok) {
        if (r.status !== 400) discoveryErrors.push(httpError(r, `competitors:${page.id}`))
        continue
      }
      const parsed = TrackedCompetitorsSchema.safeParse(r.payload)
      if (!parsed.success) {
        discoveryErrors.push({ code: 'invalid_payload', status: null, dimension: `competitors:${page.id}`, message: 'Forma răspunsului /competitors s-a schimbat.' })
        continue
      }
      if (parsed.data.data.length > 0) tracked.push({ page, competitors: parsed.data.data })
    }
  }
  if (!workspaceError && discoveryErrors.length === 0 && tracked.length === 0) {
    return { tenant_id: conn.tenant_id, brand_id: conn.brand_id, connection_id: conn.id, source: SOURCE_COMPETITORS, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason: 'nicio pagină a workspace-ului nu urmărește competitori în Planable Competitors' }
  }
  const handle = await startSyncRun(db, { ...scope, source: SOURCE_COMPETITORS, source_connection_id: conn.id, period_start: window.start, period_end: window.end }, now)
  const errors: SyncRunError[] = [...discoveryErrors]
  let rows = 0
  try {
    if (workspaceError) return await finish(deps, handle, conn, SOURCE_COMPETITORS, [workspaceError], 0, true, now)
    const collectedAt = now().toISOString()
    const previous = new Map(
      (await db.select<{ external_id: string; covered_from: string | null; covered_to: string }>(
        'competitor_trackers',
        `select=external_id,covered_from,covered_to&tenant_id=eq.${scope.tenant_id}&brand_id=eq.${scope.brand_id}&source=eq.${TRACKER_SOURCE_COMPETITORS}`,
      )).map((t) => [t.external_id, t]),
    )
    const days: string[] = []
    for (let d = window.start; d <= window.end; d = addDaysIso(d, 1)) days.push(d)
    // Rândurile pe (platformă, profil, zi); urmăritorii din serie, postările și interacțiunile din comparația zilei.
    const byKey = new Map<string, Row>()
    const hashes: string[] = []
    const trackers: Row[] = []
    const notes = new Set<string>()
    for (const { page, competitors } of tracked) {
      let complete = true
      const known = new Map<string, TrackedCompetitor>()
      for (const c of competitors) {
        if (c.scrapedPageId) known.set(c.scrapedPageId, c)
        else notes.add(`profilul ${c.handle} (pagina ${page.id}) nu e încă preluat de Planable; apare după prima sincronizare`)
      }
      const byHandle = new Map(competitors.filter((c) => c.scrapedPageId).map((c) => [c.handle.toLowerCase(), c]))
      // Profilul unei intrări: pagina proprie sau competitorul urmărit (după ID, apoi după handle); altfel se sare.
      const profileOf = (e: { id: string; isOwn: boolean; handle?: string | null }) =>
        e.isOwn ? page.id : known.has(e.id) ? e.id : (byHandle.get((e.handle ?? '').toLowerCase())?.scrapedPageId ?? null)
      const rowFor = (e: { id: string; isOwn: boolean; handle?: string | null; displayName?: string | null; platform: string }, date: string): Row | null => {
        const profile = profileOf(e)
        if (!profile) return null
        const p = platformOf(e.platform)
        const platform = /^[a-z_]{1,32}$/.test(p) ? p : platformOf(page.platform)
        const key = `${platform}|${profile}|${date}`
        let row = byKey.get(key)
        if (!row) {
          const c = known.get(profile)
          row = {
            ...scope, platform, profile_id: profile, is_own: e.isOwn,
            handle: (e.isOwn ? (e.handle ?? null) : (c?.handle ?? e.handle ?? null))?.slice(0, 256) ?? null,
            display_name: (e.isOwn ? (e.displayName ?? page.name) : (c?.displayName ?? e.displayName ?? null))?.slice(0, 512) ?? null,
            date, followers: null, posts: null, engagement: null,
            source_id: conn.id, sync_run_id: handle.id, collected_at: collectedAt, schema_version: PLANABLE_COMPETITORS_SCHEMA_VERSION,
          }
          byKey.set(key, row)
        }
        return row
      }
      const bounds = { start: zonedDayBounds(window.start, tz).start, end: zonedDayBounds(window.end, tz).end }
      const series = await client.get(`/pages/${encodeURIComponent(page.id)}/competitors/metrics`, { startDate: bounds.start, endDate: bounds.end })
      const parsedSeries = series.ok ? CompetitorSeriesSchema.safeParse(series.payload) : null
      if (!series.ok) {
        errors.push(httpError(series, `competitors_metrics:${page.id}`))
        complete = false
      } else if (!parsedSeries?.success) {
        errors.push({ code: 'invalid_payload', status: null, dimension: `competitors_metrics:${page.id}`, message: 'Forma răspunsului /competitors/metrics s-a schimbat.' })
        complete = false
      } else {
        hashes.push(series.payloadHash)
        for (const e of parsedSeries.data.data) {
          for (const pt of e.points) {
            const at = new Date(pt.date)
            if (Number.isNaN(at.getTime())) continue
            const date = calendarDateIn(at, tz)
            if (date < window.start || date > window.end) continue
            const row = rowFor(e, date)
            if (row && pt.followers !== null && pt.followers >= 0) row.followers = pt.followers
          }
        }
      }
      for (const day of days) {
        const b = zonedDayBounds(day, tz)
        const r = await client.get(`/pages/${encodeURIComponent(page.id)}/competitors/comparison`, { startDate: b.start, endDate: b.end })
        if (!r.ok) {
          errors.push(httpError(r, `competitors_comparison:${page.id}:${day}`))
          complete = false
          continue
        }
        const parsed = CompetitorComparisonSchema.safeParse(r.payload)
        if (!parsed.success) {
          errors.push({ code: 'invalid_payload', status: null, dimension: `competitors_comparison:${page.id}:${day}`, message: 'Forma răspunsului /competitors/comparison s-a schimbat.' })
          complete = false
          continue
        }
        hashes.push(r.payloadHash)
        for (const e of parsed.data.data) {
          const row = rowFor(e, day)
          if (!row) continue
          if (e.posts !== null && e.posts >= 0) row.posts = e.posts
          if (e.totalEngagement !== null && e.totalEngagement >= 0) row.engagement = e.totalEngagement
        }
      }
      for (const c of known.values()) {
        const label = c.handle.trim()
        if (!label) continue
        trackers.push({
          ...scope, source: TRACKER_SOURCE_COMPETITORS, external_id: c.scrapedPageId, label: label.slice(0, 512), display_name: c.displayName.trim().slice(0, 512) || null,
          covered_from: coveredFrom(previous.get(c.scrapedPageId!), window.start), covered_to: window.end, complete, last_seen_at: collectedAt, source_id: conn.id, sync_run_id: handle.id,
        })
      }
    }
    // Un hash pe rând, din răspunsurile care l-au format (ordinea cererilor e fixă, deci hash-ul e stabil la aceleași date).
    const payloadHash = createHash('sha256').update(hashes.join('|')).digest('hex')
    const daily = [...byKey.values()].map((r) => ({ ...r, payload_hash: payloadHash }))
    for (const n of notes) errors.push({ code: 'parser_note', status: null, message: n })
    // Întâi seria, apoi profilurile: un profil apare acoperit doar după ce zilele lui sunt scrise.
    rows += await upsertScoped(db, 'competitor_social_daily', KEYS.competitor_social_daily, daily, scope)
    rows += await upsertScoped(db, 'competitor_trackers', KEYS.competitor_trackers, trackers, scope)
    return await finish(deps, handle, conn, SOURCE_COMPETITORS, errors, rows, false, now)
  } catch (err) {
    errors.push({ code: 'exception', status: null, message: (err as Error).message })
    return await finish(deps, handle, conn, SOURCE_COMPETITORS, errors, rows, true, now)
  }
}
