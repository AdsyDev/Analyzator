// Constantele conectorilor GA4 și Search Console. Contract: docs/contracts/google.md.

/** Credențialul unui tenant: un singur JSON de service account (în Vault), fără brand. */
export const GOOGLE_CREDENTIAL_PROVIDER = 'google_service_account'
export const GA4_PROVIDER = 'ga4'
export const GSC_PROVIDER = 'gsc'

export const GOOGLE_SCHEMA_VERSION = 'docs-2026-10-08'
/** Reimport al ultimelor 35 de zile (până ieri), conform specificației cap. 9. */
export const GOOGLE_LOOKBACK_DAYS = 35

export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

/** runReport: maximum 250.000 de rânduri per cerere; paginare cu offset. */
export const GA4_PAGE_SIZE = 100_000
export const GA4_MAX_PAGES = 20

/** Search Analytics: rowLimit între 1 și 25.000; paginare cu startRow. */
export const GSC_ROW_LIMIT = 25_000
/** Plafon de siguranță pe numărul de pagini la query × page (peste el, run partial). */
export const GSC_MAX_PAGES = 40
/** Datele GSC sunt interpretate și întoarse în PT, indiferent de proprietate. */
export const GSC_TIMEZONE = 'America/Los_Angeles'
/** `final`: fără zilele încă incomplete (implicit în API). */
export const GSC_DATA_STATE = 'final'

export const RETRY_ATTEMPTS = 3
export const RETRY_BASE_DELAY_MS = 1000

/** Toleranță la reconciliere (procente), per sursă. */
export const RECONCILE_TOLERANCE_PCT = { ga4: 1, gsc: 0.5 } as const
