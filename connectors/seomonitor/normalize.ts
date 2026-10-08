// Normalizarea răspunsurilor SEOmonitor în rândurile tabelelor tipizate.
// Reguli: valorile absente rămân NULL (0 rămâne 0); rank absent nu primește 100; răspunsurile AI au patru stări.

import { SEOMONITOR_SCHEMA_VERSION } from './config.ts'
import {
  AioSchema,
  AisCitationsSchema,
  AisMentionsSchema,
  AisStatsSchema,
  CompetitionAisSchema,
  DailyRanksAisSchema,
  DailyRanksSchema,
  GroupVisibilitySchema,
  KeywordAisSchema,
  KeywordSchema,
  parseItems,
  type ParseIssue,
} from './schemas.ts'
import type { BrandGroup } from './mapping.ts'

export type Provenance = {
  tenant_id: string
  brand_id: string
  source_id: string
  campaign_id: string
  sync_run_id: string
  collected_at: string
  payload_hash: string
  schema_version: string
}

export type Ctx = {
  tenant_id: string
  brand_id: string
  source_id: string
  campaign_id: string
  sync_run_id: string
  collected_at: string
  domain: string
  maxTracked: { desktop: number | null; mobile: number | null }
  rangeStart: string
  rangeEnd: string
  group: BrandGroup
}

export type Normalized<T> = { rows: T[]; issues: ParseIssue[] }

export type AiStatus = 'technical_error' | 'refusal' | 'brand_absent' | 'brand_present'

// --- Valori ------------------------------------------------------------------------------------------

/** Număr sau NULL. '' și null → NULL; "18.5059" → 18.5059; 0 → 0. */
export function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null
    return Number(t)
  }
  return null
}

const original = (raw: unknown): string | null => (raw === undefined ? null : raw === null ? 'null' : String(raw))

/** Host normalizat: fără protocol, fără www., litere mici. */
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return 'unknown'
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

export function isOwnDomain(url: string, domain: string): boolean {
  const host = normalizeDomain(url)
  return host === domain || host.endsWith(`.${domain}`)
}

export type RankParse = { rank: number | null; rank_status: 'ranked' | 'not_ranked' | 'at_tracking_limit' | 'invalid'; rank_original: string | null }

/**
 * Rank Google zilnic. Documentația nu spune ce întoarce un keyword care nu se clasează:
 * lipsă/null/'' → not_ranked; valoare >= poziția maximă urmărită → at_tracking_limit (ambiguu, NU poziția 100);
 * <= 0 sau nenumeric → invalid. În toate cazurile, rank_original păstrează valoarea primită.
 */
export function parseRank(raw: unknown, maxTracked: number | null): RankParse {
  const o = original(raw)
  if (raw === undefined || raw === null || raw === '') return { rank: null, rank_status: 'not_ranked', rank_original: o }
  const n = toNumber(raw)
  if (n === null || !Number.isInteger(n) || n <= 0) return { rank: null, rank_status: 'invalid', rank_original: o }
  if (n >= (maxTracked ?? 100)) return { rank: null, rank_status: 'at_tracking_limit', rank_original: o }
  return { rank: n, rank_status: 'ranked', rank_original: o }
}

/** AI Overview: `rank = 100` înseamnă „not present" (documentat) → NULL. */
export function parseAioRank(raw: unknown): { rank: number | null; rank_original: string | null } {
  const n = toNumber(raw)
  return { rank: n !== null && Number.isInteger(n) && n >= 1 && n < 100 ? n : null, rank_original: original(raw) }
}

/**
 * Starea unui răspuns AI. Prezența brandului vine din câmpul explicit (my_brand_present / brand_presence);
 * fără el, absența nu se poate deduce → technical_error. Un semnal de refuz nu e documentat: `refusal` nu se
 * atribuie automat (rămâne rezervat pentru un câmp documentat sau revizuire umană).
 */
export function aiStatus(brandPresent: boolean | null | undefined): AiStatus {
  if (brandPresent === true) return 'brand_present'
  if (brandPresent === false) return 'brand_absent'
  return 'technical_error'
}

