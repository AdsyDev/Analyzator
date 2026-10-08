import paidFile from '../../../../../tests/fixtures/ui/paid.json'
import { failed, notConnected, ready, type PaidBudget, type PaidKpi, type PaidProvider, type PaidRow, type QueryContext } from '../../contracts'
import { addDays, comparisonRange, daysBetween, lastCompleteDay } from '../../lib/period'
import { unit } from './rng'

interface Campaign {
  platform: 'google_ads' | 'meta_ads'
  account: string
  campaign: string
  objective: string
  daily_spend: number
  cpc: number
  ctr: number
  cvr: number | null
  window: string
}
interface BrandPaid {
  currency: string
  source_timezone: string
  imported_days_ago: number
  approved_budget: number
  plan_note: string
  campaigns: Campaign[]
}
const data = paidFile.brands as unknown as Record<string, BrandPaid>
const NO_IMPORT = 'Nu există date de Paid Media importate pentru acest brand.'
const r2 = (n: number) => Math.round(n * 100) / 100

/** Rândurile unei zile și ale unei campanii. Valorile sunt fictive; derivatele (CTR, CPC, CPA) sunt stand-in pentru serverul real. */
function dayRows(brandId: string, c: Campaign, date: string): PaidRow {
  const j = (s: string) => 0.85 + 0.3 * unit(`${brandId}:${c.campaign}:${date}:${s}`)
  const spend = r2(c.daily_spend * j('s'))
  const clicks = Math.max(1, Math.round((spend / c.cpc) * j('c')))
  const impressions = Math.round(clicks / (c.ctr / 100))
  const conversions = c.cvr === null ? null : Math.round((clicks * c.cvr * j('v')) / 100)
  return {
    date,
    platform: c.platform,
    account: c.account,
    campaign: c.campaign,
    objective: c.objective,
    spend,
    impressions,
    clicks,
    ctr: r2((100 * clicks) / impressions),
    cpc: r2(spend / clicks),
    conversions,
    cpa: conversions ? r2(spend / conversions) : null,
    attribution_window: c.window,
  }
}

