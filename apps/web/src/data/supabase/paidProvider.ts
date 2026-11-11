import { failed, notConnected, PAID_PLATFORMS, ready, type PaidBudget, type PaidFilters, type PaidKpi, type PaidProvider, type PaidRow, type PaidSeries, type PaidSummary, type ProviderResult, type QueryContext } from '../../contracts'
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

/** Refuzul RLS și regulile tabelului, în română; restul erorilor nu își arată detaliile. */
function budgetWriteError(e: { code?: string }, fallback: string): string {
  if (e.code === '42501') return 'Nu ai dreptul să modifici bugetul acestui brand.'
  if (e.code === '23514') return 'Bugetul nu respectă regulile: sumă mai mare ca zero, monedă din trei litere, interval de cel mult 400 de zile.'
  return fallback
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
          p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset, ctx.comparison),
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

    // Planul în vigoare la sfârșitul perioadei (`brand_paid_budget`, J-4); costul și procentele vin calculate de server.
    async budget(ctx) {
      const { data, error } = await client.rpc('brand_paid_budget', { p_brand_id: ctx.brandId, p_day: ctx.period.to })
      if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Bugetul nu a putut fi citit. Reîncearcă.')
      const d = data as { plan?: Record<string, unknown> | null } | null
      if (!d || !('plan' in d)) return failed(CONTRACT)
      const plan = d.plan
      // Fără plan: stare validă („Fără buget aprobat”), nu eroare și nu buget zero.
      if (plan === null || plan === undefined) {
        return ready<PaidBudget>({ id: null, currency: '', approved_budget: null, plan_from: ctx.period.from, plan_to: ctx.period.to, spent: null, elapsed_days: 0, planned_days: 0, spend_pct: null, time_pct: 0, plan_note: null, data_as_of: null, currency_mismatch: false })
      }
      const approved = num(plan.approved_budget)
      const time = num(plan.time_pct)
      if (typeof plan.id !== 'string' || typeof plan.plan_from !== 'string' || typeof plan.plan_to !== 'string' || typeof plan.currency !== 'string' || approved === null || time === null) return failed(CONTRACT)
      return ready<PaidBudget>({
        id: plan.id, currency: plan.currency, approved_budget: approved, plan_from: plan.plan_from, plan_to: plan.plan_to,
        spent: num(plan.spent), elapsed_days: num(plan.elapsed_days) ?? 0, planned_days: num(plan.planned_days) ?? 0,
        spend_pct: num(plan.spend_pct), time_pct: time, plan_note: typeof plan.plan_note === 'string' ? plan.plan_note : null,
        data_as_of: typeof plan.data_as_of === 'string' ? plan.data_as_of : null, currency_mismatch: plan.currency_mismatch === true,
      })
    },

    async saveBudget(brand, b) {
      const { data: auth } = await client.auth.getSession()
      const me = auth.session?.user.id
      if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const { error } = await client.from('paid_budgets').insert({
        tenant_id: brand.tenant_id, brand_id: brand.id, plan_from: b.plan_from, plan_to: b.plan_to, amount: b.amount,
        currency: b.currency.trim().toUpperCase(), note: b.note?.trim() || null, created_by: me,
      })
      return error ? failed(budgetWriteError(error, 'Bugetul nu a putut fi salvat. Reîncearcă.')) : ready(null)
    },

    async deleteBudget(id) {
      const { error } = await client.from('paid_budgets').delete().eq('id', id)
      return error ? failed(budgetWriteError(error, 'Bugetul nu a putut fi șters. Reîncearcă.')) : ready(null)
    },

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
