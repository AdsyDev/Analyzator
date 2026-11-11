import type { AiAnswerDetail, AiAnswerSummary, AiCitedSource, AiEngineStat, AiEngineTrend, AiFilters, AiTopicMatrix } from './ai'
import type { AiPolicyInput, AiPreferenceInput, AiDraftResult, AiReply, BrandDocument, NewBrandDocument, AiServerStatus, AiSettings } from './assistant'
import type { Brand, CompetitorSet } from './brand'
import type { CompetitionGap, CompetitionMatrix } from './competition'
import type { BrandId, ProviderResult, TenantId } from './common'
import type { ActionTransition, Insight, InsightDraft, InsightTransition, NewAction, NewRecommendation } from './insight'
import type { MentionPage, MentionQuery, Page, PvFlag, PvItemRef, PvLogEntry, PvSnapshot, SentimentDistribution } from './mention'
import type { Evidence, EvidenceQuery, MetricDefinition, MetricsBundle, TrendSeries } from './metric'
import type { QueryContext } from './period'
import type { NewPaidBudget, PaidBudget, PaidFilters, PaidRow, PaidSeries, PaidSummary } from './paid'
import type { ContentGap, IndexStatus, LandingPage, SearchFilters, SearchKeyword } from './search'
import type { SocialCalendarItem, SocialCompetitor, SocialFilters, SocialGroups, SocialPost, SocialSummary } from './social'
import type { ClientsProvider, ConfigProvider, UsersProvider } from './admin'
import type { NewConnection, NewTenantConnection, OAuthProvider, SourceConnection, SourceFreshness, SourceStatusInfo, SyncRun, TenantConnection, TokenSaved, ValidationOutcome, AccountList, AirbyteInspection, DiscoverKind } from './source'
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
  /**
   * Scrierile de mai jos sunt ale echipei agenției (RLS și triggerele verifică rolul, nu interfața). Statusul nu se
   * scrie direct: `transition` și `transitionAction` inserează în jurnalele de tranziții, care aplică regulile.
   */
  /** Creează o ciornă (`id` null) sau îi rescrie textele și dovezile. */
  saveDraft(brand: Brand, id: string | null, draft: InsightDraft): Promise<ProviderResult<{ id: string }>>
  /** Doar ciornele se șterg; o analiză trimisă sau publicată își păstrează istoricul. */
  deleteDraft(id: string): Promise<ProviderResult<null>>
  /** `in_review` (trimite), `draft` (returnează, cu motiv), `published` (publică și îngheață metricile citate). */
  transition(id: string, to: InsightTransition, reason?: string): Promise<ProviderResult<null>>
  /** O versiune nouă, în ciornă, a unei analize publicate; serverul îi copiază dovezile și recomandările. */
  supersede(brand: Brand, insight: Insight): Promise<ProviderResult<{ id: string }>>
  /** Recomandările se adaugă și se șterg doar cât analiza e ciornă. */
  addRecommendation(brand: Brand, insightId: string, rec: NewRecommendation): Promise<ProviderResult<null>>
  deleteRecommendation(id: string): Promise<ProviderResult<null>>
  /** Acțiune nouă pe o analiză; fără `owner_id`, responsabilul e utilizatorul curent. */
  addAction(brand: Brand, insightId: string, action: NewAction): Promise<ProviderResult<null>>
  transitionAction(actionId: string, transition: ActionTransition): Promise<ProviderResult<null>>
}

