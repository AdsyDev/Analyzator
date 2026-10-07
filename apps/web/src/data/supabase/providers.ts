import {
  notConnected,
  type BrandsProvider,
  type DataProviders,
  type InsightsProvider,
  type MentionsProvider,
  type MetricResponse,
  type MetricsProvider,
  type QueryContext,
  type SourcesProvider,
} from '../../contracts'
import { comparisonRange } from '../../lib/period'

const NO_SOURCE = 'Sursa nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.'

/** Răspuns pentru o metrică fără sursă: `value` e null, nu 0 (regula 8). Unitatea e necunoscută până la registru. */
export function notConnectedMetric(ctx: QueryContext, metricKey: string): MetricResponse {
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  return {
    metric_key: metricKey,
    value: null,
    unit: 'count',
    numerator: null,
    denominator: null,
    comparison_value: null,
    absolute_change: null,
    relative_change: null,
    status: 'not_connected',
    data_as_of: null,
    coverage: null,
    evidence_query: {
      metric_key: metricKey,
      version: 0,
      brand_id: ctx.brandId,
      period: { start: ctx.period.from, end: ctx.period.to },
      comparison_period: { start: cmp.from, end: cmp.to },
    },
    source: null,
    metric_definition_version: null,
    warnings: [],
  }
}

const metrics: MetricsProvider = {
  definitions: async () => notConnected('Registrul de metrici nu este încă conectat.'),
  metrics: async (ctx, keys) => {
    const cmp = comparisonRange(ctx.period, ctx.comparison)
    return {
      data: keys.map((key) => notConnectedMetric(ctx, key)),
      meta: {
        tenant_id: null,
        brand_id: ctx.brandId,
        period: { start: ctx.period.from, end: ctx.period.to },
        comparison_period: { start: cmp.from, end: cmp.to },
        data_as_of: null,
        generated_at: new Date().toISOString(),
        sources: [],
        coverage: null,
        cohort_version: null,
        metric_definition_version: {},
        warnings: [],
      },
    }
  },
  trends: async (_ctx, keys) =>
    keys.map((key) => ({
      metric_key: key,
      label: key,
      unit: 'count' as const,
      points: [],
      comparison_points: null,
      status: 'not_connected' as const,
    })),
  evidence: async () => notConnected(NO_SOURCE),
}

const insights: InsightsProvider = { list: async () => notConnected('Analizele nu sunt încă disponibile pentru acest brand.') }

const mentions: MentionsProvider = {
  list: async () => notConnected('Sursa de Listening nu este conectată pentru acest brand.'),
  sentiment: async () => notConnected('Sursa de Listening nu este conectată pentru acest brand.'),
  pvLog: async () => notConnected('Jurnalul de farmacovigilență nu este încă disponibil.'),
  pvPreview: async () => notConnected('Marcarea pentru farmacovigilență nu este încă disponibilă.'),
  pvFlag: async () => notConnected('Marcarea pentru farmacovigilență nu este încă disponibilă.'),
}

const sources: SourcesProvider = {
  statuses: async () => notConnected('Starea surselor nu este încă disponibilă pentru acest brand.'),
  connections: async () => notConnected('Conexiunile surselor nu sunt încă disponibile pentru acest brand.'),
  syncRuns: async () => notConnected('Istoricul sincronizărilor nu este încă disponibil pentru acest brand.'),
}

const brands: BrandsProvider = {
  list: async () => notConnected('Lista spațiilor de brand nu este încă disponibilă.'),
  competitorSet: async () => notConnected('Setul de competitori nu este încă disponibil pentru acest brand.'),
}

/**
 * Implementarea reală. Rămâne goală: fiecare provider se completează ecran cu ecran, pe măsură ce
 * tabelele și conectorii livrează date (UI-6 pentru Administrare, apoi restul modulelor).
 */
export function createSupabaseProviders(): DataProviders {
  return { kind: 'supabase', metrics, insights, mentions, sources, brands }
}