/** Conținut afișabil: fără HTML (inclusiv <script>), fără linkuri javascript:, fără caractere de control. */
export function sanitizeContent(raw: string | null | undefined, maxLength = 100_000): string | null {
  if (raw === null || raw === undefined) return null
  let s = raw
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\]\(\s*javascript:(?:[^()\s]|\([^()]*\))*\)/gi, '](#)')
    .replace(/javascript:/gi, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  if (s.length > maxLength) s = s.slice(0, maxLength)
  return s.trim() === '' ? null : s
}

function decodeIfBase64(value: string | null | undefined, encoding: string | undefined): string | null {
  if (value === null || value === undefined) return null
  return encoding === 'base64' ? Buffer.from(value, 'base64').toString('utf8') : value
}

const sentimentOf = (s: unknown) => (s === 'positive' || s === 'neutral' || s === 'negative' ? s : null)

function provenance(ctx: Ctx, payloadHash: string): Provenance & { mapping_version: number } {
  return {
    tenant_id: ctx.tenant_id,
    brand_id: ctx.brand_id,
    source_id: ctx.source_id,
    campaign_id: ctx.campaign_id,
    sync_run_id: ctx.sync_run_id,
    collected_at: ctx.collected_at,
    payload_hash: payloadHash,
    schema_version: SEOMONITOR_SCHEMA_VERSION,
    mapping_version: ctx.group.mapping.version,
  }
}

const KEYWORD_KEYS = ['keyword_id', 'keyword', 'main_keyword_id', 'search_intent', 'labels', 'groups', 'serp_data', 'search_data',
  'percentage_clicks', 'ranking_data', 'ai_overview', 'ai_search', 'landing_pages', 'traffic_data', 'opportunity', 'last_updated']

// --- Keywords ----------------------------------------------------------------------------------------

export type KeywordInfo = { keyword_id: string; keyword: string; search_volume: number | null; landing: { desktop: string | null; mobile: string | null } }

function groupIds(raw: unknown): string[] {
  if (raw === null || raw === undefined || raw === '') return []
  if (Array.isArray(raw)) return raw.map(String).filter((x) => /^-?\d+$/.test(x))
  return String(raw).split(',').map((x) => x.trim()).filter((x) => /^-?\d+$/.test(x))
}

export function normalizeKeywords(payload: unknown, ctx: Ctx, payloadHash: string, branded: Set<string> | null) {
  const { items, issues } = parseItems('keywords', KeywordSchema, payload, KEYWORD_KEYS)
  const p = provenance(ctx, payloadHash)
  const info: KeywordInfo[] = []
  const rows = items.map((k) => {
    const keywordId = String(k.keyword_id)
    const sv = toNumber(k.search_data?.search_volume)
    info.push({
      keyword_id: keywordId,
      keyword: k.keyword,
      search_volume: sv,
      landing: { desktop: k.landing_pages?.desktop?.current || null, mobile: k.landing_pages?.mobile?.current || null },
    })
    const { mapping_version: _mv, ...prov } = p
    return {
      ...prov,
      keyword_id: keywordId,
      keyword: k.keyword,
      main_keyword_id: k.main_keyword_id ? String(k.main_keyword_id) : null,
      search_intent: k.search_intent || null,
      labels: k.labels || null,
      is_branded: branded ? branded.has(keywordId) : null,
      search_volume: sv,
      group_ids: groupIds(k.groups),
      status: 'active' as const,
      archived_detected_at: null,
      last_updated: k.last_updated && /^\d{4}-\d{2}-\d{2}$/.test(k.last_updated) ? k.last_updated : null,
    }
  })
  return { rows, issues, info }
}

export function brandedKeywordIds(payload: unknown): Set<string> {
  const { items } = parseItems('keywords:branded', KeywordSchema, payload, KEYWORD_KEYS)
  return new Set(items.map((k) => String(k.keyword_id)))
}

// --- Rankuri -----------------------------------------------------------------------------------------

