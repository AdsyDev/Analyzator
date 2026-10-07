import definitionsFile from '../../../../../tests/fixtures/ui/definitions.json'
import profilesFile from '../../../../../tests/fixtures/ui/metric-profiles.json'
import type {
  Evidence,
  MetricDefinition,
  MetricStatus,
  MetricUnit,
  MetricWarning,
  MetricsEnvelope,
  QueryContext,
  TrendSeries,
} from '../../contracts'
import { addDays, comparisonRange, daysBetween, serverPeriodKind } from '../../lib/period'
import { parseDefinitions, parseMetricsEnvelope } from '../supabase/mapMetrics'
import { fakeHash, unit } from './rng'

interface BrandOverride {
  scale?: number
  trend_pct?: number
  status?: MetricStatus
  coverage?: number
  stale_days?: number
  comparison_zero?: boolean
  value_null?: boolean
  warnings?: Array<{ code: string; severity: 'info' | 'warning'; detail: string | null }>
}
interface Profile {
  unit: MetricUnit
  aggregate: 'sum' | 'mean' | 'last'
  daily_base: number
  noise: number
  trend_pct: number
  brands: Record<string, BrandOverride>
}

const profiles = profilesFile.profiles as unknown as Record<string, Profile>
const ANCHOR = profilesFile.anchor_date

/** Definițiile fictive, validate cu parserul real al registrului. */
export const FIXTURE_DEFINITIONS: MetricDefinition[] = parseDefinitions(definitionsFile.rows)
const definitionByKey = new Map(FIXTURE_DEFINITIONS.map((d) => [d.metric_key, d]))

function dates(from: string, to: string): string[] {
  const n = daysBetween(from, to) + 1
  return Array.from({ length: n }, (_, i) => addDays(from, i))
}

/** Valoarea fictivă a unei zile: nivel de bază × trend lent × zgomot determinist. Nu e o formulă de metrică. */
function dailyValue(p: Profile, ov: BrandOverride, brandId: string, key: string, date: string): number {
  const trend = ov.trend_pct ?? p.trend_pct
  const factor = 1 + (trend / 100) * (daysBetween(ANCHOR, date) / 28)
  const noise = 1 + p.noise * (unit(`${brandId}:${key}:${date}`) * 2 - 1)
  const v = p.daily_base * (ov.scale ?? 1) * factor * noise
  const bounded = p.unit === 'percent' ? Math.min(100, Math.max(0, v)) : Math.max(0, v)
  return p.unit === 'count' ? Math.round(bounded) : Math.round(bounded * 100) / 100
}

function series(p: Profile, ov: BrandOverride, brandId: string, key: string, from: string, to: string, holes: boolean): Array<number | null> {
  const days = dates(from, to)
  const values: Array<number | null> = days.map((d) => dailyValue(p, ov, brandId, key, d))
  if (!holes) return values
  const status = ov.status ?? 'ok'
  if (status === 'stale') {
    const lag = Math.min(ov.stale_days ?? 3, days.length)
    for (let i = days.length - lag; i < days.length; i++) values[i] = null
  }
  if (status === 'partial') {
    const gap = Math.max(1, Math.round((1 - (ov.coverage ?? 0.8)) * days.length))
    const end = Math.max(gap - 1, days.length - 1 - 8)
    for (let i = end - gap + 1; i <= end; i++) if (i >= 0) values[i] = null
  }
  return values
}

/**
 * Agregare fictivă pentru date fictive. Stă în fixtures (doar previzualizare), nu în componente:
 * regula 4 interzice formulele de metrici în UI; aici doar fabricăm numere plauzibile.
 */
function aggregate(p: Profile, values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return null
  const total = nums.reduce((a, b) => a + b, 0)
  const out = p.aggregate === 'sum' ? total : p.aggregate === 'last' ? (nums[nums.length - 1] ?? null) : total / nums.length
  if (out === null) return null
  return p.unit === 'count' ? Math.round(out) : Math.round(out * 100) / 100
}

function warningsFor(key: string, ov: BrandOverride, ctx: QueryContext, status: MetricStatus): MetricWarning[] {
  const out: MetricWarning[] = (ov.warnings ?? []).map((w) => ({ metric_key: key, code: w.code, severity: w.severity, detail: w.detail }))
  const def = definitionByKey.get(key)
  if (def?.lifecycle === 'draft') out.push({ metric_key: key, code: 'definition_draft', severity: 'info', detail: def.lifecycle_note })
  if (def?.aggregation_label) out.push({ metric_key: key, code: 'aggregation_label', severity: 'info', detail: def.aggregation_label })
  if (serverPeriodKind(ctx.period.preset) === 'mtd') out.push({ metric_key: key, code: 'incomplete_period', severity: 'info', detail: 'perioadă incompletă' })
  // Ca în SQL: o condiție secundară rămâne vizibilă ca avertisment.
  if (status === 'stale') out.push({ metric_key: key, code: 'partial', severity: 'warning', detail: null })
  return out
}

interface BuiltMetric {
  item: Record<string, unknown>
  warnings: MetricWarning[]
  status: MetricStatus
  values: Array<number | null>
  cmpValues: Array<number | null>
  dataAsOf: string | null
  imported: string | null
}

