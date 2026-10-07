import type { IsoDate, IsoDateTime } from './common'
import type { EvidenceQuery, MetricResponse, MetricUnit, MetricWarning, MetricsMeta } from '@analytics/contracts/metric-response'

/**
 * Contractul răspunsului unei metrici NU se definește aici. Sursa: `docs/contracts/metric-response.md`,
 * implementat în SQL (`metrics.compute` / `metrics.build_response`) și tipizat în
 * `analytics/contracts/metric-response.ts` (verificat la compilare). UI-ul îl importă neschimbat.
 */
export { METRIC_STATUSES } from '@analytics/contracts/metric-response'
export type {
  EvidenceQuery,
  MetricResponse,
  MetricStatus,
  MetricUnit,
  MetricWarning,
  MetricsEnvelope,
  MetricsMeta,
  Period as ServerPeriod,
} from '@analytics/contracts/metric-response'

import type { MetricStatus } from '@analytics/contracts/metric-response'

/** Unitățile din contract, ca listă la rulare (contractul le exportă doar ca tip). Exhaustivitatea e verificată la compilare. */
export const METRIC_UNITS = ['count', 'percent', 'seconds', 'position', 'score'] as const satisfies readonly MetricUnit[]
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const UNITS_ARE_EXHAUSTIVE: Exact<MetricUnit, (typeof METRIC_UNITS)[number]> = true

/** Statusurile care GARANTEAZĂ `value === null`. La celelalte, `value` poate fi totuși null (de ex. `partial` cu zero neconfirmat). */
export const STATUSES_WITHOUT_VALUE: ReadonlySet<MetricStatus> = new Set<MetricStatus>(['cannot_compute', 'unavailable', 'not_connected'])

/**
 * O metrică așa cum o folosește UI-ul: `MetricResponse` din contract, plus ce nu are contractul pe metrică.
 * Alipirile se fac în strat de date (`data/supabase/mapMetrics.ts`), nu în componente, și sunt DIFERENȚE față
 * de contract, de rezolvat într-un task separat:
 * - `metric_key`: contractul îl are în `data[]` (`MetricResponse & { metric_key }`);
 * - `source`: `primary_source` din registru; contractul are doar `meta.sources`, fără corespondență pe metrică;
 * - `warnings`: din `meta.warnings`, filtrate după `metric_key`.
 */
export type MetricItem = MetricResponse & {
  metric_key: string
  source: string | null
  warnings: MetricWarning[]
}

/**
 * Rezultatul unei cereri de metrici. `meta` e null când nu există un răspuns de server (providerul
 * neconectat): UI-ul nu fabrică un `tenant_id` sau o dată de generare.
 */
export interface MetricsBundle {
  items: MetricItem[]
  meta: MetricsMeta | null
}

/** `metric_definitions.direction`. `neutral` = fără direcție „bună" (culoare neutră pentru variație). */
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral'

export type MetricLifecycle = 'draft' | 'active' | 'retired'

/**
 * Definiția din `metric_definitions` (versiunea curentă, fără `retired`). Tipul e al UI-ului: contractul din
 * `analytics/` nu descrie rândul de registru. Registrul are doar `name_ro` și `formula_ro` (fără text scurt
 * de definiție), deci tooltipul indicatorului folosește formula.
 */
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
