// Constantele conectorului Meta Ads (Marketing API, Graph API v26.0, versiunea curentă la 2026-10-12).
// Contract: docs/contracts/meta-ads.md. Tokenul (system user, ads_read) e la nivel de client, în Vault; contul de ads e pe brand.

export const META_API_VERSION = 'v26.0'
export const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`
export const META_SCHEMA_VERSION = `graph-${META_API_VERSION}`

export const META_CREDENTIAL_PROVIDER = 'meta_account'
export const META_PROVIDER = 'meta_ads'
export const META_SOURCE = 'meta_ads'

/** Câmpurile cerute la /insights (nivel reclamă, pe zi). */
export const INSIGHT_FIELDS = [
  'date_start', 'account_id', 'account_name', 'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'spend', 'impressions', 'clicks', 'account_currency',
] as const

/** Ritm conservator: limitele Meta sunt pe utilizare (X-Business-Use-Case-Usage), nu un număr fix de cereri. */
export const META_MIN_INTERVAL_MS = 500
export const META_RETRY_DELAYS_MS = [10_000, 60_000, 300_000]
export const META_MAX_CALLS = 2_000
export const META_PAGE_SIZE = 500
export const META_MAX_PAGES = 400
export const META_LOOKBACK_DAYS = 35

/** Codurile de eroare Graph: token invalid/expirat, permisiuni, limite (documentația „Handling errors”). */
export const TOKEN_ERROR_CODES = new Set([102, 190])
export const PERMISSION_ERROR_CODES = new Set([10, 200, 294])
export const THROTTLE_ERROR_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014])
export const TRANSIENT_ERROR_CODES = new Set([1, 2])
