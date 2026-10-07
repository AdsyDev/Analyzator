import {
  METRIC_STATUSES,
  METRIC_UNITS,
  type EvidenceQuery,
  type MetricDefinition,
  type MetricDirection,
  type MetricLifecycle,
  type MetricResponse,
  type MetricStatus,
  type MetricUnit,
  type MetricWarning,
  type MetricsEnvelope,
  type MetricsMeta,
  type ServerPeriod,
} from '../../contracts'

/** Contractul din baza de date s-a schimbat față de cel din UI. Se aruncă, nu se ignoră în tăcere. */
export class MetricContractError extends Error {
  constructor(message: string) {
    super(`Contract de metrici încălcat: ${message}`)
    this.name = 'MetricContractError'
  }
}

type Json = Record<string, unknown>

function obj(v: unknown, path: string): Json {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new MetricContractError(`${path} trebuie să fie obiect`)
  return v as Json
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new MetricContractError(`${path} trebuie să fie text`)
  return v
}
function strOrNull(v: unknown, path: string): string | null {
  return v === null || v === undefined ? null : str(v, path)
}
/** Numerele din PostgREST pot veni ca număr sau, pentru `numeric`, ca text. Alt tip e o încălcare. */
function numOrNull(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new MetricContractError(`${path} trebuie să fie număr sau null`)
  return n
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new MetricContractError(`${path} are valoarea ${JSON.stringify(v)}, în afara listei ${allowed.join(', ')}`)
  }
  return v as T
}

function period(v: unknown, path: string): ServerPeriod {
  const o = obj(v, path)
  return { start: str(o.start, `${path}.start`), end: str(o.end, `${path}.end`) }
}

function evidenceQuery(v: unknown, path: string): EvidenceQuery {
  const o = obj(v, path)
  const version = numOrNull(o.version, `${path}.version`)
  if (version === null) throw new MetricContractError(`${path}.version lipsește`)
  return {
    metric_key: str(o.metric_key, `${path}.metric_key`),
    version,
    brand_id: str(o.brand_id, `${path}.brand_id`),
    period: period(o.period, `${path}.period`),
    comparison_period: period(o.comparison_period, `${path}.comparison_period`),
  }
}

function warning(v: unknown, path: string): MetricWarning {
  const o = obj(v, path)
  const detail = o.detail
  return {
    metric_key: str(o.metric_key, `${path}.metric_key`),
    code: str(o.code, `${path}.code`),
    severity: oneOf(o.severity, ['info', 'warning'] as const, `${path}.severity`),
    detail: detail === null || detail === undefined ? null : typeof detail === 'string' ? detail : obj(detail, `${path}.detail`),
  }
}

function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new MetricContractError(`${path} trebuie să fie listă`)
  return v
}

/**
 * Transformă răspunsul `metrics.build_response` (`{ data, meta }`) în `MetricsEnvelope`.
 * Câmpurile pe care serverul nu le pune pe metrică se completează astfel: `source` din registru,
 * `metric_definition_version` din `meta`, `warnings` din `meta.warnings` după `metric_key`.
 */
