import type { AiAnswerDetail, AiAnswerSummary, AiCitedSource, AiEngineStat, AiEngineTrend, AiFilters, AiTopicMatrix } from './ai'
import type { Brand, CompetitorSet } from './brand'
import type { CompetitionGap, CompetitionMatrix } from './competition'
import type { BrandId, ProviderResult } from './common'
import type { Insight } from './insight'
import type { Mention, MentionQuery, Page, PvFlag, PvItemRef, PvLogEntry, PvSnapshot, SentimentDistribution } from './mention'
import type { Evidence, EvidenceQuery, MetricDefinition, MetricsBundle, TrendSeries } from './metric'
import type { QueryContext } from './period'
import type { PaidBudget, PaidFilters, PaidRow, PaidSeries, PaidSummary } from './paid'
import type { ContentGap, LandingPage, SearchFilters, SearchKeyword } from './search'
import type { SocialCalendarItem, SocialCompetitor, SocialFilters, SocialGroups, SocialPost, SocialSummary } from './social'
import type { ConfigProvider, UsersProvider } from './admin'
import type { NewConnection, SourceConnection, SourceStatusInfo, SyncRun, TokenSaved, ValidationOutcome } from './source'
import type { AiReferrals, ClarityDevices, Device, TrackingQuality, TrafficChannels } from './traffic'

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
  /** Sursele distincte ale mențiunilor, pentru filtrul de sursă. */
  sources(brandId: BrandId): Promise<ProviderResult<string[]>>
  /** Doar `agency_admin` (brief cap. 6, spec cap. 28); ceilalți primesc eroare de acces. */
  pvLog(ctx: QueryContext): Promise<ProviderResult<PvLogEntry[]>>
  /** Ce se va înregistra, pentru dialogul de confirmare. */
  pvPreview(brandId: BrandId, item: PvItemRef): Promise<ProviderResult<PvSnapshot>>
  pvFlag(brandId: BrandId, item: PvItemRef): Promise<ProviderResult<PvFlag>>
}

export interface SourcesProvider {
  statuses(brandId: BrandId): Promise<ProviderResult<SourceStatusInfo[]>>
  /** Doar agenția (agency_admin pentru credențiale). */
  connections(brandId: BrandId): Promise<ProviderResult<SourceConnection[]>>
  syncRuns(brandId: BrandId): Promise<ProviderResult<SyncRun[]>>
  /** Doar `agency_admin` (RLS). Creează conexiunea; tokenul se setează apoi cu `setToken`. */
  createConnection(brandId: BrandId, input: NewConnection): Promise<ProviderResult<SourceConnection>>
  /** Funcția server `source-credentials`, `set_token`. Tokenul nu se păstrează și nu se loghează. */
  setToken(connectionId: string, token: string): Promise<ProviderResult<TokenSaved>>
  /** Funcția server `source-credentials`, `validate`. Consumă 1 din bugetul zilnic de apeluri. */
  validate(connectionId: string): Promise<ProviderResult<ValidationOutcome>>
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

/** Trafic și conversii (spec cap. 16). KPI-urile GA4 și Clarity ale brandului vin din registru prin `MetricsProvider`. */
export interface TrafficProvider {
  channels(ctx: QueryContext, device: Device | null): Promise<ProviderResult<TrafficChannels>>
  aiReferrals(ctx: QueryContext): Promise<ProviderResult<AiReferrals>>
  /** Clarity pe device, pentru metricile din registru (`clarity_*`); coloana „Toate" vine din registru. */
  clarityDevices(ctx: QueryContext): Promise<ProviderResult<ClarityDevices>>
  trackingQuality(ctx: QueryContext): Promise<ProviderResult<TrackingQuality>>
}

/**
 * Paid Media (spec cap. 15), date din exporturi. `summary` este poarta paginii: `not_connected` înseamnă că nu
 * există niciun import pentru brand, iar pagina arată „Sursă neconectată" cu acțiunea „Importă CSV".
 */
export interface PaidProvider {
  summary(ctx: QueryContext, f: PaidFilters): Promise<ProviderResult<PaidSummary>>
  budget(ctx: QueryContext): Promise<ProviderResult<PaidBudget>>
  series(ctx: QueryContext, f: PaidFilters): Promise<ProviderResult<PaidSeries>>
  rows(ctx: QueryContext, f: PaidFilters): Promise<ProviderResult<PaidRow[]>>
}

/** Social propriu (spec cap. 17), date din Planable. `summary` e poarta paginii, ca la `PaidProvider`. */
export interface SocialProvider {
  summary(ctx: QueryContext, f: SocialFilters): Promise<ProviderResult<SocialSummary>>
  posts(ctx: QueryContext, f: SocialFilters): Promise<ProviderResult<SocialPost[]>>
  groups(ctx: QueryContext, f: SocialFilters): Promise<ProviderResult<SocialGroups>>
  calendar(ctx: QueryContext, f: SocialFilters): Promise<ProviderResult<SocialCalendarItem[]>>
  competitors(ctx: QueryContext): Promise<ProviderResult<SocialCompetitor[]>>
}

/** Concurență (spec cap. 20): matricea comparativă și tabelul „Unde apare concurența și noi lipsim". */
export interface CompetitionProvider {
  matrix(ctx: QueryContext): Promise<ProviderResult<CompetitionMatrix>>
  gaps(ctx: QueryContext): Promise<ProviderResult<CompetitionGap[]>>
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
  traffic: TrafficProvider
  paid: PaidProvider
  social: SocialProvider
  competition: CompetitionProvider
  users: UsersProvider
  config: ConfigProvider
}