function build(ctx: QueryContext, key: string): BuiltMetric {
  const p = profiles[key]
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  const evidence_query = {
    metric_key: key,
    version: 1,
    brand_id: ctx.brandId,
    period: { start: ctx.period.from, end: ctx.period.to },
    comparison_period: { start: cmp.from, end: cmp.to },
  }
  const base = { metric_key: key, numerator: null, denominator: null, comparison_value: null, absolute_change: null, relative_change: null, evidence_query }
  if (!p) {
    // Cheie fără profil: nicio sursă, nicio valoare inventată.
    return { item: { ...base, value: null, unit: 'count', status: 'not_connected', data_as_of: null, coverage: null }, warnings: [], status: 'not_connected', values: [], cmpValues: [], dataAsOf: null, imported: null }
  }
  const ov = p.brands[ctx.brandId] ?? {}
  const status = ov.status ?? 'ok'
  const warnings = warningsFor(key, ov, ctx, status)

  if (status === 'not_connected' || status === 'unavailable') {
    return {
      item: { ...base, value: null, unit: p.unit, status, data_as_of: null, coverage: null },
      warnings,
      status,
      values: [],
      cmpValues: [],
      dataAsOf: null,
      imported: null,
    }
  }

  const values = series(p, ov, ctx.brandId, key, ctx.period.from, ctx.period.to, true)
  const cmpValues = series(p, ov, ctx.brandId, key, cmp.from, cmp.to, false)
  const nonNull = values.filter((v) => v !== null).length
  const coverage = Math.round((nonNull / values.length) * 10000) / 10000
  const lag = status === 'stale' ? (ov.stale_days ?? 3) : 0
  const dataAsOf = addDays(ctx.period.to, -lag)

  if (status === 'cannot_compute') {
    return { item: { ...base, numerator: 0, denominator: 0, value: null, unit: p.unit, status, data_as_of: ctx.period.to, coverage: 1 }, warnings, status, values, cmpValues, dataAsOf: ctx.period.to, imported: ctx.period.to }
  }

  const value = ov.value_null ? null : aggregate(p, values)
  const comparison = ov.comparison_zero ? 0 : aggregate(p, cmpValues)
  // Stand-in pentru `metrics.change` (doar fixtures): variația relativă în procente, null la bază zero.
  const absolute = value === null || comparison === null ? null : Math.round((value - comparison) * 100) / 100
  const relative = value === null || comparison === null || comparison === 0 ? null : Math.round(((100 * (value - comparison)) / Math.abs(comparison)) * 100) / 100

  return {
    item: { ...base, value, unit: p.unit, comparison_value: comparison, absolute_change: absolute, relative_change: relative, status, data_as_of: dataAsOf, coverage: status === 'stale' ? Math.round(((values.length - lag) / values.length) * 10000) / 10000 : coverage },
    warnings,
    status,
    values,
    cmpValues,
    dataAsOf,
    imported: addDays(dataAsOf, 1),
  }
}

/** Răspunsul `data` + `meta`, în forma `metrics.build_response`, trecut prin parserul real al contractului. */
export function fixtureMetrics(ctx: QueryContext, keys: readonly string[], now: Date): MetricsEnvelope {
  const built = keys.map((k) => build(ctx, k))
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  const asOf = built.map((b) => b.item.data_as_of).filter((d): d is string => typeof d === 'string').sort()[0] ?? null
  const covs = built.map((b) => b.item.coverage).filter((c): c is number => typeof c === 'number')
  const payload = {
    data: built.map((b) => b.item),
    meta: {
      tenant_id: 'tenant-stada-preview',
      brand_id: ctx.brandId,
      period: { start: ctx.period.from, end: ctx.period.to },
      comparison_period: { start: cmp.from, end: cmp.to },
      data_as_of: asOf,
      generated_at: now.toISOString(),
      sources: [...new Set(keys.map((k) => definitionByKey.get(k)?.source).filter((s): s is string => !!s))].sort(),
      coverage: covs.length ? Math.min(...covs) : null,
      cohort_version: null,
      metric_definition_version: Object.fromEntries(keys.map((k) => [k, 1])),
      warnings: built.flatMap((b) => b.warnings),
    },
  }
  return parseMetricsEnvelope(payload, FIXTURE_DEFINITIONS)
}

export function fixtureTrends(ctx: QueryContext, keys: readonly string[]): TrendSeries[] {
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  return keys.map((key) => {
    const b = build(ctx, key)
    const def = definitionByKey.get(key)
    const days = dates(ctx.period.from, ctx.period.to)
    const sameLength = b.cmpValues.length === days.length
    const cmpDays = dates(cmp.from, cmp.to)
    return {
      metric_key: key,
      label: def?.label ?? key,
      unit: def?.unit ?? 'count',
      points: b.values.length ? days.map((date, i) => ({ date, value: b.values[i] ?? null })) : [],
      comparison_points: b.values.length && sameLength ? cmpDays.map((date, i) => ({ date, value: b.cmpValues[i] ?? null })) : null,
      status: b.status,
    }
  })
}

export function fixtureEvidence(ctx: QueryContext, key: string): Evidence | null {
  const b = build(ctx, key)
  if (b.values.length === 0) return null
  const days = dates(ctx.period.from, ctx.period.to)
  const records = days
    .map((date, i) => ({ id: `${key}:${date}`, fields: { date, value: b.values[i] ?? null } as Record<string, string | number | null> }))
    .reverse()
    .slice(0, 10)
  return {
    evidence_query: b.item.evidence_query as Evidence['evidence_query'],
    metric_key: key,
    total_records: days.length,
    records,
    columns: [
      { key: 'date', label: 'Dată' },
      { key: 'value', label: 'Valoare' },
    ],
    imported_at: b.imported ? `${b.imported}T06:00:00+03:00` : null,
    payload_hash: fakeHash(`${ctx.brandId}:${key}:${ctx.period.from}:${ctx.period.to}`),
  }
}
