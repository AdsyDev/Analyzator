// Contractul răspunsului unei metrici. Sursa: docs/contracts/metric-response.md (spec cap. 26).
//
// VERSIUNEA 2 (8 oct 2026): unitatea `currency` și câmpul `currency` (cod ISO 4217; null pentru unitățile nemonetare).
// Versiunea 2 e ADITIVĂ în acest fișier: numele canonice de mai jos (`METRIC_FIELDS`, `MetricUnit`, `MetricResponse`) rămân
// cele ale versiunii 1, ca `apps/web` (care le importă și le verifică la compilare) să nu se rupă înainte să fie adaptat.
// Versiunea 2 are nume cu sufixul `V2`. Când UI-ul trece pe v2, numele canonice se mută pe v2 și v1 se elimină.
// Implementarea e în SQL (metrics.compute / metrics.build_response). UI-ul importă tipurile de aici;
// nu recalculează nimic.

export const METRIC_FIELDS = [
  'value',
  'unit',
  'numerator',
  'denominator',
  'comparison_value',
  'absolute_change',
  'relative_change',
  'status',
  'data_as_of',
  'coverage',
  'evidence_query',
] as const

/** În ordinea gravității: primul status aplicabil câștigă. */
export const METRIC_STATUSES = [
  'not_connected',
  'unavailable',
  'cannot_compute',
  'insufficient_sample',
  'stale',
  'partial',
  'base_zero',
  'ok',
] as const

export const META_FIELDS = [
  'tenant_id',
  'brand_id',
  'period',
  'comparison_period',
  'data_as_of',
  'generated_at',
  'sources',
  'coverage',
  'cohort_version',
  'metric_definition_version',
  'warnings',
] as const

/** Versiunea curentă a contractului (ce emite SQL-ul). Crește la orice schimbare de câmpuri, unități sau statusuri. */
export const METRIC_CONTRACT_VERSION = 2

export const METRIC_FIELDS_V2 = [
  'value',
  'unit',
  'currency',
  'numerator',
  'denominator',
  'comparison_value',
  'absolute_change',
  'relative_change',
  'status',
  'data_as_of',
  'coverage',
  'evidence_query',
] as const

export const METRIC_UNITS_V2 = ['count', 'percent', 'seconds', 'position', 'score', 'currency'] as const

export type MetricStatus = (typeof METRIC_STATUSES)[number]
export type MetricUnit = 'count' | 'percent' | 'seconds' | 'position' | 'score'
export type IsoDate = string

export type Period = { start: IsoDate; end: IsoDate }

export type EvidenceQuery = {
  metric_key: string
  version: number
  brand_id: string | null
  period: Period
  comparison_period: Period
}

export type MetricResponse = {
  value: number | null
  unit: MetricUnit
  numerator: number | null
  denominator: number | null
  comparison_value: number | null
  /** Pentru unit = 'percent': puncte procentuale. */
  absolute_change: number | null
  /** În procente; null pe bază zero. */
  relative_change: number | null
  status: MetricStatus
  data_as_of: IsoDate | null
  coverage: number | null
  evidence_query: EvidenceQuery
}

export type MetricWarning = {
  metric_key: string
  code: string
  severity: 'info' | 'warning'
  detail: unknown
}

export type MetricsMeta = {
  tenant_id: string
  brand_id: string
  period: Period
  comparison_period: Period
  data_as_of: IsoDate | null
  generated_at: string
  sources: string[]
  coverage: number | null
  cohort_version: string | null
  metric_definition_version: Record<string, number>
  warnings: MetricWarning[]
}

export type MetricUnitV2 = (typeof METRIC_UNITS_V2)[number]

/** Răspunsul unei metrici, versiunea 2: `unit` poate fi `currency`, iar `currency` poartă moneda (ISO 4217). */
export type MetricResponseV2 = Omit<MetricResponse, 'unit'> & {
  unit: MetricUnitV2
  /**
   * Codul ISO 4217 al monedei (moneda lotului de import). Obligatoriu când `unit = 'currency'` și `value` nu e null;
   * null pentru orice altă unitate. Când moneda nu se poate stabili (observații fără monedă sau cu monede diferite),
   * metrica e `unavailable`, cu `value` null.
   */
  currency: string | null
}

const ISO_4217 = /^[A-Z]{3}$/

/**
 * Invariantele versiunii 2 pe care tipul TS nu le poate exprima. Întoarce lista încălcărilor (goală = valid).
 * - `currency` e obligatoriu (cod ISO 4217) când `unit = 'currency'` și `value` nu e null;
 * - `currency` e null când unitatea nu e monetară.
 */
export function metricInvariantViolations(m: Pick<MetricResponseV2, 'unit' | 'value' | 'currency'>): string[] {
  const out: string[] = []
  if (!(METRIC_UNITS_V2 as readonly string[]).includes(m.unit)) out.push(`unitate necunoscută: ${m.unit}`)
  if (m.unit === 'currency') {
    if (m.value !== null && m.currency === null) out.push('currency e obligatoriu când unit = currency și value nu e null')
    if (m.currency !== null && !ISO_4217.test(m.currency)) out.push(`currency nu e un cod ISO 4217: ${m.currency}`)
  } else if (m.currency !== null) {
    out.push(`currency trebuie să fie null pentru unit = ${m.unit}`)
  }
  return out
}

export type MetricsEnvelope = {
  data: Array<MetricResponse & { metric_key: string }>
  meta: MetricsMeta
}

// Verificări la compilare: tipurile au exact câmpurile din listele de mai sus.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const fieldsMatch: Exact<keyof MetricResponse, (typeof METRIC_FIELDS)[number]> = true
const metaMatch: Exact<keyof MetricsMeta, (typeof META_FIELDS)[number]> = true
const fieldsMatchV2: Exact<keyof MetricResponseV2, (typeof METRIC_FIELDS_V2)[number]> = true
export const CONTRACT_TYPE_CHECKS = { fieldsMatch, metaMatch, fieldsMatchV2 } as const