export function createPaidFixtures({ allowed, now }: { allowed: Set<string>; now: () => Date }): PaidProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const dataAsOf = (b: BrandPaid) => addDays(lastCompleteDay(now()), -(b.imported_days_ago - 1))

  /** Rândurile din interval, până la ultima zi importată; zilele ulterioare nu se inventează. */
  const rowsIn = (brandId: string, b: BrandPaid, from: string, to: string, platform: string | null): PaidRow[] => {
    const end = to < dataAsOf(b) ? to : dataAsOf(b)
    if (end < from) return []
    const out: PaidRow[] = []
    for (let i = 0; i <= daysBetween(from, end); i++) {
      for (const c of b.campaigns) if (!platform || c.platform === platform) out.push(dayRows(brandId, c, addDays(from, i)))
    }
    return out
  }
  const sum = (rows: PaidRow[], k: 'spend' | 'impressions' | 'clicks' | 'conversions') => rows.reduce((a, r) => a + (r[k] ?? 0), 0)

  function kpis(rows: PaidRow[], prev: PaidRow[], currency: string): PaidKpi[] {
    const agg = (rs: PaidRow[]) => {
      const spend = sum(rs, 'spend')
      const imp = sum(rs, 'impressions')
      const clk = sum(rs, 'clicks')
      const conv = rs.filter((r) => r.conversions !== null).reduce((a, r) => a + (r.conversions ?? 0), 0)
      const convSpend = rs.filter((r) => r.conversions !== null).reduce((a, r) => a + (r.spend ?? 0), 0)
      return { spend, imp, clk, conv, ctr: imp ? (100 * clk) / imp : null, cpc: clk ? spend / clk : null, cpa: conv ? convSpend / conv : null }
    }
    const a = agg(rows)
    const p = prev.length ? agg(prev) : null
    const rel = (x: number | null, y: number | null | undefined) => (x === null || y === null || y === undefined || y === 0 ? null : r2((100 * (x - y)) / Math.abs(y)))
    const pp = (x: number | null, y: number | null | undefined) => (x === null || y === null || y === undefined ? null : r2(x - y))
    const k = (key: PaidKpi['key'], label: string, value: number | null, u: PaidKpi['unit'], change: number | null, definition: string, note: string | null = null): PaidKpi => ({
      key, label, value: value === null ? null : r2(value), unit: u, currency: u === 'currency' ? currency : null, change, status: rows.length ? 'ok' : 'unavailable', definition, note,
    })
    return [
      k('spend', 'Spend', a.spend, 'currency', rel(a.spend, p?.spend), 'Costul din platformele de ads în perioadă, în moneda exportului; suma zilelor.'),
      k('impressions', 'Impressions', a.imp, 'count', rel(a.imp, p?.imp), 'Afișările din platformele de ads; suma zilelor.'),
      k('clicks', 'Clicks', a.clk, 'count', rel(a.clk, p?.clk), 'Clickurile de tipul declarat de sursă (aici: link clicks), nu clickurile de pe orice element.', 'Tip: link clicks'),
      k('ctr', 'CTR', a.ctr, 'percent', pp(a.ctr, p?.ctr), '100 × clicks / impressions, recalculat din totalurile perioadei. Variația e în puncte procentuale.'),
      k('cpc', 'CPC', a.cpc, 'currency', rel(a.cpc, p?.cpc), 'Spend / clicks, din totalurile perioadei.'),
      k('conversions', 'Conversii', rows.some((r) => r.conversions !== null) ? a.conv : null, 'count', rel(a.conv, p?.conv), 'Conversiile din campaniile care le raportează, pe fereastra de atribuire a fiecărei campanii. Campaniile de awareness nu au conversii.'),
      k('cpa', 'CPA', a.cpa, 'currency', rel(a.cpa, p?.cpa), 'Spend / conversii, doar pentru campaniile cu conversii și aceeași acțiune. Nu e relevant pentru awareness.'),
    ]
  }

  const need = (ctx: QueryContext) => (allowed.has(ctx.brandId) ? (data[ctx.brandId] ?? null) : undefined)

  return {
    summary: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      const cmp = comparisonRange(ctx.period, ctx.comparison)
      return ready({
        kpis: kpis(rowsIn(ctx.brandId, b, ctx.period.from, ctx.period.to, f.platform), rowsIn(ctx.brandId, b, cmp.from, cmp.to, f.platform), b.currency),
        currency: b.currency,
        source_timezone: b.source_timezone,
        imported_at: `${addDays(lastCompleteDay(now()), -(b.imported_days_ago - 1))}T06:00:00+03:00`,
        data_as_of: dataAsOf(b),
      })
    },

    budget: async (ctx) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      const asOf = dataAsOf(b)
      const planFrom = `${asOf.slice(0, 8)}01`
      const next = new Date(Date.UTC(Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7)), 1))
      const planTo = addDays(next.toISOString().slice(0, 10), -1)
      const planned = daysBetween(planFrom, planTo) + 1
      const elapsed = daysBetween(planFrom, asOf) + 1
      const spent = r2(sum(rowsIn(ctx.brandId, b, planFrom, asOf, null), 'spend'))
      const budget: PaidBudget = {
        currency: b.currency,
        approved_budget: b.approved_budget,
        plan_from: planFrom,
        plan_to: planTo,
        spent,
        elapsed_days: elapsed,
        planned_days: planned,
        spend_pct: r2((100 * spent) / b.approved_budget),
        time_pct: r2((100 * elapsed) / planned),
        plan_note: b.plan_note,
      }
      return ready(budget)
    },

    series: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      const days = daysBetween(ctx.period.from, ctx.period.to) + 1
      const dates = Array.from({ length: days }, (_, i) => addDays(ctx.period.from, i))
      const rows = rowsIn(ctx.brandId, b, ctx.period.from, ctx.period.to, f.platform)
      const by = (date: string) => rows.filter((r) => r.date === date)
      return ready({
        currency: b.currency,
        // Zilele neimportate sunt goluri (null), nu zero.
        spend: dates.map((date) => ({ date, value: by(date).length ? r2(sum(by(date), 'spend')) : null })),
        results: dates.map((date) => ({ date, value: by(date).some((r) => r.conversions !== null) ? by(date).reduce((a, r) => a + (r.conversions ?? 0), 0) : null })),
        results_label: 'Conversii',
      })
    },

    rows: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      return ready(rowsIn(ctx.brandId, b, ctx.period.from, ctx.period.to, f.platform).sort((x, y) => y.date.localeCompare(x.date) || x.campaign.localeCompare(y.campaign)))
    },
  }
}

