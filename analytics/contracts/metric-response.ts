// Contractul răspunsului unei metrici. Sursa: docs/contracts/metric-response.md (spec cap. 26).
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

export type MetricsEnvelope = {
  data: Array<MetricResponse & { metric_key: string }>
  meta: MetricsMeta
}

// Verificări la compilare: tipurile au exact câmpurile din listele de mai sus.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const fieldsMatch: Exact<keyof MetricResponse, (typeof METRIC_FIELDS)[number]> = true
const metaMatch: Exact<keyof MetricsMeta, (typeof META_FIELDS)[number]> = true
export const CONTRACT_TYPE_CHECKS = { fieldsMatch, metaMatch } as const
