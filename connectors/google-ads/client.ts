// Client Google Ads API (REST): access token din refresh token-ul OAuth, apoi googleAds:search paginat.
// Antete: Authorization Bearer, developer-token, login-customer-id (MCC). Niciun token sau secret nu se loghează.

import { createHash } from 'node:crypto'
import type { CallBudget, FetchLike, Sleep } from '../shared/http-budget.ts'
import { parseRetryAfter } from '../shared/http-budget.ts'
import { GOOGLE_ADS_BASE_URL, GOOGLE_ADS_MIN_INTERVAL_MS, GOOGLE_ADS_RETRY_DELAYS_MS, GOOGLE_TOKEN_URL } from './config.ts'

export type AdsFailureKind = 'access_denied' | 'permission_denied' | 'rate_limited' | 'server_error' | 'bad_request' | 'network_error' | 'budget_exhausted' | 'invalid_payload'
export type AdsFailure = { ok: false; kind: AdsFailureKind; status: number | null; errorCode: string | null; message: string }
export type AdsResult = { ok: true; payload: unknown; payloadHash: string } | AdsFailure

export type OAuthApp = { clientId: string; clientSecret: string }

/** Refresh token → access token. `invalid_grant` = tokenul a fost revocat sau a expirat: credențialul e invalid. */
export async function accessToken(fetchFn: FetchLike, app: OAuthApp, refreshToken: string): Promise<{ ok: true; token: string } | { ok: false; revoked: boolean; message: string }> {
  let res: Response
  try {
    res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.clientId, client_secret: app.clientSecret }).toString(),
    })
  } catch (err) {
    return { ok: false, revoked: false, message: `Eroare de rețea la Google OAuth: ${(err as Error).message}` }
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: unknown; error?: unknown }
  if (res.ok && typeof body.access_token === 'string') return { ok: true, token: body.access_token }
  if (body.error === 'invalid_grant') return { ok: false, revoked: true, message: 'Google a refuzat refresh token-ul (revocat sau expirat). Reconectează contul Google Ads.' }
  return { ok: false, revoked: false, message: `Google OAuth a răspuns ${res.status}${typeof body.error === 'string' ? ` (${body.error})` : ''}.` }
}

/** Primul cod de eroare Google Ads din detalii (de ex. DEVELOPER_TOKEN_NOT_APPROVED), dacă există. */
export function adsErrorCode(body: unknown): string | null {
  const details = (body as { error?: { details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }> }> } })?.error?.details ?? []
  for (const d of details) for (const e of d.errors ?? []) {
    const v = e.errorCode && Object.values(e.errorCode)[0]
    if (typeof v === 'string') return v
  }
  return null
}

const MESSAGES: Record<AdsFailureKind, string> = {
  access_denied: 'Google Ads a refuzat autentificarea.',
  permission_denied: 'Fără acces la acest cont (developer token neaprobat, cont în afara MCC-ului sau fără drept de citire).',
  rate_limited: 'Limita de cereri Google Ads e atinsă.',
  server_error: 'Eroare temporară la Google Ads.',
  bad_request: 'Cerere respinsă de Google Ads.',
  network_error: 'Eroare de rețea.',
  budget_exhausted: 'Bugetul de apeluri al rulării e epuizat.',
  invalid_payload: 'Răspuns Google Ads ilizibil.',
}

export function classify(status: number): AdsFailureKind {
  if (status === 401) return 'access_denied'
  if (status === 403) return 'permission_denied'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'bad_request'
}

export type AdsClientOptions = { accessToken: string; developerToken: string; loginCustomerId: string; budget: CallBudget; fetch?: FetchLike; sleep?: Sleep; now?: () => number; baseUrl?: string }

export class GoogleAdsClient {
  readonly budget: CallBudget
  readonly #o: AdsClientOptions
  readonly #fetch: FetchLike
  readonly #sleep: Sleep
  readonly #now: () => number
  #last = Number.NEGATIVE_INFINITY

  constructor(o: AdsClientOptions) {
    this.#o = o
    this.budget = o.budget
    this.#fetch = o.fetch ?? globalThis.fetch
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = o.now ?? Date.now
  }

  async search(customerId: string, query: string, pageToken?: string): Promise<AdsResult> {
    if (!/^\d{10}$/.test(customerId)) throw new Error(`customer ID invalid: ${customerId}`)
    const url = `${(this.#o.baseUrl ?? GOOGLE_ADS_BASE_URL).replace(/\/+$/, '')}/customers/${customerId}/googleAds:search`
    let last: AdsFailure | null = null
    for (let attempt = 0; attempt <= GOOGLE_ADS_RETRY_DELAYS_MS.length; attempt++) {
      if (!this.budget.tryConsume()) return { ok: false, kind: 'budget_exhausted', status: null, errorCode: null, message: MESSAGES.budget_exhausted }
      const wait = this.#last + GOOGLE_ADS_MIN_INTERVAL_MS - this.#now()
      if (wait > 0) await this.#sleep(wait)
      this.#last = this.#now()
      let res: Response
      try {
        res = await this.#fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#o.accessToken}`,
            'developer-token': this.#o.developerToken,
            'login-customer-id': this.#o.loginCustomerId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
        })
      } catch (err) {
        last = { ok: false, kind: 'network_error', status: null, errorCode: null, message: `${MESSAGES.network_error} ${(err as Error).message}` }
        if (attempt < GOOGLE_ADS_RETRY_DELAYS_MS.length) await this.#sleep(GOOGLE_ADS_RETRY_DELAYS_MS[attempt]!)
        continue
      }
      const text = await res.text()
      if (res.ok) {
        try {
          return { ok: true, payload: JSON.parse(text), payloadHash: createHash('sha256').update(text).digest('hex') }
        } catch {
          return { ok: false, kind: 'invalid_payload', status: res.status, errorCode: null, message: MESSAGES.invalid_payload }
        }
      }
      let body: unknown = null
      try {
        body = JSON.parse(text)
      } catch {
        // corp non-JSON
      }
      const kind = classify(res.status)
      const errorCode = adsErrorCode(body)
      last = { ok: false, kind, status: res.status, errorCode, message: `${MESSAGES[kind]} (HTTP ${res.status}${errorCode ? `, ${errorCode}` : ''})` }
      if (kind !== 'rate_limited' && kind !== 'server_error') return last
      if (attempt < GOOGLE_ADS_RETRY_DELAYS_MS.length) await this.#sleep(parseRetryAfter(res.headers.get('retry-after'), this.#now()) ?? GOOGLE_ADS_RETRY_DELAYS_MS[attempt]!)
    }
    return last!
  }
}
