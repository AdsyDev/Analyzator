// Constantele conectorului Google Ads (Google Ads API v25, versiunea majoră curentă la 2026-10-12; sunset anunțat în 2027).
// Contract: docs/contracts/google-ads.md. Refresh token-ul OAuth e la nivel de client (Vault); contul (customer ID) e pe brand.

export const GOOGLE_ADS_API_VERSION = 'v25'
export const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ADS_SCHEMA_VERSION = `googleads-${GOOGLE_ADS_API_VERSION}`

export const GOOGLE_ADS_CREDENTIAL_PROVIDER = 'google_ads_account'
export const GOOGLE_ADS_PROVIDER = 'google_ads'
export const GOOGLE_ADS_SOURCE = 'google_ads'

export const GOOGLE_ADS_MIN_INTERVAL_MS = 300
export const GOOGLE_ADS_RETRY_DELAYS_MS = [10_000, 60_000, 300_000]
export const GOOGLE_ADS_MAX_CALLS = 1_000
export const GOOGLE_ADS_MAX_PAGES = 200
export const GOOGLE_ADS_LOOKBACK_DAYS = 35

export const CUSTOMER_QUERY = 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer'

/** Nivel campanie, pe zi: include și campaniile fără grupuri de reclame (Performance Max). */
export function campaignQuery(start: string, end: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('interval invalid')
  return (
    'SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions ' +
    `FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`
  )
}
