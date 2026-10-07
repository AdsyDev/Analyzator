import { describe, expect, it } from 'vitest'
import { MetricContractError, parseDefinitions, parseMetricsEnvelope } from './mapMetrics'

const period = { start: '2026-09-08', end: '2026-10-05' }
const cmp = { start: '2026-08-11', end: '2026-09-07' }
const eq = (key: string) => ({ metric_key: key, version: 1, brand_id: 'b1', period, comparison_period: cmp })

/** Forma exactă produsă de `metrics.build_response(context, items)` (migrația 20261007140000). */
function payload() {
  return {
    data: [
      {
        metric_key: 'ga4_sessions',
        value: 1240,
        unit: 'count',
        numerator: null,
        denominator: null,
        comparison_value: 1100,
        absolute_change: 140,
        relative_change: 12.727272,
        status: 'ok',
        data_as_of: '2026-10-05',
        coverage: 1,
        evidence_query: eq('ga4_sessions'),
      },
      {
        metric_key: 'gsc_ctr',
        value: null,
        unit: 'percent',
        numerator: '0', // numeric din Postgres poate veni ca text
        denominator: 5400,
        comparison_value: 3.1,
        absolute_change: null,
        relative_change: null,
        status: 'partial',
        data_as_of: '2026-10-03',
        coverage: 0.5,
        evidence_query: eq('gsc_ctr'),
      },
      {
        metric_key: 'clarity_scroll_depth',
        value: null,
        unit: 'percent',
        numerator: null,
        denominator: null,
        comparison_value: null,
        absolute_change: null,
        relative_change: null,
        status: 'not_connected',
        data_as_of: null,
        coverage: null,
        evidence_query: eq('clarity_scroll_depth'),
      },
    ],
    meta: {
      tenant_id: 't1',
      brand_id: 'b1',
      period,
      comparison_period: cmp,
      data_as_of: '2026-10-03',
      generated_at: '2026-10-06T07:00:00+00:00',
      sources: ['clarity', 'ga4', 'gsc'],
      coverage: 0.5,
      cohort_version: null,
      metric_definition_version: { ga4_sessions: 1, gsc_ctr: 1, clarity_scroll_depth: 1 },
      warnings: [
        { metric_key: 'gsc_ctr', code: 'zero_not_confirmed', severity: 'warning', detail: null },
        { metric_key: 'gsc_ctr', code: 'stale', severity: 'warning', detail: null },
        { metric_key: 'ga4_sessions', code: 'incomplete_period', severity: 'info', detail: 'perioadă incompletă' },
        { metric_key: 'gsc_ctr', code: 'excluded_rows', severity: 'warning', detail: { reason: 'missing_weight', count: 2 } },
      ],
    },
  }
}

const defs = parseDefinitions([
  { metric_key: 'ga4_sessions', version: 1, name_ro: 'Sesiuni', formula_ro: 'Sesiuni GA4.', unit: 'count', primary_source: 'ga4', aggregation_label: null, direction: 'higher_is_better', lifecycle: 'active', lifecycle_note: null, doc_ref: 'docs/metrics/registry.md#ga4_sessions' },
  { metric_key: 'gsc_ctr', version: 1, name_ro: 'CTR', formula_ro: '100 × clicks / impressions.', unit: 'percent', primary_source: 'gsc', aggregation_label: null, direction: 'higher_is_better', lifecycle: 'active', lifecycle_note: null, doc_ref: 'x' },
  { metric_key: 'clarity_scroll_depth', version: 1, name_ro: 'Scroll depth', formula_ro: 'Medie ponderată.', unit: 'percent', primary_source: 'clarity', aggregation_label: null, direction: 'higher_is_better', lifecycle: 'draft', lifecycle_note: 'Forma payloadului se confirmă.', doc_ref: 'y' },
])

