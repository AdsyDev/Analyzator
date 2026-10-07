import type { BrandId, IsoDate, IsoDateTime } from './common'

/**
 * Oglinda contractului din baza de date: `public.metric_definitions` (registrul) și
 * `metrics.compute` / `metrics.build_response` (migrația 20261007140000_metric_registry.sql).
 * Orice diferență față de ele e o eroare aici, nu acolo. Formulele rămân în SQL (regula 4).
 */

/**
 * Statusul unei metrici. În SQL, când se întrunesc mai multe condiții, primul din ordinea
 * `unavailable, cannot_compute, insufficient_sample, stale, partial, base_zero` devine `status`,
 * iar celelalte ajung în `warnings`.
 * - `ok`: valoare completă.
 * - `partial`: acoperire incompletă sau rânduri excluse. `value` poate fi null când zero nu e confirmat
 *   (`zero_not_confirmed`): zero real apare doar cu acoperire confirmată (spec 2.2).
 * - `stale`: `data_as_of` e în urma datei așteptate.
 * - `insufficient_sample`: sub `min_sample` din definiție.
 * - `base_zero`: baza de comparație e 0; `relative_change` e null.
 * - `cannot_compute`: numitor zero; `value` e null.
 * - `unavailable`: interogare eșuată, observații duplicate sau fără date confirmate; `value` e null.
 * - `not_connected`: lipsa accesului la sursă; `value` e null.
 */
export const METRIC_STATUSES = [
  'ok',
  'partial',
  'stale',
  'insufficient_sample',
  'base_zero',
  'cannot_compute',
  'unavailable',
  'not_connected',
] as const
export type MetricStatus = (typeof METRIC_STATUSES)[number]

/** Statusurile care GARANTEAZĂ `value === null`. La celelalte, `value` poate fi totuși null (de ex. `partial`). */
export const STATUSES_WITHOUT_VALUE: ReadonlySet<MetricStatus> = new Set(['cannot_compute', 'unavailable', 'not_connected'])

/** Unitățile din `metric_definitions.unit`. Se extind împreună cu registrul (de ex. `currency` pentru paid). */
export const METRIC_UNITS = ['count', 'percent', 'seconds', 'position', 'score'] as const
export type MetricUnit = (typeof METRIC_UNITS)[number]

/** `metric_definitions.direction`. `neutral` = fără direcție „bună" (culoare neutră pentru variație). */
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral'

export type MetricLifecycle = 'draft' | 'active' | 'retired'

/** Interval din răspunsul serverului (`start`/`end`, inclusiv capetele). */
export interface ServerPeriod {
  start: IsoDate
  end: IsoDate
}

/** Cheia dovezii, așa cum o produce `metrics.compute`. Opacă pentru UI: se trimite înapoi neschimbată. */
export interface EvidenceQuery {
  metric_key: string
  version: number
  brand_id: BrandId
  period: ServerPeriod
  comparison_period: ServerPeriod
}

export type WarningSeverity = 'info' | 'warning'

/**
 * Avertisment cu cod stabil; serverul nu trimite text. Textul în română vine din `lib/warnings.ts`.
 * Coduri: definition_draft, aggregation_label, incomplete_period, query_failed, duplicate_observations,
 * interval_report_missing, no_observation, no_confirmed_data, zero_denominator, zero_not_confirmed,
 * excluded_rows, comparison_unavailable, comparison_partial, plus condițiile secundare
 * (stale, partial, insufficient_sample, base_zero, unavailable, cannot_compute).
 */
export interface MetricWarning {
  metric_key: string
  code: string
  severity: WarningSeverity
  /** Text liber (de ex. nota unei definiții draft) sau obiect (de ex. `{ reason, count }`). */
  detail: string | Record<string, unknown> | null
}

/**
 * O metrică din `data[]` a răspunsului. Câmpurile numerice vin neschimbate din `metrics.compute`:
 * - `relative_change` e în PROCENTE (12,7 = +12,7%), nu fracție; null la `base_zero`.
 * - `absolute_change` e în unitatea metricii; la `percent` înseamnă puncte procentuale.
 * - `coverage` e fracție 0-1 din zilele perioadei (0,82 = 82%).
 * Componentele afișează; nu derivă câmpuri lipsă și nu înlocuiesc null cu 0 (regula 8).
 */
export interface MetricResponse {
  metric_key: string
  value: number | null
  unit: MetricUnit
  numerator: number | null
  denominator: number | null
  comparison_value: number | null
  absolute_change: number | null
  relative_change: number | null
  status: MetricStatus
  /** Ultima zi acoperită de date („Date până la"). */
  data_as_of: IsoDate | null
  coverage: number | null
  evidence_query: EvidenceQuery
  /**
   * `primary_source` din registru (de ex. `ga4`, `gsc`, `seomonitor`, `clarity`). `build_response` nu îl
   * include pe metrică (doar `meta.sources`), deci îl completează providerul din definiții; null cât timp lipsesc.
   */
  source: string | null
  /** Din `meta.metric_definition_version[metric_key]`. */
  metric_definition_version: number | null
  /** Din `meta.warnings`, filtrate după `metric_key`. */
  warnings: MetricWarning[]
}

/** `meta` din răspuns (spec cap. 26, `metrics.build_response`). */
export interface MetricsMeta {
  tenant_id: string | null
  brand_id: BrandId
  period: ServerPeriod
  comparison_period: ServerPeriod
  /** Cea mai veche dată dintre metrici. Fiecare metrică își păstrează propriul `data_as_of`. */
  data_as_of: IsoDate | null
  generated_at: IsoDateTime
  sources: string[]
  /** Cea mai mică acoperire dintre metrici (fracție 0-1). */
  coverage: number | null
  cohort_version: number | null
  metric_definition_version: Record<string, number>
  warnings: MetricWarning[]
}

export interface MetricsEnvelope {
  data: MetricResponse[]
  meta: MetricsMeta
}

/** Definiția din `metric_definitions` (versiunea curentă, fără `retired`). */
export interface MetricDefinition {
  metric_key: string
  version: number
  /** `name_ro`. */
  label: string
  /** `formula_ro`: textul „Cum se calculează" și tooltipul indicatorului. */
  formula: string
  unit: MetricUnit
  /** `primary_source`. */
  source: string
  /** `aggregation_label`, de ex. „medie în perioadă", „ultima observație". */
  aggregation_label: string | null
  direction: MetricDirection
  lifecycle: MetricLifecycle
  /** Pentru `draft`: ce rămâne de confirmat. */
  lifecycle_note: string | null
  /** `doc_ref` din registru. */
  doc_ref: string
}

/** Un punct dintr-o serie. `value: null` înseamnă lipsă de date (gol în linie), nu zero. */
export interface TrendPoint {
  date: IsoDate
  value: number | null
}

export interface TrendSeries {
  metric_key: string
  label: string
  unit: MetricUnit
  points: TrendPoint[]
  /** Perioada de comparație, aliniată pe zi relativă; opțională. */
  comparison_points: TrendPoint[] | null
  status: MetricStatus
}

/** O înregistrare sursă din EvidenceDrawer. Valorile sunt text deja formatat de server. */
export interface EvidenceRecord {
  id: string
  /** Coloane afișate; aceleași chei pe toate rândurile unui răspuns. */
  fields: Record<string, string | number | null>
}

export interface Evidence {
  evidence_query: EvidenceQuery
  metric_key: string
  total_records: number
  records: EvidenceRecord[]
  columns: { key: string; label: string }[]
  imported_at: IsoDateTime | null
  payload_hash: string | null
}
