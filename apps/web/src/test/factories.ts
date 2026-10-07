import type { EvidenceQuery, MetricItem, MetricWarning } from '../contracts'

/** Fabrici pentru teste. Valorile sunt de test și nu se importă din cod de aplicație. */
export function evidenceQuery(over: Partial<EvidenceQuery> = {}): EvidenceQuery {
  return {
    metric_key: 'ga4_sessions',
    version: 1,
    brand_id: 'b1',
    period: { start: '2026-09-08', end: '2026-10-05' },
    comparison_period: { start: '2026-08-11', end: '2026-09-07' },
    ...over,
  }
}

export function warning(code: string, over: Partial<MetricWarning> = {}): MetricWarning {
  return { metric_key: 'ga4_sessions', code, severity: 'warning', detail: null, ...over }
}

export function metric(over: Partial<MetricItem> = {}): MetricItem {
  return {
    metric_key: 'ga4_sessions',
    value: 1240,
    unit: 'count',
    numerator: null,
    denominator: null,
    comparison_value: 1100,
    absolute_change: 140,
    relative_change: 12.7, // procente, ca în `metrics.change`
    status: 'ok',
    data_as_of: '2026-10-05',
    coverage: 1, // fracție 0-1
    evidence_query: evidenceQuery(),
    source: 'ga4',
    warnings: [],
    ...over,
  }
}
