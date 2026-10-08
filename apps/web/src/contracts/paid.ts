import type { IsoDate, IsoDateTime } from './common'
import type { MetricStatus, TrendPoint } from './metric'

/**
 * Paid Media (spec cap. 15). Date din exporturi standard (nivel B, import CSV). Nu există încă un contract de
 * server nici unitate monetară în registrul de metrici; tipurile sunt cerințele UI-ului. Costurile se afișează
 * cu moneda lângă valoare; nu se convertesc și nu se amestecă monede (spec 2.3). CTR, CPC, CPA, pacing vin calculate.
 */
export const PAID_PLATFORMS = ['google_ads', 'meta_ads'] as const
export type PaidPlatform = (typeof PAID_PLATFORMS)[number]

export interface PaidFilters {
  platform: PaidPlatform | null
}

export type PaidKpiKey = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions' | 'cpa'

export interface PaidKpi {
  key: PaidKpiKey
  label: string
  value: number | null
  unit: 'currency' | 'count' | 'percent'
  /** Cod ISO 4217 pentru `currency`. */
  currency: string | null
  /** Variația relativă în procente (la procente: în puncte procentuale); `null` fără comparație. */
  change: number | null
  status: MetricStatus
  /** Definiția afișată în tooltip (fiecare card își arată definiția). */
  definition: string
  /** De ex. tipul de click al sursei („link clicks"). */
  note: string | null
}

export interface PaidSummary {
  kpis: PaidKpi[]
  currency: string
  /** Fusul orar al exportului, afișat pentru reconciliere. */
  source_timezone: string
  imported_at: IsoDateTime
  data_as_of: IsoDate
}

export interface PaidBudget {
  currency: string
  approved_budget: number | null
  plan_from: IsoDate
  plan_to: IsoDate
  spent: number | null
  elapsed_days: number
  planned_days: number
  /** Progresul liniar, ca reper (spend / buget și zile trecute / zile planificate), calculat de server. */
  spend_pct: number | null
  time_pct: number
  /** Nota planului, de ex. „plan cu distribuție săptămânală". */
  plan_note: string | null
}

export interface PaidSeries {
  currency: string
  spend: TrendPoint[]
  results: TrendPoint[]
  results_label: string
}

export interface PaidRow {
  /** Ziua în fusul orar al exportului. */
  date: IsoDate
  platform: PaidPlatform
  account: string
  campaign: string
  objective: string | null
  spend: number | null
  impressions: number | null
  clicks: number | null
  ctr: number | null
  cpc: number | null
  conversions: number | null
  /** `null` când nu e relevant sau fără conversii (nu 0). */
  cpa: number | null
  attribution_window: string | null
}
