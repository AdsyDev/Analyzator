// Constantele conectorului TikTok Ads (Business API v1.3). Surse: SDK-ul oficial TikTok (github.com/tiktok/tiktok-business-api-sdk)
// și documentația Marketing API, citite 2026-10-12. Contract: docs/contracts/tiktok-ads.md.

export const TIKTOK_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3'
export const TIKTOK_SCHEMA_VERSION = 'tiktok-v1.3'

export const TIKTOK_CREDENTIAL_PROVIDER = 'tiktok_account'
export const TIKTOK_PROVIDER = 'tiktok_ads'
export const TIKTOK_SOURCE = 'tiktok_ads'

export const TIKTOK_MIN_INTERVAL_MS = 300
export const TIKTOK_RETRY_DELAYS_MS = [10_000, 60_000, 300_000]
export const TIKTOK_MAX_CALLS = 1_000
export const TIKTOK_PAGE_SIZE = 1000
export const TIKTOK_MAX_PAGES = 100
export const TIKTOK_LOOKBACK_DAYS = 35
/** Intervalul maxim al unui raport zilnic (de confirmat): fereastra de 35 de zile se cere în bucăți. */
export const TIKTOK_MAX_RANGE_DAYS = 30

/** Codurile din corpul răspunsului (`code`), după documentația „Return codes”; de confirmat la prima rulare. */
export const TOKEN_CODES = new Set([40102, 40104, 40105])
export const PERMISSION_CODES = new Set([40001, 40002, 40003])
export const THROTTLE_CODES = new Set([40100, 40133, 50002])
