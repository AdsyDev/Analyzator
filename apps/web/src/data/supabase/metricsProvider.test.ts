import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseMetrics } from './metricsProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const def = { metric_key: 'meta_ads_spend', version: 2, name_ro: 'Cost Meta', formula_ro: 'Suma costurilor.', unit: 'currency', primary_source: 'meta_ads', aggregation_label: null, direction: 'neutral', lifecycle: 'active', lifecycle_note: null, doc_ref: 'x' }
const envelope = {
  data: [{ metric_key: 'meta_ads_spend', value: 70, unit: 'currency', currency: 'RON', numerator: null, denominator: null, comparison_value: 50, absolute_change: 20, relative_change: 40, status: 'ok', data_as_of: '2026-10-07', coverage: 1, evidence_query: { metric_key: 'meta_ads_spend', version: 2, brand_id: 'b1', period: { start: '2026-09-10', end: '2026-10-07' }, comparison_period: { start: '2026-08-13', end: '2026-09-09' } } }],
  meta: { tenant_id: 't1', brand_id: 'b1', period: { start: '2026-09-10', end: '2026-10-07' }, comparison_period: { start: '2026-08-13', end: '2026-09-09' }, data_as_of: '2026-10-07', generated_at: '2026-10-08T07:00:00Z', sources: ['meta_ads'], coverage: 1, cohort_version: null, metric_definition_version: { meta_ads_spend: 2 }, warnings: [] },
}

