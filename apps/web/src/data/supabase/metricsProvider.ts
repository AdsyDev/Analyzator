import { METRIC_STATUSES, METRIC_UNITS, notConnected, type MetricDefinition, type MetricsProvider, type MetricStatus, type MetricUnit, type TrendSeries } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { MetricContractError, parseDefinitions, parseMetricsEnvelope } from './mapMetrics'

const DEFINITION_COLUMNS = 'metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation_label, direction, lifecycle, lifecycle_note, doc_ref'

/**
 * Metricile ecranelor de brand, calculate în SQL: `brand_metrics` și `brand_metric_trends` (RPC SECURITY INVOKER, E8).
 * UI-ul trimite doar cheile, perioada și brandul; valorile, comparația și statusurile vin de la server (regula 4).
 */
export function createSupabaseMetrics(client: DataClient): MetricsProvider {
  let cache: Promise<MetricDefinition[]> | null = null
  function allDefinitions(): Promise<MetricDefinition[]> {
    cache ??= (async () => {
      const { data, error } = await client.from('metric_definitions_current').select(DEFINITION_COLUMNS)
      if (error) {
        cache = null
        throw new Error('Registrul de metrici nu a putut fi citit.')
      }
      return parseDefinitions(data ?? [])
    })()
    return cache
  }

  return {
    async definitions(keys) {
      try {
        const all = await allDefinitions()
        return { kind: 'ready', data: all.filter((d) => keys.includes(d.metric_key)) }
      } catch (e) {
        return { kind: 'error', message: (e as Error).message }
      }
    },

    async metrics(ctx, keys) {
      const [defs, res] = await Promise.all([
        allDefinitions().catch(() => [] as MetricDefinition[]),
        client.rpc('brand_metrics', {
          p_brand_id: ctx.brandId,
          p_metric_keys: [...keys],
          p_start: ctx.period.from,
          p_end: ctx.period.to,
          p_kind: serverPeriodKind(ctx.period.preset),
          p_device: ctx.filters?.device ?? null,
        }),
      ])
      if (res.error) throw new Error(res.error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Metricile nu au putut fi calculate. Reîncearcă.')
      return parseMetricsEnvelope(res.data, defs)
    },

    async trends(ctx, keys) {
      const { data, error } = await client.rpc('brand_metric_trends', {
        p_brand_id: ctx.brandId,
        p_metric_keys: [...keys],
        p_start: ctx.period.from,
        p_end: ctx.period.to,
        p_device: ctx.filters?.device ?? null,
      })
      if (error) throw new Error('Seriile nu au putut fi încărcate. Reîncearcă.')
      if (!Array.isArray(data)) throw new MetricContractError('seriile trebuie să fie listă')
      return data.map((s, i): TrendSeries => {
        const o = s as Record<string, unknown>
        if (typeof o.metric_key !== 'string' || !Array.isArray(o.points)) throw new MetricContractError(`serii[${i}] invalidă`)
        if (!(METRIC_STATUSES as readonly string[]).includes(String(o.status))) throw new MetricContractError(`serii[${i}].status invalid`)
        if (!(METRIC_UNITS as readonly string[]).includes(String(o.unit))) throw new MetricContractError(`serii[${i}].unit invalid`)
        return {
          metric_key: o.metric_key,
          label: typeof o.label === 'string' ? o.label : o.metric_key,
          unit: o.unit as MetricUnit,
          status: o.status as MetricStatus,
          comparison_points: null,
          points: o.points.map((p, j) => {
            const q = p as { date?: unknown; value?: unknown }
            if (typeof q.date !== 'string') throw new MetricContractError(`serii[${i}].points[${j}].date`)
            const v = q.value === null || q.value === undefined ? null : Number(q.value)
            if (v !== null && !Number.isFinite(v)) throw new MetricContractError(`serii[${i}].points[${j}].value`)
            return { date: q.date, value: v }
          }),
        }
      })
    },

    // Dovezile (EvidenceDrawer) cer rândurile sursă per metrică: contract separat, încă neconstruit.
    evidence: async () => notConnected('Dovezile pentru această metrică nu sunt încă disponibile.'),
  }
}