export function normalizeDailyRanks(
  payload: unknown,
  ctx: Ctx,
  payloadHash: string,
  keywordInfo: Map<string, KeywordInfo>,
  keywordStatus: 'active' | 'archived',
) {
  const { items, issues } = parseItems('daily-ranks', DailyRanksSchema, payload, ['keyword_id', 'keyword', 'ranking_data'])
  const p = provenance(ctx, payloadHash)
  const rows: Record<string, unknown>[] = []
  const archivedKeywords: Array<{ keyword_id: string; keyword: string }> = []
  for (const item of items) {
    const keywordId = String(item.keyword_id)
    if (keywordStatus === 'archived') archivedKeywords.push({ keyword_id: keywordId, keyword: item.keyword })
    const info = keywordInfo.get(keywordId)
    for (const device of ['desktop', 'mobile'] as const) {
      for (const entry of item.ranking_data[device] ?? []) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
          issues.push({ code: 'invalid_item', route: 'daily-ranks', detail: `dată invalidă ${entry.date}` })
          continue
        }
        const parsed = parseRank(entry.rank, ctx.maxTracked[device])
        rows.push({
          ...p,
          keyword_id: keywordId,
          device,
          date: entry.date,
          domain: ctx.domain,
          url: entry.date === ctx.rangeEnd ? info?.landing[device] ?? null : null,
          ...parsed,
          search_volume: info?.search_volume ?? null,
          keyword_status: keywordStatus,
          attributed_group_id: ctx.group.group.group_id,
          window_days: 1,
        })
      }
    }
  }
  return { rows, issues, archivedKeywords }
}

// --- Visibility pe grupuri ---------------------------------------------------------------------------

export function normalizeGroupVisibility(payload: unknown, ctx: Ctx, payloadHash: string) {
  const { items, issues } = parseItems('groups/daily-visibility', GroupVisibilitySchema, payload,
    ['date', 'visibility', 'avg_rank', 'feature_visibility', 'ai_search', 'feature_visibility_breakdown'])
  const p = provenance(ctx, payloadHash)
  const rows = items.flatMap((d) =>
    (['desktop', 'mobile'] as const).map((device) => ({
      ...p,
      group_id: ctx.group.group.group_id,
      date: d.date,
      device,
      domain: ctx.domain,
      visibility: toNumber(d.visibility?.[device]),
      visibility_original: original(d.visibility?.[device]),
      avg_rank: toNumber(d.avg_rank?.[device]),
      is_primary: ctx.group.mapping.is_primary_visibility,
      window_days: 1,
    })),
  )
  return { rows, issues }
}

// --- AI Search ---------------------------------------------------------------------------------------

