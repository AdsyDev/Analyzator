import { METRIC_STATUSES, METRIC_UNITS, failed, notConnected, ready, type Evidence, type EvidenceRecord, type MetricDefinition, type MetricsProvider, type MetricStatus, type MetricUnit, type TrendSeries } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { MetricContractError, parseDefinitions, parseMetricsEnvelope } from './mapMetrics'

/** Câte observații cere EvidenceDrawer („Cele mai recente N din total"). */
const EVIDENCE_LIMIT = 10
const EVIDENCE_CONTRACT = 'Răspunsul serverului nu respectă contractul dovezilor.'
const EVIDENCE_NUMBER = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 })
const EVIDENCE_DATE = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Coloanele depind de agregarea din registru: o rată arată numărătorul și numitorul, nu rata gata calculată. */
function evidenceColumns(aggregation: string | null, rows: ReadonlyArray<Record<string, unknown>>): Evidence['columns'] {
  const currency = rows.some((r) => typeof r.currency === 'string') ? [{ key: 'currency', label: 'Monedă' }] : []
  if (aggregation === 'interval_report_only') return [{ key: 'start', label: 'Început' }, { key: 'end', label: 'Sfârșit' }, { key: 'value', label: 'Valoare' }]
  if (aggregation === 'ratio') return [{ key: 'date', label: 'Dată' }, { key: 'numerator', label: 'Numărător' }, { key: 'denominator', label: 'Numitor' }, ...currency]
  if (aggregation === 'weighted_mean') return [{ key: 'date', label: 'Dată' }, { key: 'value', label: 'Valoare' }, { key: 'weight', label: 'Pondere' }]
  return [{ key: 'date', label: 'Dată' }, { key: 'value', label: 'Valoare' }, ...currency]
}

/** Doar formatare. `null` rămâne `null` („Fără date" în drawer), nu devine zero. */
function evidenceCell(key: string, v: unknown): string | number | null {
  if (v === null || v === undefined) return null
  if ((key === 'date' || key === 'start' || key === 'end') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return EVIDENCE_DATE.format(new Date(`${v.slice(0, 10)}T00:00:00Z`))
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && key !== 'currency' ? Number(v) : null
  return n === null ? String(v) : EVIDENCE_NUMBER.format(n)
}

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
          p_kind: serverPeriodKind(ctx.period.preset, ctx.comparison),
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

    // Dovezile (EvidenceDrawer): observațiile din spatele metricii, prin `brand_metric_evidence` (INVOKER, E8). Serverul
    // trimite rândurile și agregarea din registru; etichetele coloanelor și formatarea sunt aici, fără niciun calcul.
    async evidence(brandId, q) {
      const { data, error } = await client.rpc('brand_metric_evidence', { p_brand_id: brandId, p_metric_key: q.metric_key, p_start: q.period.start, p_end: q.period.end, p_device: null, p_limit: EVIDENCE_LIMIT })
      if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Dovezile nu au putut fi încărcate. Reîncearcă.')
      const r = data as { status?: unknown; aggregation?: unknown; total_records?: unknown; records?: unknown } | null
      if (!r || typeof r.status !== 'string' || !Array.isArray(r.records) || typeof r.total_records !== 'number') return failed(EVIDENCE_CONTRACT)
      if (r.status === 'not_connected') return notConnected('Indicatorul nu are o sursă conectată pentru acest brand.')
      if (r.status !== 'ok' && r.status !== 'unavailable') return failed(EVIDENCE_CONTRACT)
      const rows = r.records as Array<Record<string, unknown>>
      const columns = evidenceColumns(typeof r.aggregation === 'string' ? r.aggregation : null, rows)
      const records: EvidenceRecord[] = rows.map((row, i) => ({
        id: `${q.metric_key}:${String(row.date ?? row.end ?? i)}`,
        fields: Object.fromEntries(columns.map((c) => [c.key, evidenceCell(c.key, row[c.key])])),
      }))
      return ready<Evidence>({ evidence_query: q, metric_key: q.metric_key, total_records: r.total_records, records, columns, imported_at: null, payload_hash: null })
    },
  }
}