export function parseMetricsEnvelope(json: unknown, definitions: readonly MetricDefinition[] = []): MetricsEnvelope {
  const root = obj(json, 'răspuns')
  const meta = obj(root.meta, 'meta')
  const sourceByKey = new Map(definitions.map((d) => [d.metric_key, d.source]))

  const warnings = list(meta.warnings ?? [], 'meta.warnings').map((w, i) => warning(w, `meta.warnings[${i}]`))
  const versions = obj(meta.metric_definition_version ?? {}, 'meta.metric_definition_version')

  const data = list(root.data, 'data').map<MetricResponse>((item, i) => {
    const path = `data[${i}]`
    const o = obj(item, path)
    const key = str(o.metric_key, `${path}.metric_key`)
    const coverage = numOrNull(o.coverage, `${path}.coverage`)
    if (coverage !== null && (coverage < 0 || coverage > 1)) {
      throw new MetricContractError(`${path}.coverage=${coverage} în afara intervalului 0-1`)
    }
    const status: MetricStatus = oneOf(o.status, METRIC_STATUSES, `${path}.status`)
    const unit: MetricUnit = oneOf(o.unit, METRIC_UNITS, `${path}.unit`)
    const version = numOrNull(versions[key], `meta.metric_definition_version.${key}`)
    return {
      metric_key: key,
      value: numOrNull(o.value, `${path}.value`),
      unit,
      numerator: numOrNull(o.numerator, `${path}.numerator`),
      denominator: numOrNull(o.denominator, `${path}.denominator`),
      comparison_value: numOrNull(o.comparison_value, `${path}.comparison_value`),
      absolute_change: numOrNull(o.absolute_change, `${path}.absolute_change`),
      relative_change: numOrNull(o.relative_change, `${path}.relative_change`),
      status,
      data_as_of: strOrNull(o.data_as_of, `${path}.data_as_of`),
      coverage,
      evidence_query: evidenceQuery(o.evidence_query, `${path}.evidence_query`),
      source: sourceByKey.get(key) ?? null,
      metric_definition_version: version,
      warnings: warnings.filter((w) => w.metric_key === key),
    }
  })

  const parsedMeta: MetricsMeta = {
    tenant_id: strOrNull(meta.tenant_id, 'meta.tenant_id'),
    brand_id: str(meta.brand_id, 'meta.brand_id'),
    period: period(meta.period, 'meta.period'),
    comparison_period: period(meta.comparison_period, 'meta.comparison_period'),
    data_as_of: strOrNull(meta.data_as_of, 'meta.data_as_of'),
    generated_at: str(meta.generated_at, 'meta.generated_at'),
    sources: list(meta.sources ?? [], 'meta.sources').map((s, i) => str(s, `meta.sources[${i}]`)),
    coverage: numOrNull(meta.coverage, 'meta.coverage'),
    cohort_version: numOrNull(meta.cohort_version, 'meta.cohort_version'),
    metric_definition_version: Object.fromEntries(
      Object.entries(versions).map(([k, v]) => [k, numOrNull(v, `meta.metric_definition_version.${k}`) ?? 0]),
    ),
    warnings,
  }
  return { data, meta: parsedMeta }
}

const DIRECTIONS = ['higher_is_better', 'lower_is_better', 'neutral'] as const satisfies readonly MetricDirection[]
const LIFECYCLES = ['draft', 'active', 'retired'] as const satisfies readonly MetricLifecycle[]

/** Rândurile din `public.metric_definitions_current` (coloanele din migrație) → `MetricDefinition`. */
export function parseDefinitions(rows: unknown): MetricDefinition[] {
  return list(rows, 'definiții').map((row, i) => {
    const path = `definiții[${i}]`
    const o = obj(row, path)
    const version = numOrNull(o.version, `${path}.version`)
    if (version === null) throw new MetricContractError(`${path}.version lipsește`)
    return {
      metric_key: str(o.metric_key, `${path}.metric_key`),
      version,
      label: str(o.name_ro, `${path}.name_ro`),
      formula: str(o.formula_ro, `${path}.formula_ro`),
      unit: oneOf(o.unit, METRIC_UNITS, `${path}.unit`),
      source: str(o.primary_source, `${path}.primary_source`),
      aggregation_label: strOrNull(o.aggregation_label, `${path}.aggregation_label`),
      direction: oneOf(o.direction, DIRECTIONS, `${path}.direction`),
      lifecycle: oneOf(o.lifecycle, LIFECYCLES, `${path}.lifecycle`),
      lifecycle_note: strOrNull(o.lifecycle_note, `${path}.lifecycle_note`),
      doc_ref: str(o.doc_ref, `${path}.doc_ref`),
    }
  })
}