export function normalizeKeywordAis(payload: unknown, ctx: Ctx, payloadHash: string, engine: string) {
  const { items, issues } = parseItems('keywords/ais', KeywordAisSchema, payload, ['keyword_id', 'keyword', 'ai_search_data'])
  const p = provenance(ctx, payloadHash)
  const answers: Record<string, unknown>[] = []
  const originals: Array<{ key: string; raw_content: string | null; raw_format: string }> = []
  const citations: Record<string, unknown>[] = []
  for (const item of items) {
    const keywordId = String(item.keyword_id)
    for (const e of item.ai_search_data ?? []) {
      const status = aiStatus(e.my_brand_present)
      const rankValue = toNumber(e.rank)
      const urls = (e.citations ?? []).filter((u) => /^https?:\/\//i.test(u))
      answers.push({
        ...p,
        engine,
        surface: 'ai_search',
        device: 'none',
        keyword_id: keywordId,
        crawl_at: e.date,
        era: e.era === 'keyword' || e.era === 'question' ? e.era : null,
        content: sanitizeContent(decodeIfBase64(e.content, e.encoding)),
        content_format: 'markdown',
        citations: urls,
        my_brand_present: e.my_brand_present ?? null,
        any_brand_present: e.any_brand_present ?? null,
        // Rankul are sens doar când brandul e prezent.
        rank: status === 'brand_present' && rankValue !== null && Number.isInteger(rankValue) && rankValue >= 1 ? rankValue : null,
        rank_original: original(e.rank),
        sentiment: sentimentOf(e.sentiment_of_my_brand),
        status,
        attributed_group_id: ctx.group.group.group_id,
        window_days: 1,
      })
      originals.push({ key: `${engine}|${keywordId}|${e.date}|none`, raw_content: decodeIfBase64(e.raw_content ?? e.content, e.encoding), raw_format: e.raw_content ? 'html' : 'markdown' })
      urls.forEach((url, i) =>
        citations.push({
          tenant_id: p.tenant_id, brand_id: p.brand_id, source_id: p.source_id, sync_run_id: p.sync_run_id,
          collected_at: p.collected_at, payload_hash: p.payload_hash, schema_version: p.schema_version,
          engine, device: 'none', keyword_id: keywordId, crawl_at: e.date, url, position: i + 1, is_own_domain: isOwnDomain(url, ctx.domain),
        }),
      )
    }
  }
  return { answers, originals, citations, issues }
}

export function normalizeDailyRanksAis(payload: unknown, ctx: Ctx, payloadHash: string, engine: string) {
  const { items, issues } = parseItems('keywords/daily-ranks/ais', DailyRanksAisSchema, payload, ['keyword_id', 'keyword', 'ranking_data'])
  const p = provenance(ctx, payloadHash)
  const rows = items.flatMap((item) =>
    (item.ranking_data ?? []).map((r) => {
      const status = aiStatus(r.my_brand_present)
      const n = toNumber(r.rank)
      return {
        ...p,
        engine,
        device: 'none',
        keyword_id: String(item.keyword_id),
        crawl_at: r.date,
        observed_domain: ctx.domain,
        is_own_brand: true,
        present: r.my_brand_present ?? null,
        any_brand_present: r.any_brand_present ?? null,
        rank: status === 'brand_present' && n !== null && Number.isInteger(n) && n >= 1 ? n : null,
        rank_original: original(r.rank),
        rank_trend: null,
        sentiment: sentimentOf(r.sentiment_of_my_brand),
        status,
        attributed_group_id: ctx.group.group.group_id,
        window_days: 7,
      }
    }),
  )
  return { rows, issues }
}

/** Concurenții: fără dată per observație → crawl_at = end_date, window_days = lungimea intervalului. */
export function normalizeCompetitionAis(payload: unknown, ctx: Ctx, payloadHash: string, engine: string) {
  const { items, issues } = parseItems('keywords/competition/ais', CompetitionAisSchema, payload, ['keyword_id', 'keyword', 'competitors'])
  const p = provenance(ctx, payloadHash)
  const days = Math.round((Date.parse(ctx.rangeEnd) - Date.parse(ctx.rangeStart)) / 86_400_000) + 1
  const rows = items.flatMap((item) =>
    (item.competitors ?? []).map((c) => ({
      ...p,
      engine,
      device: 'none',
      keyword_id: String(item.keyword_id),
      crawl_at: ctx.rangeEnd,
      observed_domain: normalizeDomain(c.domain),
      is_own_brand: false,
      present: c.competitor_brand_present ?? null,
      any_brand_present: c.any_brand_present ?? null,
      // Documentația descrie `rank` ca poziție organică Google, iar ruta ca poziții de citare AI: ambiguu, nu-l interpretăm.
      rank: null,
      rank_original: original(c.rank),
      rank_trend: toNumber(c.rank_trend),
      sentiment: null,
      status: aiStatus(c.competitor_brand_present),
      attributed_group_id: ctx.group.group.group_id,
      window_days: days,
    })),
  )
  return { rows, issues }
}

export function normalizeAiVisibility(payload: unknown, ctx: Ctx, payloadHash: string, engine: string, metric: 'brand_mentions' | 'site_citations') {
  const schema = metric === 'brand_mentions' ? AisMentionsSchema : AisCitationsSchema
  const field = metric === 'brand_mentions' ? 'brand_presence_visibility' : 'source_citation_visibility'
  const { items, issues } = parseItems(`groups/daily-visibility/ais-${metric}`, schema as typeof AisMentionsSchema, payload, ['date', field])
  const p = provenance(ctx, payloadHash)
  const rows = items.map((d) => {
    const raw = (d as Record<string, unknown>)[field]
    return { ...p, group_id: ctx.group.group.group_id, date: d.date, engine, metric, value: toNumber(raw), value_original: original(raw), window_days: 1 }
  })
  return { rows, issues }
}

export function enabledEngines(payload: unknown): { engines: string[]; issues: ParseIssue[] } {
  const parsed = AisStatsSchema.safeParse(payload)
  if (!parsed.success) return { engines: [], issues: [{ code: 'invalid_item', route: 'ais/stats', detail: parsed.error.issues[0]?.message ?? 'invalid' }] }
  return { engines: parsed.data.engines.filter((e) => e.enabled === true).map((e) => e.engine), issues: [] }
}

export function normalizeAisStats(payload: unknown, ctx: Ctx, payloadHash: string, engine: string) {
  const parsed = AisStatsSchema.safeParse(payload)
  if (!parsed.success) return { rows: [], issues: [{ code: 'invalid_item' as const, route: 'ais/stats', detail: parsed.error.issues[0]?.message ?? 'invalid' }] }
  const p = provenance(ctx, payloadHash)
  const meta = parsed.data.engines.find((e) => e.engine === engine)
  const s = parsed.data.stats[engine]
  if (!s && !meta) return { rows: [], issues: [] }
  return {
    rows: [{
      ...p,
      group_id: ctx.group.group.group_id,
      engine,
      period_start: ctx.rangeStart,
      period_end: ctx.rangeEnd,
      enabled: meta?.enabled ?? null,
      last_crawl_date: meta?.last_crawl_date ?? null,
      presence_rate: toNumber(s?.presence_rate),
      presence_trend: toNumber(s?.presence_trend),
      source_citations: toNumber(s?.source_citations),
      source_citations_trend: toNumber(s?.source_citations_trend),
      avg_position: toNumber(s?.avg_position),
      avg_position_trend: toNumber(s?.avg_position_trend),
      sentiment_positive: toNumber(s?.sentiment?.positive),
      sentiment_neutral: toNumber(s?.sentiment?.neutral),
      sentiment_negative: toNumber(s?.sentiment?.negative),
      missing_data: s?.missing_data ?? null,
      missing_data_reason: s?.missing_data_reason ?? null,
      calculated_from: s?.calculated_from ?? null,
    }],
    issues: [],
  }
}

// --- AI Overview -------------------------------------------------------------------------------------

export function normalizeAio(payload: unknown, ctx: Ctx, payloadHash: string) {
  const { items, issues } = parseItems('keywords/aio', AioSchema, payload, ['keyword_id', 'keyword', 'sge_widget_data'])
  const p = provenance(ctx, payloadHash)
  const answers: Record<string, unknown>[] = []
  const originals: Array<{ key: string; raw_content: string | null; raw_format: string }> = []
  const citations: Record<string, unknown>[] = []
  for (const item of items) {
    const keywordId = String(item.keyword_id)
    for (const device of ['desktop', 'mobile'] as const) {
      for (const [dateKey, e] of Object.entries(item.sge_widget_data?.[device] ?? {})) {
        const date = e.date ?? dateKey
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          issues.push({ code: 'invalid_item', route: 'keywords/aio', detail: `dată invalidă ${date}` })
          continue
        }
        const urls = (e.links ?? []).filter((u) => /^https?:\/\//i.test(u))
        answers.push({
          ...p,
          engine: 'google_ai_overview',
          surface: 'ai_overview',
          device,
          keyword_id: keywordId,
          crawl_at: date,
          era: null,
          content: sanitizeContent(decodeIfBase64(e.content, e.encoding)),
          content_format: 'markdown',
          citations: urls,
          my_brand_present: e.brand_presence ?? null,
          any_brand_present: e.brand_presence_any ?? null,
          ...parseAioRank(e.rank),
          sentiment: null,
          status: aiStatus(e.brand_presence),
          attributed_group_id: ctx.group.group.group_id,
          window_days: 1,
        })
        originals.push({ key: `google_ai_overview|${keywordId}|${date}|${device}`, raw_content: decodeIfBase64(e.raw_content ?? e.content, e.encoding), raw_format: e.raw_content ? 'html' : 'markdown' })
        urls.forEach((url, i) =>
          citations.push({
            tenant_id: p.tenant_id, brand_id: p.brand_id, source_id: p.source_id, sync_run_id: p.sync_run_id,
            collected_at: p.collected_at, payload_hash: p.payload_hash, schema_version: p.schema_version,
            engine: 'google_ai_overview', device, keyword_id: keywordId, crawl_at: date, url, position: i + 1, is_own_domain: isOwnDomain(url, ctx.domain),
          }),
        )
      }
    }
  }
  return { answers, originals, citations, issues }
}
