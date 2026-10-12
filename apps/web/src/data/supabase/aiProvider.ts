import {
  AI_ENGINES,
  failed,
  METRIC_STATUSES,
  notConnected,
  ready,
  type AiAnswerDetail,
  type AiAnswerSummary,
  type AiCitedSource,
  type AiEngineStat,
  type AiEngineTrend,
  type AiTopicMatrix,
  type AiVisibilityProvider,
  type Page,
  type ProviderResult,
} from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const NO_SOURCE = 'Răspunsurile AI (SEOmonitor) nu sunt conectate pentru acest brand.'
const OUTCOMES = ['recommended', 'mentioned', 'not_mentioned', 'refused', 'error', 'not_collected']
const isEngine = (v: unknown) => (AI_ENGINES as readonly string[]).includes(String(v))
const isStatus = (v: unknown) => (METRIC_STATUSES as readonly string[]).includes(String(v))
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * AI Visibility din SQL (D-15): RPC INVOKER pe răspunsurile AI SEOmonitor. Ratele, numărătorii și numitorii vin de la
 * server, ca rata să se poată reface din răspunsurile afișate (spec cap. 13).
 */
export function createSupabaseAi(client: DataClient): AiVisibilityProvider {
  async function call<T>(fn: string, args: Record<string, unknown>, pick: (d: Record<string, unknown>) => T | null): Promise<ProviderResult<T>> {
    const { data, error } = await client.rpc(fn, args)
    if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
    const d = data as Record<string, unknown> | null
    if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
    if (!d.connected) return notConnected(NO_SOURCE)
    const out = pick(d)
    return out === null ? failed(CONTRACT) : ready(out)
  }
  const base = (ctx: { brandId: string; period: { from: string; to: string } }) => ({ p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })

  return {
    async groups(brandId) {
      const { data, error } = await client.from('keyword_groups').select('name').eq('brand_id', brandId).order('name').limit(2000)
      if (error) return failed(QUERY_FAILED)
      return ready([...new Set(((data ?? []) as Array<{ name: string | null }>).map((g) => g.name).filter((n): n is string => !!n))])
    },

    engines: (ctx, f) =>
      call('brand_ai_engines', { ...base(ctx), p_kind: serverPeriodKind(ctx.period.preset), p_group: f.group }, (d) => {
        const list = d.engines as Array<Record<string, unknown>>
        if (!Array.isArray(list) || list.some((e) => !isEngine(e.engine) || !isStatus(e.status))) return null
        return list.map<AiEngineStat>((e) => ({
          engine: e.engine as AiEngineStat['engine'], mention_rate: num(e.mention_rate), delta_pp: num(e.delta_pp),
          valid_answers: Number(e.valid_answers), total_answers: Number(e.total_answers), status: e.status as AiEngineStat['status'],
        }))
      }),

    trends: (ctx, f) =>
      call('brand_ai_trends', { ...base(ctx), p_engine: f.engine, p_group: f.group }, (d) => {
        const list = d.trends as Array<Record<string, unknown>>
        if (!Array.isArray(list) || list.some((t) => !isEngine(t.engine) || !isStatus(t.status) || !Array.isArray(t.points))) return null
        return list.map<AiEngineTrend>((t) => ({
          engine: t.engine as AiEngineTrend['engine'], status: t.status as AiEngineTrend['status'],
          points: (t.points as Array<{ date: string; value: unknown }>).map((p) => ({ date: p.date, value: num(p.value) })),
        }))
      }),

    topicMatrix: (ctx, f) =>
      call('brand_ai_topic_matrix', { ...base(ctx), p_engine: f.engine, p_group: f.group }, (d) => {
        if (!Array.isArray(d.entities) || !Array.isArray(d.topics) || typeof d.cells !== 'object') return null
        const cells = d.cells as Record<string, Record<string, Record<string, unknown>>>
        for (const row of Object.values(cells)) for (const c of Object.values(row)) if (!isStatus(c.status)) return null
        return {
          entities: d.entities as AiTopicMatrix['entities'],
          topics: (d.topics as Array<Record<string, unknown>>).map((t) => ({ topic: String(t.topic), group: String(t.group), n: Number(t.n), coverage: num(t.coverage) })),
          cells: Object.fromEntries(Object.entries(cells).map(([topic, row]) => [topic, Object.fromEntries(Object.entries(row).map(([id, c]) => [id, {
            value: num(c.value), numerator: num(c.numerator), denominator: num(c.denominator), status: c.status as AiTopicMatrix['cells'][string][string]['status'],
          }]))])),
        }
      }),

    citedSources: (ctx, f) =>
      call('brand_ai_cited_sources', { ...base(ctx), p_engine: f.engine, p_group: f.group }, (d) => {
        const list = d.sources as Array<Record<string, unknown>>
        if (!Array.isArray(list)) return null
        return list.map<AiCitedSource>((s) => ({ domain: String(s.domain), kind: s.kind === 'owned' ? 'owned' : 'third_party', count: Number(s.count), brand_id: typeof s.brand_id === 'string' ? s.brand_id : null }))
      }),

    answers: (ctx, f, page) =>
      call('brand_ai_answers', { ...base(ctx), p_engine: f.engine, p_group: f.group, p_page: page.page, p_page_size: page.page_size }, (d) => {
        const items = d.items as Array<Record<string, unknown>>
        if (!Array.isArray(items) || items.some((i) => !isEngine(i.engine) || !OUTCOMES.includes(String(i.outcome)))) return null
        return { items: items as unknown as AiAnswerSummary[], total: Number(d.total), page: Number(d.page), page_size: Number(d.page_size) } satisfies Page<AiAnswerSummary>
      }),

    async answer(brandId, id) {
      const { data, error } = await client.rpc('brand_ai_answer', { p_brand_id: brandId, p_answer_id: id })
      if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
      if (data === null) return failed('Răspunsul nu există în acest brand.')
      const d = data as AiAnswerDetail
      if (!isEngine(d.engine) || !OUTCOMES.includes(d.outcome) || !Array.isArray(d.segments) || !Array.isArray(d.citations)) return failed(CONTRACT)
      return ready(d)
    },
  }
}