describe('parseMetricsEnvelope', () => {
  it('mapează câmpurile numerice neschimbate, fără conversii de unități', () => {
    const { data } = parseMetricsEnvelope(payload(), defs)
    const s = data[0]!
    expect(s.value).toBe(1240)
    expect(s.relative_change).toBeCloseTo(12.727272) // procente, nu fracție
    expect(s.coverage).toBe(1)
    expect(s.status).toBe('ok')
  })

  it('numeric ca text devine număr; null rămâne null (nu 0)', () => {
    const { data } = parseMetricsEnvelope(payload(), defs)
    const c = data[1]!
    expect(c.numerator).toBe(0)
    expect(c.value).toBeNull()
    expect(c.relative_change).toBeNull()
    expect(data[2]!.value).toBeNull()
    expect(data[2]!.coverage).toBeNull()
  })

  it('completează sursa din registru și versiunea din meta', () => {
    const { data } = parseMetricsEnvelope(payload(), defs)
    expect(data.map((m) => m.source)).toEqual(['ga4', 'gsc', 'clarity'])
    expect(data.map((m) => m.metric_definition_version)).toEqual([1, 1, 1])
  })

  it('fără definiții, sursa rămâne null, nu se ghicește', () => {
    expect(parseMetricsEnvelope(payload()).data.every((m) => m.source === null)).toBe(true)
  })

  it('alipește avertismentele din meta pe fiecare metrică, după metric_key', () => {
    const { data } = parseMetricsEnvelope(payload(), defs)
    expect(data[0]!.warnings.map((w) => w.code)).toEqual(['incomplete_period'])
    expect(data[1]!.warnings.map((w) => w.code)).toEqual(['zero_not_confirmed', 'stale', 'excluded_rows'])
    expect(data[1]!.warnings[2]!.detail).toEqual({ reason: 'missing_weight', count: 2 })
    expect(data[2]!.warnings).toEqual([])
  })

  it('păstrează meta și cheia dovezii', () => {
    const { data, meta } = parseMetricsEnvelope(payload(), defs)
    expect(meta.data_as_of).toBe('2026-10-03')
    expect(meta.coverage).toBe(0.5)
    expect(meta.sources).toEqual(['clarity', 'ga4', 'gsc'])
    expect(meta.warnings).toHaveLength(4)
    expect(data[0]!.evidence_query).toEqual(eq('ga4_sessions'))
  })

  it('un status necunoscut încalcă contractul (zgomotos, nu silențios)', () => {
    const p = payload()
    ;(p.data[0] as { status: string }).status = 'degraded'
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(MetricContractError)
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(/data\[0\]\.status/)
  })

  it('o unitate din afara registrului încalcă contractul', () => {
    const p = payload()
    ;(p.data[0] as { unit: string }).unit = 'currency'
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(/unit/)
  })

  it('coverage ca procent (0-100) în loc de fracție încalcă contractul', () => {
    const p = payload()
    p.data[0]!.coverage = 82
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(/în afara intervalului 0-1/)
  })

  it('un text în loc de număr încalcă contractul', () => {
    const p = payload()
    ;(p.data[0] as { value: unknown }).value = 'abc'
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(/data\[0\]\.value/)
  })

  it('lipsa evidence_query încalcă contractul', () => {
    const p = payload()
    delete (p.data[0] as { evidence_query?: unknown }).evidence_query
    expect(() => parseMetricsEnvelope(p, defs)).toThrow(/evidence_query/)
  })

  it('un răspuns fără data sau meta încalcă contractul', () => {
    expect(() => parseMetricsEnvelope({ meta: payload().meta }, defs)).toThrow(/data/)
    expect(() => parseMetricsEnvelope({ data: [] }, defs)).toThrow(/meta/)
    expect(() => parseMetricsEnvelope(null, defs)).toThrow(MetricContractError)
  })

  it('lista goală de metrici e validă', () => {
    const p = payload()
    p.data = []
    expect(parseMetricsEnvelope(p, defs).data).toEqual([])
  })
})

describe('parseDefinitions', () => {
  it('mapează coloanele registrului la MetricDefinition', () => {
    expect(defs[2]).toEqual({
      metric_key: 'clarity_scroll_depth',
      version: 1,
      label: 'Scroll depth',
      formula: 'Medie ponderată.',
      unit: 'percent',
      source: 'clarity',
      aggregation_label: null,
      direction: 'higher_is_better',
      lifecycle: 'draft',
      lifecycle_note: 'Forma payloadului se confirmă.',
      doc_ref: 'y',
    })
  })

  it('acceptă toate cele trei direcții', () => {
    const row = { metric_key: 'm', version: 1, name_ro: 'n', formula_ro: 'f', unit: 'position', primary_source: 'gsc', aggregation_label: null, lifecycle: 'active', lifecycle_note: null, doc_ref: 'd' }
    for (const direction of ['higher_is_better', 'lower_is_better', 'neutral']) {
      expect(parseDefinitions([{ ...row, direction }])[0]!.direction).toBe(direction)
    }
  })

  it('respinge o direcție sau o unitate necunoscută', () => {
    const row = { metric_key: 'm', version: 1, name_ro: 'n', formula_ro: 'f', unit: 'count', primary_source: 'gsc', aggregation_label: null, direction: 'higher_is_better', lifecycle: 'active', lifecycle_note: null, doc_ref: 'd' }
    expect(() => parseDefinitions([{ ...row, direction: 'up' }])).toThrow(/direction/)
    expect(() => parseDefinitions([{ ...row, unit: 'ron' }])).toThrow(/unit/)
    expect(() => parseDefinitions([{ ...row, version: null }])).toThrow(/version/)
  })
})