describe('createSupabaseMetrics', () => {
  it('cere brand_metrics cu brandul, cheile și perioada; valoarea vine neschimbată de la server', async () => {
    const { client, rpcs } = fakeDataClient({ tables: { metric_definitions_current: [def] }, rpc: () => ({ data: envelope }) })
    const bundle = await createSupabaseMetrics(client).metrics(ctx, ['meta_ads_spend'])
    expect(rpcs[0]).toEqual({ fn: 'brand_metrics', args: { p_brand_id: 'b1', p_metric_keys: ['meta_ads_spend'], p_start: '2026-09-10', p_end: '2026-10-07', p_kind: 'custom', p_device: null } })
    expect(bundle.items[0]).toMatchObject({ metric_key: 'meta_ads_spend', value: 70, relative_change: 40, status: 'ok', source: 'meta_ads' })
  })

  it('o eroare de acces devine un mesaj în română, nu o valoare', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ error: { code: '42501', message: 'x' } }) })
    await expect(createSupabaseMetrics(client).metrics(ctx, ['meta_ads_spend'])).rejects.toThrow('Nu ai acces la acest spațiu de brand.')
  })

  it('seriile: null rămâne null, statusul și unitatea se validează', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: [{ metric_key: 'meta_ads_spend', label: 'Cost Meta', unit: 'currency', status: 'ok', points: [{ date: '2026-10-06', value: null }, { date: '2026-10-07', value: '10' }] }] }) })
    const [s] = await createSupabaseMetrics(client).trends(ctx, ['meta_ads_spend'])
    expect(s!.points).toEqual([{ date: '2026-10-06', value: null }, { date: '2026-10-07', value: 10 }])
    const bad = fakeDataClient({ rpc: () => ({ data: [{ metric_key: 'x', unit: 'count', status: 'inventat', points: [] }] }) })
    await expect(createSupabaseMetrics(bad.client).trends(ctx, ['x'])).rejects.toThrow(/status invalid/)
  })

  describe('dovezi (brand_metric_evidence)', () => {
    const q = { metric_key: 'meta_ads_spend', version: 2, brand_id: 'b1', period: { start: '2026-09-10', end: '2026-10-07' }, comparison_period: { start: '2026-08-13', end: '2026-09-09' } }

    it('cere observațiile metricii pe perioada dovezii; valorile vin neschimbate, doar formatate, cu totalul lor', async () => {
      const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { status: 'ok', aggregation: 'sum', total_records: 28, records: [{ date: '2026-10-07', value: 1234.5, currency: 'RON' }, { date: '2026-10-06', value: null, currency: 'RON' }] } }) })
      const r = await createSupabaseMetrics(client).evidence('b1', q)
      expect(rpcs[0]).toEqual({ fn: 'brand_metric_evidence', args: { p_brand_id: 'b1', p_metric_key: 'meta_ads_spend', p_start: '2026-09-10', p_end: '2026-10-07', p_device: null, p_limit: 10 } })
      expect(r.kind).toBe('ready')
      if (r.kind !== 'ready') return
      expect(r.data.total_records).toBe(28)
      expect(r.data.columns.map((c) => c.label)).toEqual(['Dată', 'Valoare', 'Monedă'])
      expect(r.data.records[0]).toEqual({ id: 'meta_ads_spend:2026-10-07', fields: { date: '7 oct. 2026', value: '1.234,5', currency: 'RON' } })
      // O zi fără valoare rămâne lipsă, nu zero.
      expect(r.data.records[1]?.fields.value).toBeNull()
      expect(r.data.evidence_query).toBe(q)
      expect(r.data.payload_hash).toBeNull()
    })

    it('o rată arată numărătorul și numitorul; o medie ponderată, ponderea; raportul pe interval, capetele', async () => {
      const cols = async (aggregation: string, row: Record<string, unknown>) => {
        const { client } = fakeDataClient({ rpc: () => ({ data: { status: 'ok', aggregation, total_records: 1, records: [row] } }) })
        const r = await createSupabaseMetrics(client).evidence('b1', q)
        return r.kind === 'ready' ? r.data.columns.map((c) => c.key) : r.kind
      }
      expect(await cols('ratio', { date: '2026-10-07', numerator: 10, denominator: 100 })).toEqual(['date', 'numerator', 'denominator'])
      expect(await cols('weighted_mean', { date: '2026-10-07', value: 52, weight: 300 })).toEqual(['date', 'value', 'weight'])
      expect(await cols('interval_report_only', { start: '2026-09-10', end: '2026-10-07', value: 900 })).toEqual(['start', 'end', 'value'])
    })

    it('sursă neconectată, interval fără observații și eroare de acces sunt trei răspunsuri diferite', async () => {
      const ask = async (rpc: () => { data?: unknown; error?: unknown }) => createSupabaseMetrics(fakeDataClient({ rpc }).client).evidence('b1', q)
      expect(await ask(() => ({ data: { status: 'not_connected', aggregation: null, total_records: 0, records: [] } }))).toEqual({ kind: 'not_connected', reason: 'Indicatorul nu are o sursă conectată pentru acest brand.' })
      const empty = await ask(() => ({ data: { status: 'unavailable', aggregation: 'sum', total_records: 0, records: [] } }))
      expect(empty.kind === 'ready' && empty.data.records).toEqual([])
      expect(await ask(() => ({ error: { code: '42501', message: 'x' } }))).toEqual({ kind: 'error', message: 'Nu ai acces la acest spațiu de brand.' })
    })

    it('un răspuns în afara contractului e eroare, nu o listă goală', async () => {
      const ask = async (data: unknown) => createSupabaseMetrics(fakeDataClient({ rpc: () => ({ data }) }).client).evidence('b1', q)
      for (const bad of [null, { status: 'ok' }, { status: 'inventat', total_records: 0, records: [] }, { status: 'ok', total_records: '3', records: [] }]) {
        expect((await ask(bad)).kind).toBe('error')
      }
    })
  })

  it('definițiile vin din registru, filtrate pe chei', async () => {
    const { client } = fakeDataClient({ tables: { metric_definitions_current: [def, { ...def, metric_key: 'altceva' }] } })
    const r = await createSupabaseMetrics(client).definitions(['meta_ads_spend'])
    expect(r.kind === 'ready' && r.data.map((d) => d.metric_key)).toEqual(['meta_ads_spend'])
  })
})
