import {
  notConnected,
  type AiVisibilityProvider,
  type BrandsProvider,
  type CompetitionProvider,
  type PaidProvider,
  type SearchProvider,
  type SocialProvider,
  type TrafficProvider,
  type DataProviders,
  type InsightsProvider,
  type MentionsProvider,
  type MetricItem,
  type MetricsProvider,
  type QueryContext,
  type SourcesProvider,
} from '../../contracts'
import type { DataClient } from './dataClient'
import { createSupabaseBrands } from './brandsProvider'
import { createSupabaseSources } from './sourcesProvider'
import { comparisonRange } from '../../lib/period'

const NO_SOURCE = 'Sursa nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.'

/** Răspuns pentru o metrică fără sursă: `value` e null, nu 0 (regula 8). Unitatea e necunoscută până la registru. */
export function notConnectedMetric(ctx: QueryContext, metricKey: string): MetricItem {
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
    warnings: [],
  }
}

const metrics: MetricsProvider = {
  definitions: async () => notConnected('Registrul de metrici nu este încă conectat.'),
  // Fără răspuns de server nu există `meta`: UI-ul nu fabrică `tenant_id` sau data generării.
  metrics: async (ctx, keys) => ({ items: keys.map((key) => notConnectedMetric(ctx, key)), meta: null }),
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
  sources: async () => notConnected('Sursa de Listening nu este conectată pentru acest brand.'),
  pvLog: async () => notConnected('Jurnalul de farmacovigilență nu este încă disponibil.'),
  pvPreview: async () => notConnected('Marcarea pentru farmacovigilență nu este încă disponibilă.'),
  pvFlag: async () => notConnected('Marcarea pentru farmacovigilență nu este încă disponibilă.'),
}

const sources: SourcesProvider = {
  statuses: async () => notConnected('Starea surselor nu este încă disponibilă pentru acest brand.'),
  connections: async () => notConnected('Conexiunile surselor nu sunt încă disponibile pentru acest brand.'),
  syncRuns: async () => notConnected('Istoricul sincronizărilor nu este încă disponibil pentru acest brand.'),
  createConnection: async () => notConnected('Conexiunile surselor nu sunt încă disponibile.'),
  setToken: async () => notConnected('Setarea tokenului nu este încă disponibilă.'),
  validate: async () => notConnected('Testarea conexiunii nu este încă disponibilă.'),
}

const brands: BrandsProvider = {
  list: async () => notConnected('Lista spațiilor de brand nu este încă disponibilă.'),
  competitorSet: async () => notConnected('Setul de competitori nu este încă disponibil pentru acest brand.'),
}

const AI_UNAVAILABLE = 'Datele AI Visibility nu sunt încă disponibile pentru acest brand.'
const SEARCH_UNAVAILABLE = 'Datele de search nu sunt încă disponibile pentru acest brand.'

const ai: AiVisibilityProvider = {
  groups: async () => notConnected(AI_UNAVAILABLE),
  engines: async () => notConnected(AI_UNAVAILABLE),
  trends: async () => notConnected(AI_UNAVAILABLE),
  topicMatrix: async () => notConnected(AI_UNAVAILABLE),
  citedSources: async () => notConnected(AI_UNAVAILABLE),
  answers: async () => notConnected(AI_UNAVAILABLE),
  answer: async () => notConnected(AI_UNAVAILABLE),
}

const search: SearchProvider = {
  keywords: async () => notConnected(SEARCH_UNAVAILABLE),
  landingPages: async () => notConnected(SEARCH_UNAVAILABLE),
  contentGaps: async () => notConnected(SEARCH_UNAVAILABLE),
}

const TRAFFIC_UNAVAILABLE = 'Datele de trafic nu sunt încă disponibile pentru acest brand.'
const NO_PAID_IMPORT = 'Nu există date de Paid Media importate pentru acest brand.'
const NO_SOCIAL_IMPORT = 'Nu există date sociale importate pentru acest brand.'

const traffic: TrafficProvider = {
  channels: async () => notConnected(TRAFFIC_UNAVAILABLE),
  aiReferrals: async () => notConnected(TRAFFIC_UNAVAILABLE),
  clarityDevices: async () => notConnected('Datele Microsoft Clarity pe device nu sunt încă disponibile pentru acest brand.'),
  trackingQuality: async () => notConnected('Verificările de tracking nu sunt încă disponibile pentru acest brand.'),
}

const paid: PaidProvider = {
  summary: async () => notConnected(NO_PAID_IMPORT),
  budget: async () => notConnected(NO_PAID_IMPORT),
  series: async () => notConnected(NO_PAID_IMPORT),
  rows: async () => notConnected(NO_PAID_IMPORT),
}

const social: SocialProvider = {
  summary: async () => notConnected(NO_SOCIAL_IMPORT),
  posts: async () => notConnected(NO_SOCIAL_IMPORT),
  groups: async () => notConnected(NO_SOCIAL_IMPORT),
  calendar: async () => notConnected(NO_SOCIAL_IMPORT),
  competitors: async () => notConnected(NO_SOCIAL_IMPORT),
}

const competition: CompetitionProvider = {
  matrix: async () => notConnected('Datele despre competitori nu sunt încă disponibile pentru acest brand.'),
  gaps: async () => notConnected('Datele despre competitori nu sunt încă disponibile pentru acest brand.'),
}

export interface SupabaseProvidersDeps {
  client: DataClient
  now?: () => Date
}

/**
 * Implementarea reală. Administrarea (surse, spații de brand) citește prin sesiunea utilizatorului; restul
 * modulelor rămân `not_connected` până când tabelele și conectorii livrează date, ecran cu ecran.
 * Fără `deps` (de exemplu în teste sau fără configurare Supabase) tot ce e administrativ e `not_connected`.
 */
export function createSupabaseProviders(deps?: SupabaseProvidersDeps): DataProviders {
  const now = deps?.now
  return {
    kind: 'supabase',
    metrics,
    insights,
    mentions,
    sources: deps ? createSupabaseSources(deps.client, now) : sources,
    brands: deps ? createSupabaseBrands(deps.client, now) : brands,
    ai,
    search,
    traffic,
    paid,
    social,
    competition,
  }
}
