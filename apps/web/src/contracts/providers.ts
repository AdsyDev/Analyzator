import type { AiAnswerDetail, AiAnswerSummary, AiCitedSource, AiEngineStat, AiEngineTrend, AiFilters, AiTopicMatrix } from './ai'
import type { Brand, CompetitorSet } from './brand'
import type { BrandId, ProviderResult } from './common'
import type { Insight } from './insight'
import type { Mention, MentionQuery, Page, PvFlag, PvItemRef, PvSnapshot, SentimentDistribution } from './mention'
import type { Evidence, EvidenceQuery, MetricDefinition, MetricsBundle, TrendSeries } from './metric'
import type { QueryContext } from './period'
import type { ContentGap, LandingPage, SearchFilters, SearchKeyword } from './search'
import type { SourceConnection, SourceStatusInfo, SyncRun } from './source'

/**
 * Stratul de date. Ecranele și componentele cer date doar prin aceste interfețe (spec cap. 26);
 * nu știu dacă răspunsul vine din Supabase sau din fixtures în modul de previzualizare.
 */

export interface MetricsProvider {
  /** Definițiile din registrul de metrici (tooltip, formulă). */
  definitions(keys: readonly string[]): Promise<ProviderResult<MetricDefinition[]>>
  /** Un `MetricItem` per cheie cerută, în aceeași ordine; o metrică fără sursă primește `not_connected`. */
  metrics(ctx: QueryContext, keys: readonly string[]): Promise<MetricsBundle>
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

/** AI Visibility (spec cap. 13). Toate cererile primesc contextul din URL și filtrele ecranului. */
export interface AiVisibilityProvider {
  /** Grupurile de întrebări (topicuri) ale brandului, pentru filtrul „grup". */
  groups(brandId: BrandId): Promise<ProviderResult<string[]>>
  engines(ctx: QueryContext, f: AiFilters): Promise<ProviderResult<AiEngineStat[]>>
  trends(ctx: QueryContext, f: AiFilters): Promise<ProviderResult<AiEngineTrend[]>>
  topicMatrix(ctx: QueryContext, f: AiFilters): Promise<ProviderResult<AiTopicMatrix>>
  citedSources(ctx: QueryContext, f: AiFilters): Promise<ProviderResult<AiCitedSource[]>>
  answers(ctx: QueryContext, f: AiFilters, page: { page: number; page_size: number }): Promise<ProviderResult<Page<AiAnswerSummary>>>
  answer(brandId: BrandId, id: string): Promise<ProviderResult<AiAnswerDetail>>
}

/** SEO și Search (spec cap. 14). Liste de mărime de pilot: sortarea și paginarea se fac în interfață. */
export interface SearchProvider {
  keywords(ctx: QueryContext, f: SearchFilters): Promise<ProviderResult<SearchKeyword[]>>
  landingPages(ctx: QueryContext): Promise<ProviderResult<LandingPage[]>>
  contentGaps(ctx: QueryContext): Promise<ProviderResult<ContentGap[]>>
}

export interface DataProviders {
  /** `supabase` pe implicit; `fixtures` doar cu VITE_DESIGN_PREVIEW la build. */
  readonly kind: 'supabase' | 'fixtures'
  metrics: MetricsProvider
  insights: InsightsProvider
  mentions: MentionsProvider
  sources: SourcesProvider
  brands: BrandsProvider
  ai: AiVisibilityProvider
  search: SearchProvider
}
