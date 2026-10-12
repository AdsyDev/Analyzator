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
import { isValidTimeZone, lookbackWindow } from '../google/dates.ts'
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
  SOURCE_LISTENING,
} from './config.ts'
import {
  KeywordsSchema,
  MentionsSchema,
  PageMetricsSchema,
  PagesSchema,
  PostMetricsSchema,
  PostsSchema,
  WorkspacesSchema,
  mentionRow,
  socialDailyRows,
  socialPostRow,
  type Mention,
  type Page,
  type PageMetricsItem,
  type Post,
} from './normalize.ts'

export type PlanableSource = typeof SOURCE_ANALYTICS | typeof SOURCE_LISTENING

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
    for (const source of [SOURCE_ANALYTICS, SOURCE_LISTENING] as const) {
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
  const keywords = kw?.ok ? KeywordsSchema.safeParse(kw.payload) : null
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
    const mentions: Row[] = []
    for (const k of keywords.data.data) {
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
          if (!/^https?:\/\//.test(m.url) || Number.isNaN(Date.parse(m.publishedAt))) {
            errors.push({ code: 'parser_note', status: null, message: 'mențiune fără URL sau dată validă, sărită' })
            continue
          }
          mentions.push(mentionRow(m, { ...provenance, payload_hash: r.payloadHash }))
        }
        const next = parsed.data.pagination.nextCursor
        if (next === null || next === cursor || parsed.data.data.length === 0) break
        cursor = next
      }
    }

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
