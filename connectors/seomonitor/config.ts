// Constantele conectorului SEOmonitor (API 3.0). Sursa: https://api-docs.seomonitor.com (citită 2026-10-08).
// Configurarea per client vine din source_connections (provider = 'seomonitor', external_account_id = company_id);
// tokenul e în Supabase Vault și se citește prin get_source_token (service role).

export const SEOMONITOR_BASE_URL = 'https://apigw.seomonitor.com/v3'
export const SEOMONITOR_SCHEMA_VERSION = 'docs-2026-10-08'

/** Limitele documentate: 10 cereri/secundă, 1.000 de rânduri per cerere, 10.000 de cereri pe zi. */
export const SEOMONITOR_DAILY_QUOTA = 10_000
export const SEOMONITOR_MIN_INTERVAL_MS = 110
export const SEOMONITOR_PAGE_SIZE = 1000
export const SEOMONITOR_CAMPAIGN_PAGE_SIZE = 100
/** Sub atâtea apeluri rămase azi (UTC) rularea nu pornește. */
export const SEOMONITOR_MIN_BUDGET_TO_START = 50
/** Siguranță: o paginare care nu se termină după atâtea pagini e oprită (`pagination_stalled`). */
export const SEOMONITOR_MAX_PAGES = 1000

/** Retry: 1, 5 și 15 minute, cu jitter ±20%; Retry-After are prioritate. */
export const SEOMONITOR_RETRY_DELAYS_MS = [60_000, 300_000, 900_000]
export const SEOMONITOR_MAX_RETRY_WAIT_MS = 20 * 60_000

/** Reimport pentru datele mutabile. */
export const SEOMONITOR_LOOKBACK_DAYS = 35

/** Valorile documentate pentru ai_search_llm / gpt_provider. */
export const AI_SEARCH_ENGINES = ['openai', 'gemini', 'perplexity'] as const
export type AiSearchEngine = (typeof AI_SEARCH_ENGINES)[number]

/** Grupuri speciale (documentate): 0 = toate keywords, -1 = Brand folder, -2 = negrupate, -3 = obiectivul Forecast. */
export const SPECIAL_GROUP_BRAND = '-1'

export const ROUTES = {
  campaigns: '/dashboard/v3.0/campaigns/tracked',
  groups: '/rank-tracker/v3.0/groups',
  keywords: '/rank-tracker/v3.0/keywords',
  dailyRanks: '/rank-tracker/v3.0/keywords/daily-ranks',
  groupVisibility: '/rank-tracker/v3.0/groups/daily-visibility',
  keywordsAis: '/rank-tracker/v3.0/keywords/ais',
  dailyRanksAis: '/rank-tracker/v3.0/keywords/daily-ranks/ais',
  competitionAis: '/rank-tracker/v3.0/keywords/competition/ais',
  aisMentions: '/rank-tracker/v3.0/groups/daily-visibility/ais-mentions',
  aisCitations: '/rank-tracker/v3.0/groups/daily-visibility/ais-citations',
  aisStats: '/rank-tracker/v3.0/ais/stats',
  aio: '/rank-tracker/v3.0/keywords/aio',
} as const
export type RouteKey = keyof typeof ROUTES
