// Constantele conectorului Planable (Public API v1). Sursa: https://api.planable.io/api/v1/openapi.json (citită 2026-10-12).
// Contract: docs/contracts/planable.md. Tokenul (pln_…) e la nivel de client, în Vault; workspace-ul e pe brand.

export const PLANABLE_BASE_URL = 'https://api.planable.io/api/v1'
export const PLANABLE_SCHEMA_VERSION = 'openapi-2026-10-12'

/** Conexiunea la nivel de client (token) și conexiunea pe brand (workspace). */
export const PLANABLE_CREDENTIAL_PROVIDER = 'planable_account'
export const PLANABLE_PROVIDER = 'planable'

/** Sursele din sync_runs și source_status, aceleași ca la importul CSV. */
export const SOURCE_ANALYTICS = 'planable_analytics'
export const SOURCE_LISTENING = 'planable_listening'

/** Limitele nu sunt documentate (doar 429): ritm conservator, cel mult 4 cereri pe secundă. */
export const PLANABLE_MIN_INTERVAL_MS = 250
export const PLANABLE_RETRY_DELAYS_MS = [5_000, 30_000, 120_000]
export const PLANABLE_MAX_RETRY_WAIT_MS = 5 * 60_000
/** Plafon de siguranță pe rulare (toate brandurile clientului). */
export const PLANABLE_MAX_CALLS = 5_000
/** Dimensiunea paginii pentru /pages și /posts (maximul nu e documentat). */
export const PLANABLE_PAGE_SIZE = 50
/** /pages/{id}/metrics: maximum 90 (documentat). */
export const PLANABLE_METRICS_PAGE_SIZE = 90
/** /keywords/{id}/mentions: maximum 100 (documentat). */
export const PLANABLE_MENTIONS_PAGE_SIZE = 100
/** Siguranță: o paginare care nu se termină după atâtea pagini e oprită. */
export const PLANABLE_MAX_PAGES = 200

export const PLANABLE_LOOKBACK_DAYS = 35
