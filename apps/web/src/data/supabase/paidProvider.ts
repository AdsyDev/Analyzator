import { failed, notConnected, PAID_PLATFORMS, ready, type PaidFilters, type PaidKpi, type PaidProvider, type PaidRow, type PaidSeries, type PaidSummary, type ProviderResult, type QueryContext } from '../../contracts'
import { METRIC_STATUSES } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'

const NO_SOURCE = 'Nu există date de Paid Media pentru acest brand: nicio platformă conectată și niciun import.'
const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const KPI_KEYS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'cpa'] as const
const UNITS = ['currency', 'count', 'percent'] as const

type Report = {
  connected: boolean
  currency: string | null
  mixed_currency: boolean
  source_timezone: string | null
  imported_at: string | null
  data_as_of: string | null
  kpis: unknown[]
  series: Array<{ date: string; spend: unknown; results: unknown }>
  rows: Array<Record<string, unknown>>
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

function kpi(v: unknown): PaidKpi {
  const o = v as Record<string, unknown>
  if (!KPI_KEYS.includes(o.key as never) || !UNITS.includes(o.unit as never) || !(METRIC_STATUSES as readonly string[]).includes(String(o.status))) throw new Error(CONTRACT)
  return {
    key: o.key as PaidKpi['key'],
    label: String(o.label),
    value: num(o.value),
    unit: o.unit as PaidKpi['unit'],
    currency: typeof o.currency === 'string' ? o.currency : null,
    change: num(o.change),
    status: o.status as PaidKpi['status'],
    definition: String(o.definition ?? ''),
    note: typeof o.note === 'string' ? o.note : null,
  }
}

/**
 * Paid Media din SQL (`brand_paid`, SECURITY INVOKER): KPI-uri, serie și rânduri calculate pe server (regula 4).
 * Un singur apel per context și platformă; cele trei secțiuni ale ecranului îl împart.
 */
export function createSupabasePaid(client: DataClient): PaidProvider {
  const cache = new Map<string, Promise<ProviderResult<Report>>>()
  function report(ctx: QueryContext, f: PaidFilters): Promise<ProviderResult<Report>> {
    const key = [ctx.brandId, ctx.period.from, ctx.period.to, ctx.period.preset, f.platform ?? 'all'].join('|')
    let p = cache.get(key)
    if (!p) {
      p = (async () => {
        const { data, error } = await client.rpc('brand_paid', {
          p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset),
          p_platform: f.platform && (PAID_PLATFORMS as readonly string[]).includes(f.platform) ? f.platform : null,
        })
        if (error) return failed<Report>(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Datele de Paid Media nu au putut fi citite. Reîncearcă.')
        const r = data as Report | null
        if (!r || typeof r.connected !== 'boolean') return failed<Report>(CONTRACT)
        return r.connected ? ready(r) : notConnected<Report>(NO_SOURCE)
      })()
      cache.set(key, p)
      // Rezultatele vechi nu se păstrează la nesfârșit: o nouă vizită pe pagină citește din nou.
      void p.finally(() => setTimeout(() => cache.delete(key), 30_000))
    }
    return p
  }

  return {
    async summary(ctx, f) {
      const r = await report(ctx, f)
      if (r.kind !== 'ready') return r
      try {
        const d = r.data
        const summary: PaidSummary = {
          kpis: d.kpis.map(kpi),
          // Monede diferite: KPI-urile monetare sunt indisponibile; antetul o spune.
          currency: d.mixed_currency ? 'monede diferite' : (d.currency ?? '—'),
          source_timezone: d.source_timezone ?? '—',
          imported_at: d.imported_at ?? '',
          data_as_of: d.data_as_of ?? '',
        }
        return ready(summary)
      } catch {
        return failed(CONTRACT)
      }
    },

    // Bugetul aprobat nu are încă tabel în Analyzator: nu inventăm un plan.
    budget: async () => notConnected('Bugetul aprobat nu e încă încărcat în Analyzator; pacing-ul apare după încărcarea planului de buget.'),

    async series(ctx, f) {
      const r = await report(ctx, f)
      if (r.kind !== 'ready') return r
      const series: PaidSeries = {
        currency: r.data.mixed_currency ? 'monede diferite' : (r.data.currency ?? '—'),
        spend: r.data.series.map((p) => ({ date: p.date, value: num(p.spend) })),
        results: r.data.series.map((p) => ({ date: p.date, value: num(p.results) })),
        results_label: 'Conversii',
      }
      return ready(series)
    },

    async rows(ctx, f) {
      const r = await report(ctx, f)
      if (r.kind !== 'ready') return r
      const rows = r.data.rows.map<PaidRow>((o) => ({
        date: String(o.date),
        platform: o.platform as PaidRow['platform'],
        account: String(o.account ?? ''),
        campaign: String(o.campaign ?? ''),
        objective: typeof o.objective === 'string' ? o.objective : null,
        spend: num(o.spend),
        impressions: num(o.impressions),
        clicks: num(o.clicks),
        ctr: num(o.ctr),
        cpc: num(o.cpc),
        conversions: num(o.conversions),
        cpa: num(o.cpa),
        attribution_window: typeof o.attribution_window === 'string' ? o.attribution_window : null,
      }))
      if (rows.some((x) => !(PAID_PLATFORMS as readonly string[]).includes(x.platform))) return failed(CONTRACT)
      return ready(rows)
    },
  }
}