export interface MentionsProvider {
  list(ctx: QueryContext, query: MentionQuery): Promise<ProviderResult<MentionPage>>
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
  /** Actualitatea datelor pe sursă, vizibilă oricui are acces la brand (inclusiv clientul). */
  freshness(brandId: BrandId): Promise<ProviderResult<SourceFreshness[]>>
  /** Doar agenția (agency_admin pentru credențiale). */
  connections(brandId: BrandId): Promise<ProviderResult<SourceConnection[]>>
  syncRuns(brandId: BrandId): Promise<ProviderResult<SyncRun[]>>
  /** Doar `agency_admin` (RLS). Creează conexiunea; tokenul se setează apoi cu `setToken`. */
  createConnection(brandId: BrandId, input: NewConnection): Promise<ProviderResult<SourceConnection>>
  /** Funcția server `source-credentials`, `set_token`. Tokenul nu se păstrează și nu se loghează. */
  setToken(connectionId: string, token: string): Promise<ProviderResult<TokenSaved>>
  /** Funcția server `source-credentials`, `validate`. Consumă 1 din bugetul zilnic de apeluri. */
  validate(connectionId: string): Promise<ProviderResult<ValidationOutcome>>
  /**
   * Funcția server `source-credentials`, `list_accounts`: conturile pe care le vede cheia clientului (conexiunea de
   * client dată), pentru selectorul din pagina site-ului. Doar `agency_admin`; cheia nu ajunge în browser.
   */
  listAccounts(tenantConnectionId: string, kind: DiscoverKind, campaignId?: string): Promise<ProviderResult<AccountList>>
  /**
   * Funcția server `airbyte`, `inspect`: tabelele, conturile și metricile din destinația Postgres Airbyte a clientului.
   * Doar `agency_admin`; consumă din limita zilnică de inspecții. Connection string-ul nu ajunge în browser.
   */
  inspectAirbyte(tenantConnectionId: string): Promise<ProviderResult<AirbyteInspection>>
  /** Conturile la nivel de client (Google, SEOmonitor); doar agenția (RLS). */
  tenantConnections(tenantId: TenantId): Promise<ProviderResult<TenantConnection[]>>
  /** Doar `agency_admin` (RLS). Tokenul se setează apoi cu `setToken`. */
  createTenantConnection(tenantId: TenantId, input: NewTenantConnection): Promise<ProviderResult<TenantConnection>>
  /**
   * Funcția server `oauth`, `start`: adresa de autorizare la furnizor. Tokenul nu trece prin browser; furnizorul se
   * întoarce la funcția server, care îl scrie în Vault și redirecționează spre pagina site-ului ales (prin `/admin/sources`).
   */
  startOAuth(tenantId: TenantId, provider: OAuthProvider, accountLabel: string | null): Promise<ProviderResult<{ authorize_url: string }>>
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
  /** Ultima inspecție a fiecărui URL și lista prioritară; nu depinde de perioada aleasă. */
  indexStatus(brandId: BrandId): Promise<ProviderResult<IndexStatus>>
  /** Lista prioritară o scrie echipa agenției cu acces la brand (RLS verifică rolul, nu interfața). */
  addIndexUrl(brand: Brand, url: string): Promise<ProviderResult<null>>
  removeIndexUrl(id: string): Promise<ProviderResult<null>>
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
  /** Planul în vigoare la sfârșitul perioadei alese; fără plan, `approved_budget` e `null`. */
  budget(ctx: QueryContext): Promise<ProviderResult<PaidBudget>>
  /** Scrierile sunt ale echipei agenției cu acces la brand (RLS verifică rolul, nu interfața). */
  saveBudget(brand: Brand, budget: NewPaidBudget): Promise<ProviderResult<null>>
  deleteBudget(id: string): Promise<ProviderResult<null>>
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

/** AdSy AI (Etapa 4): controalele și chatul pe dovezi. Modelul e chemat doar de funcția server `adsy-ai`. */
export interface AssistantProvider {
  settings(brandId: BrandId): Promise<ProviderResult<AiSettings>>
  serverStatus(brandId: BrandId): Promise<ProviderResult<AiServerStatus>>
  /** Doar `agency_admin` (RLS); schimbarea se auditează. */
  savePolicy(brand: Brand, policy: AiPolicyInput): Promise<ProviderResult<null>>
  /** Preferința utilizatorului curent pe acest brand. */
  savePreference(brand: Brand, preference: AiPreferenceInput): Promise<ProviderResult<null>>
  /** O întrebare despre brand, pe perioada din context. Serverul verifică din nou controalele și dovezile. */
  ask(ctx: QueryContext, question: string): Promise<ProviderResult<AiReply>>
  /**
   * Cere o ciornă de analiză pe perioada din context. Serverul o scrie în `insights` ca ciornă marcată „generată”, doar
   * dacă a trecut verificarea cifrelor; publicarea rămâne a echipei, prin review.
   */
  generateInsight(ctx: QueryContext): Promise<ProviderResult<AiDraftResult>>
  /** Documentele brandului: toate statusurile pentru echipă, doar cele aprobate pentru client (RLS). */
  documents(brandId: BrandId): Promise<ProviderResult<BrandDocument[]>>
  /** Adaugă un document ca ciornă, cu textul împărțit în fragmente. Introducerea nu îl aprobă. */
  addDocument(brand: Brand, doc: NewBrandDocument): Promise<ProviderResult<{ id: string }>>
  /** `approved` (doar strategist sau agency_admin; cere responsabil și început de valabilitate) sau `retired`. */
  setDocumentStatus(brand: Brand, id: string, status: 'approved' | 'retired'): Promise<ProviderResult<null>>
  /** Doar ciornele se șterg. */
  deleteDocument(brand: Brand, id: string): Promise<ProviderResult<null>>
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
  assistant: AssistantProvider
  users: UsersProvider
  config: ConfigProvider
  clients: ClientsProvider
}
