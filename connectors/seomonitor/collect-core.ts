// Conectorul SEOmonitor: o rulare per conexiune (cont SEOmonitor al unui client), câte un sync_run per brand mapat.
//
//   validateAccess    → campaigns/tracked (limit 1); 401/403 → token invalid, nimic altceva nu se apelează
//   discoverResources → campanii, grupuri (imbricate), motoare AI activate (ais/stats); maparea → branduri + coadă
//   fetchPage         → paginare completă limit/offset (SeomonitorClient.paginate)
//   normalize         → rânduri tipizate (normalize.ts)
//   reportCoverage    → zile acoperite / zile așteptate per set de date, în sync_runs.coverage
//
// Reimport: ultimele 35 de zile (până ieri, Europe/Bucharest). Un run cu orice eroare nu e niciodată `succeeded`.

import { CallBudget, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { previousCalendarDayInBucharest } from '../shared/dates.ts'
import { getSourceToken, providerCallsToday, recordProviderCalls, utcDay, type TenantConnection } from '../shared/connections.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunHandle, type SyncRunResult } from '../shared/sync-runs.ts'
import type { Db, Row } from '../shared/supabase-rest.ts'
import { SeomonitorClient, type PaginatedResult, type PaginationMode, type Params } from './client.ts'
import {
  SEOMONITOR_CAMPAIGN_PAGE_SIZE,
  SEOMONITOR_DAILY_QUOTA,
  SEOMONITOR_LOOKBACK_DAYS,
  SEOMONITOR_MIN_BUDGET_TO_START,
  SEOMONITOR_PAGE_SIZE,
  SEOMONITOR_SCHEMA_VERSION,
  SPECIAL_GROUP_BRAND,
  type RouteKey,
} from './config.ts'
import { currentMappings, flattenGroups, mappedBrands, resolveGroups, type BrandGroup, type FlatGroup, type MappingRow, type QueueItem } from './mapping.ts'
import {
  brandedKeywordIds,
  enabledEngines,
  normalizeAio,
  normalizeAiVisibility,
  normalizeAisStats,
  normalizeCompetitionAis,
  normalizeDailyRanks,
  normalizeDailyRanksAis,
  normalizeDomain,
  normalizeGroupVisibility,
  normalizeKeywordAis,
  normalizeKeywords,
  toNumber,
  type Ctx,
  type KeywordInfo,
} from './normalize.ts'
import { CampaignSchema, GroupSchema, parseItems, type Group, type ParseIssue } from './schemas.ts'
import { upsertAnswers, upsertRows } from './write.ts'

export type SeomonitorDeps = {
  db: Db
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => Date
  random?: () => number
  dailyQuota?: number
  minBudgetToStart?: number
}

export type BrandRunOutcome = SyncRunResult & { brand_id: string; sync_run_id: string }

export type SeomonitorOutcome = {
  access: 'ok' | 'denied' | 'not_attempted'
  runs: BrandRunOutcome[]
  queue: QueueItem[]
  calls: number
  notes: string[]
}

type Campaign = { id: string; domain: string; maxTracked: { desktop: number | null; mobile: number | null } }

class AbortRun extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

function issuesToErrors(issues: ParseIssue[]): SyncRunError[] {
  return issues.map((i) => ({ code: `parser_${i.code}`, dimension: i.route, status: null, message: i.detail }))
}

export async function collectSeomonitorConnection(deps: SeomonitorDeps, connection: TenantConnection): Promise<SeomonitorOutcome> {
  if (connection.provider !== 'seomonitor') throw new Error(`Conexiunea ${connection.id} nu e SEOmonitor.`)
  const db = deps.db
  const now = deps.now ?? (() => new Date())
  const rangeEnd = previousCalendarDayInBucharest(now())
  const rangeStart = addDays(rangeEnd, -(SEOMONITOR_LOOKBACK_DAYS - 1))
  const dayUtc = utcDay(now())
  const tenant_id = connection.tenant_id
  const notes: string[] = []

  // Maparea curentă (configurare de agenție).
  const mappingRows = await db.select<MappingRow>(
    'seomonitor_group_mappings',
    `select=id,tenant_id,source_id,campaign_id,group_id,version,effective_from,mapping_kind,brand_id,brand_type,is_primary_visibility` +
      `&tenant_id=eq.${tenant_id}&source_id=eq.${connection.id}`,
  )
  if (mappingRows.some((m) => m.tenant_id !== tenant_id || m.source_id !== connection.id)) {
    throw new Error('seomonitor_group_mappings: rând din alt tenant sau altă conexiune; opresc rularea.')
  }
  const mappings = currentMappings(mappingRows, rangeEnd)
  const brands = mappedBrands(mappings)
  if (brands.length === 0) notes.push('nicio mapare de grup → brand: nu se scrie nicio observație (grupurile intră în coadă)')

  // Sync runs per brand (pornite înainte de orice apel, ca orice eșec să fie vizibil).
  const handles = new Map<string, SyncRunHandle>()
  const errors = new Map<string, SyncRunError[]>()
  const written = new Map<string, number>()
  for (const brand_id of brands) {
    handles.set(brand_id, await startSyncRun(db, {
      tenant_id, brand_id, source: 'seomonitor', source_connection_id: connection.id, period_start: rangeStart, period_end: rangeEnd,
    }, now))
    errors.set(brand_id, [])
    written.set(brand_id, 0)
  }
  const pushError = (brand: string | null, e: SyncRunError) => {
    for (const b of brand ? [brand] : brands) errors.get(b)?.push(e)
  }

  const finishAll = async (budgetUsed: number, statusFor: (brand: string) => SyncRunResult['status'], coverage = new Map<string, SyncRunResult['coverage']>()) => {
    const runs: BrandRunOutcome[] = []
    for (const brand_id of brands) {
      const result: SyncRunResult = {
        status: statusFor(brand_id),
        rows_written: written.get(brand_id) ?? 0,
        attempt_count: budgetUsed,
        errors: errors.get(brand_id) ?? [],
        coverage: coverage.get(brand_id),
      }
      await finishSyncRun(db, handles.get(brand_id)!, result, now)
      runs.push({ ...result, brand_id, sync_run_id: handles.get(brand_id)!.id })
    }
    return runs
  }

  // Buget zilnic (UTC; resetarea limitei SEOmonitor nu e documentată).
  const quota = deps.dailyQuota ?? SEOMONITOR_DAILY_QUOTA
  const callsBefore = await providerCallsToday(db, connection.id, dayUtc)
  const remaining = Math.max(0, quota - callsBefore)
  if (remaining < (deps.minBudgetToStart ?? SEOMONITOR_MIN_BUDGET_TO_START)) {
    pushError(null, { code: 'insufficient_budget', status: null, message: `Buget rămas azi (UTC ${dayUtc}): ${remaining}/${quota}. Nicio cerere trimisă.` })
    return { access: 'not_attempted', runs: await finishAll(0, () => 'failed'), queue: [], calls: 0, notes }
  }

  let token: string
  try {
    token = await getSourceToken(db, connection.id)
  } catch (err) {
    pushError(null, { code: 'token_unavailable', status: null, message: (err as Error).message })
    return { access: 'not_attempted', runs: await finishAll(0, () => 'failed'), queue: [], calls: 0, notes }
  }

  const client = new SeomonitorClient({ token, budget: new CallBudget(remaining), fetch: deps.fetch, sleep: deps.sleep, now: () => now().getTime(), random: deps.random })
  const recordCalls = async () => {
    try {
      await recordProviderCalls(db, {
        tenant_id, brand_id: null, source_connection_id: connection.id, call_date_utc: dayUtc,
        purpose: 'collect', calls: client.budget.used,
      })
    } catch (err) {
      pushError(null, { code: 'call_count_not_recorded', status: null, message: (err as Error).message })
    }
  }

  // validateAccess -------------------------------------------------------------------------------
  const access = await client.get('campaigns', { company_id: /^\d+$/.test(connection.external_account_id) ? connection.external_account_id : undefined, limit: 1 })
  if (!access.ok) {
    if (access.kind === 'access_denied') {
      await db.rpc('record_source_validation', { p_connection_id: connection.id, p_ok: false, p_error: `HTTP ${access.status}` }).catch(() => undefined)
      pushError(null, { code: 'access_denied', status: access.status, message: access.message })
    } else {
      pushError(null, { code: access.kind, status: access.status, message: `validateAccess: ${access.message}` })
    }
    await recordCalls()
    return { access: access.kind === 'access_denied' ? 'denied' : 'not_attempted', runs: await finishAll(client.budget.used, () => 'failed'), queue: [], calls: client.budget.used, notes }
  }
  await db.rpc('record_source_validation', { p_connection_id: connection.id, p_ok: true }).catch(() => undefined)

  const collectedAt = () => now().toISOString()
  const stopOn = (r: PaginatedResult, route: string, brand: string | null): boolean => {
    if (r.ok) return false
    pushError(brand, { code: r.kind, dimension: route, status: r.status, message: r.message })
    if (r.kind === 'access_denied') throw new AbortRun('access_denied', r.message)
    if (r.kind === 'budget_exhausted') throw new AbortRun('budget_exhausted', r.message)
    return true
  }
  const fetchAll = (route: RouteKey, params: Params, mode: PaginationMode, pageSize = SEOMONITOR_PAGE_SIZE) =>
    client.paginate(route, params, mode, pageSize)

  let queue: QueueItem[] = []
  const coverage = new Map<string, SyncRunResult['coverage']>()
  const failedBrands = new Set<string>()
  let aborted: AbortRun | null = null

  try {
    // discoverResources ------------------------------------------------------------------------------
    const campaigns = new Map<string, Campaign>()
    const campaignsResult = await fetchAll('campaigns', {
      company_id: /^\d+$/.test(connection.external_account_id) ? connection.external_account_id : undefined,
    }, 'until_short_page', SEOMONITOR_CAMPAIGN_PAGE_SIZE)
    if (stopOn(campaignsResult, 'campaigns', null)) throw new AbortRun('discovery_failed', 'Campaniile nu au putut fi citite.')
    for (const page of campaignsResult.pages) {
      const { items, issues } = parseItems('campaigns', CampaignSchema, page.payload,
        ['campaign_info', 'visibility', 'multiple_locations', 'health_status', 'objective_status', 'reporting_status', 'account_manager'])
      for (const e of issuesToErrors(issues)) pushError(null, e)
      for (const c of items) {
        campaigns.set(String(c.campaign_info.id), {
          id: String(c.campaign_info.id),
          domain: normalizeDomain(c.campaign_info.domain),
          maxTracked: { desktop: toNumber(c.campaign_info.max_tracked_position_desktop), mobile: toNumber(c.campaign_info.max_tracked_position_mobile) },
        })
      }
    }

    const discovered: FlatGroup[] = []
    const groupHash = new Map<string, string>()
    const engines = new Map<string, string[]>()
    for (const campaign of campaigns.values()) {
      const groups = await fetchAll('groups', { campaign_id: campaign.id }, 'none')
      if (stopOn(groups, `groups:${campaign.id}`, null)) continue
      const page = groups.pages[0]
      if (page) {
        const { items, issues } = parseItems('groups', GroupSchema as never, page.payload, ['group_id', 'name', 'type', 'subgroups'])
        for (const e of issuesToErrors(issues)) pushError(null, e)
        const flat = flattenGroups(campaign.id, items as Group[])
        for (const g of flat) groupHash.set(`${g.campaign_id}|${g.group_id}`, page.payloadHash)
        discovered.push(...flat)
      }
      const stats = await fetchAll('aisStats', { campaign_id: campaign.id, start_date: rangeStart, end_date: rangeEnd }, 'none')
      if (!stopOn(stats, `ais/stats:${campaign.id}`, null) && stats.pages[0]) {
        const { engines: enabled, issues } = enabledEngines(stats.pages[0].payload)
        for (const e of issuesToErrors(issues)) pushError(null, e)
        engines.set(campaign.id, enabled)
      }
    }

    const resolution = resolveGroups(discovered, mappings)
    queue = resolution.queue
    notes.push(...resolution.notes)
    if (queue.length) {
      await upsertRows(db, 'seomonitor_mapping_queue', queue.map((q) => ({
        tenant_id, source_id: connection.id, ...q, last_seen_at: collectedAt(),
      })), { tenant_id })
    }
    for (const q of queue.filter((x) => x.reason === 'mapped_group_missing')) {
      const m = mappings.get(`${q.campaign_id}|${q.group_id}`)
      if (m?.brand_id) pushError(m.brand_id, { code: 'mapped_group_missing', dimension: `group:${q.group_id}`, status: null, message: 'Grupul mapat nu mai apare în SEOmonitor.' })
    }

    // Per brand -------------------------------------------------------------------------------------
    const brandedCache = new Map<string, Set<string> | null>()
    for (const brand_id of brands) {
      const scope = { tenant_id, brand_id }
      const add = (n: number) => written.set(brand_id, (written.get(brand_id) ?? 0) + n)
      const seenDays: Record<string, Set<string>> = { ranks: new Set(), visibility: new Set(), ai_answers: new Set() }
      const handle = handles.get(brand_id)!

      for (const bg of resolution.byBrand.get(brand_id) ?? []) {
        const campaign = campaigns.get(bg.group.campaign_id)
        if (!campaign) {
          pushError(brand_id, { code: 'campaign_not_found', dimension: `campaign:${bg.group.campaign_id}`, status: null, message: 'Campania nu e în lista Tracked Campaigns.' })
          continue
        }
        const ctx: Ctx = {
          tenant_id, brand_id, source_id: connection.id, campaign_id: campaign.id, sync_run_id: handle.id,
          collected_at: collectedAt(), domain: campaign.domain, maxTracked: campaign.maxTracked, rangeStart, rangeEnd, group: bg,
        }
        const base = { campaign_id: campaign.id, start_date: rangeStart, end_date: rangeEnd }

        // Grupul.
        add((await upsertRows(db, 'keyword_groups', [{
          tenant_id, brand_id, source_id: connection.id, campaign_id: campaign.id, group_id: bg.group.group_id,
          parent_group_id: bg.group.parent_group_id, name: bg.group.name || bg.group.group_id,
          group_type: ['group', 'folder', 'smart'].includes(bg.group.type) ? bg.group.type : 'group',
          brand_type: bg.mapping.brand_type, mapping_version: bg.mapping.version, sync_run_id: handle.id,
          collected_at: ctx.collected_at, payload_hash: groupHash.get(`${campaign.id}|${bg.group.group_id}`) ?? '0'.repeat(64),
          schema_version: SEOMONITOR_SCHEMA_VERSION,
        }], scope)).length)

        // Keywords branded (Brand folder, group_id = -1), o dată per campanie.
        if (!brandedCache.has(campaign.id)) {
          const r = await fetchAll('keywords', { ...base, group_id: SPECIAL_GROUP_BRAND }, 'until_short_page')
          brandedCache.set(campaign.id, stopOn(r, 'keywords:brand', brand_id) ? null
            : new Set(r.pages.flatMap((p) => [...brandedKeywordIds(p.payload)])))
        }
        const branded = brandedCache.get(campaign.id) ?? null

        // Keywords active din grup.
        const keywordInfo = new Map<string, KeywordInfo>()
        const kw = await fetchAll('keywords', { ...base, group_id: bg.group.group_id }, 'until_short_page')
        if (!stopOn(kw, 'keywords', brand_id)) {
          for (const page of kw.pages) {
            const n = normalizeKeywords(page.payload, ctx, page.payloadHash, branded)
            for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
            for (const i of n.info) keywordInfo.set(i.keyword_id, i)
            add((await upsertRows(db, 'keywords', n.rows, scope)).length)
          }
        }

        // Rankuri zilnice: active, apoi arhivate.
        for (const status of ['active', 'archived'] as const) {
          const r = await fetchAll('dailyRanks', { ...base, group_id: bg.group.group_id, get_archive: status === 'archived' ? 'true' : undefined }, 'until_short_page')
          if (stopOn(r, `daily-ranks:${status}`, brand_id)) continue
          for (const page of r.pages) {
            const n = normalizeDailyRanks(page.payload, ctx, page.payloadHash, keywordInfo, status)
            for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
            if (n.archivedKeywords.length) {
              add((await upsertRows(db, 'keywords', n.archivedKeywords.map((k) => ({
                tenant_id, brand_id, source_id: connection.id, campaign_id: campaign.id, keyword_id: k.keyword_id, keyword: k.keyword,
                group_ids: [], status: 'archived', archived_detected_at: ctx.collected_at, sync_run_id: handle.id,
                collected_at: ctx.collected_at, payload_hash: page.payloadHash, schema_version: SEOMONITOR_SCHEMA_VERSION,
              })), scope)).length)
            }
            for (const row of n.rows) seenDays.ranks!.add(String(row.date))
            add((await upsertRows(db, 'rank_observations', n.rows, scope)).length)
          }
        }

        // Visibility pe grup.
        const vis = await fetchAll('groupVisibility', { ...base, group_id: bg.group.group_id }, 'none')
        if (!stopOn(vis, 'groups/daily-visibility', brand_id) && vis.pages[0]) {
          const n = normalizeGroupVisibility(vis.pages[0].payload, ctx, vis.pages[0].payloadHash)
          for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
          for (const row of n.rows) if (row.visibility !== null) seenDays.visibility!.add(String(row.date))
          add((await upsertRows(db, 'seomonitor_group_visibility_daily', n.rows, scope)).length)
        }

        // AI Search: doar motoarele activate (un motor neactivat întoarce gol, nu eroare).
        const campaignEngines = engines.get(campaign.id)
        if (campaignEngines === undefined) {
          pushError(brand_id, { code: 'ai_engines_unknown', dimension: 'ais/stats', status: null, message: 'Motoarele AI activate nu au putut fi citite; AI Search necolectat.' })
        }
        for (const engine of campaignEngines ?? []) {
          const ais = await fetchAll('keywordsAis', { ...base, group_id: bg.group.group_id, ai_search_llm: engine, content_format: 'markdown', include_raw_content: 'true' }, 'until_empty_page')
          if (!stopOn(ais, `keywords/ais:${engine}`, brand_id)) {
            for (const page of ais.pages) {
              const n = normalizeKeywordAis(page.payload, ctx, page.payloadHash, engine)
              for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
              for (const a of n.answers) seenDays.ai_answers!.add(String(a.crawl_at))
              add(await upsertAnswers(db, n.answers, n.originals, scope))
              add((await upsertRows(db, 'ai_citations', n.citations, scope)).length)
            }
          }
          const ranksAis = await fetchAll('dailyRanksAis', { ...base, group_id: bg.group.group_id, ai_search_llm: engine }, 'until_short_page')
          if (!stopOn(ranksAis, `keywords/daily-ranks/ais:${engine}`, brand_id)) {
            for (const page of ranksAis.pages) {
              const n = normalizeDailyRanksAis(page.payload, ctx, page.payloadHash, engine)
              for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
              add((await upsertRows(db, 'ai_brand_observations', n.rows, scope)).length)
            }
          }
          const comp = await fetchAll('competitionAis', { ...base, group_id: bg.group.group_id, ai_search_llm: engine }, 'until_short_page')
          if (!stopOn(comp, `keywords/competition/ais:${engine}`, brand_id)) {
            for (const page of comp.pages) {
              const n = normalizeCompetitionAis(page.payload, ctx, page.payloadHash, engine)
              for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
              add((await upsertRows(db, 'ai_brand_observations', n.rows, scope)).length)
            }
          }
          for (const [route, metric] of [['aisMentions', 'brand_mentions'], ['aisCitations', 'site_citations']] as const) {
            const r = await fetchAll(route, { ...base, group_id: bg.group.group_id, ai_search_llm: engine }, 'none')
            if (!stopOn(r, `${route}:${engine}`, brand_id) && r.pages[0]) {
              const n = normalizeAiVisibility(r.pages[0].payload, ctx, r.pages[0].payloadHash, engine, metric)
              for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
              add((await upsertRows(db, 'seomonitor_ai_visibility_daily', n.rows, scope)).length)
            }
          }
          const st = await fetchAll('aisStats', { ...base, group_id: bg.group.group_id, gpt_provider: engine }, 'none')
          if (!stopOn(st, `ais/stats:${engine}`, brand_id) && st.pages[0]) {
            const n = normalizeAisStats(st.pages[0].payload, ctx, st.pages[0].payloadHash, engine)
            for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
            add((await upsertRows(db, 'seomonitor_ai_engine_stats', n.rows, scope)).length)
          }
        }

        // Google AI Overview.
        const aio = await fetchAll('aio', { ...base, group_id: bg.group.group_id, content_format: 'markdown', include_raw_content: 'true' }, 'until_empty_page')
        if (!stopOn(aio, 'keywords/aio', brand_id)) {
          for (const page of aio.pages) {
            const n = normalizeAio(page.payload, ctx, page.payloadHash)
            for (const e of issuesToErrors(n.issues)) pushError(brand_id, e)
            for (const a of n.answers) seenDays.ai_answers!.add(String(a.crawl_at))
            add(await upsertAnswers(db, n.answers, n.originals, scope))
            add((await upsertRows(db, 'ai_citations', n.citations, scope)).length)
          }
        }
      }

      // reportCoverage.
      coverage.set(brand_id, Object.fromEntries(Object.entries(seenDays).map(([dataset, days]) => [dataset, {
        expected_days: SEOMONITOR_LOOKBACK_DAYS,
        covered_days: days.size,
        coverage: Math.round((days.size / SEOMONITOR_LOOKBACK_DAYS) * 10_000) / 10_000,
      }])))
    }
  } catch (err) {
    if (err instanceof AbortRun) {
      aborted = err
      if (err.code === 'access_denied') {
        await db.rpc('record_source_validation', { p_connection_id: connection.id, p_ok: false, p_error: err.message }).catch(() => undefined)
      }
    } else {
      pushError(null, { code: 'exception', status: null, message: (err as Error).message })
      for (const b of brands) failedBrands.add(b)
    }
  }

  await recordCalls()
  const isNote = (e: SyncRunError) => e.code.startsWith('parser_unknown_field')
  const runs = await finishAll(client.budget.used, (brand) => {
    if (failedBrands.has(brand) || aborted?.code === 'access_denied' || aborted?.code === 'discovery_failed') return 'failed'
    const errs = (errors.get(brand) ?? []).filter((e) => !isNote(e))
    if ((written.get(brand) ?? 0) === 0 && errs.length) return 'failed'
    return errs.length || aborted ? 'partial' : 'succeeded'
  }, coverage)
  return { access: 'ok', runs, queue, calls: client.budget.used, notes }
}

export type { Row }
export type { BrandGroup }
