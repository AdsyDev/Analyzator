import type { Brand, CompetitorSet } from './brand'
import type { BrandId, ProviderResult } from './common'
import type { Insight } from './insight'
import type { Mention, MentionQuery, Page, PvFlag, PvItemRef, PvSnapshot, SentimentDistribution } from './mention'
import type { Evidence, EvidenceQuery, MetricDefinition, MetricsEnvelope, TrendSeries } from './metric'
import type { QueryContext } from './period'
import type { SourceConnection, SourceStatusInfo, SyncRun } from './source'

/**
 * Stratul de date. Ecranele și componentele cer date doar prin aceste interfețe (spec cap. 26);
 * nu știu dacă răspunsul vine din Supabase sau din fixtures în modul de previzualizare.
 */

export interface MetricsProvider {
  /** Definițiile din registrul de metrici (tooltip, formulă). */
  definitions(keys: readonly string[]): Promise<ProviderResult<MetricDefinition[]>>
  /** Învelișul `data` + `meta` (spec cap. 26): un `MetricResponse` per cheie cerută, în aceeași ordine; o metrică fără sursă primește `not_connected`. */
  metrics(ctx: QueryContext, keys: readonly string[]): Promise<MetricsEnvelope>
  trends(ctx: QueryContext, keys: readonly string[]): Promise<TrendSeries[]>
  evidence(brandId: BrandId, evidenceQuery: EvidenceQuery): Promise<ProviderResult<Evidence>>
}

export interface InsightsProvider {
  /** Clientul primește doar analizele publicate (RLS); agenția primește toate statusurile. */
  list(ctx: QueryContext): Promise<ProviderResult<Insight[]>>
}

export interface MentionsProvider {
  list(ctx: QueryContext, query: MentionQuery): Promise<ProviderResult<Page<Mention>>>
  sentiment(ctx: QueryContext): Promise<ProviderResult<SentimentDistribution>>
  /** Doar agenția și contactele PV. */
  pvLog(ctx: QueryContext): Promise<ProviderResult<PvFlag[]>>
  /** Ce se va înregistra, pentru dialogul de confirmare. */
  pvPreview(brandId: BrandId, item: PvItemRef): Promise<ProviderResult<PvSnapshot>>
  pvFlag(brandId: BrandId, item: PvItemRef): Promise<ProviderResult<PvFlag>>
}

export interface SourcesProvider {
  statuses(brandId: BrandId): Promise<ProviderResult<SourceStatusInfo[]>>
  /** Doar agenția (agency_admin pentru credențiale). */
  connections(brandId: BrandId): Promise<ProviderResult<SourceConnection[]>>
  syncRuns(brandId: BrandId): Promise<ProviderResult<SyncRun[]>>
}

export interface BrandsProvider {
  /** Exclusiv brandurile permise utilizatorului (RLS). */
  list(): Promise<ProviderResult<Brand[]>>
  competitorSet(brandId: BrandId): Promise<ProviderResult<CompetitorSet>>
}

export interface DataProviders {
  /** `supabase` pe implicit; `fixtures` doar cu VITE_DESIGN_PREVIEW la build. */
  readonly kind: 'supabase' | 'fixtures'
  metrics: MetricsProvider
  insights: InsightsProvider
  mentions: MentionsProvider
  sources: SourcesProvider
  brands: BrandsProvider
}
