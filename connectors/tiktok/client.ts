// Client TikTok Business API: antetul `Access-Token`, răspunsuri `{ code, message, data }` (code 0 = succes, și la HTTP 200).
// Retry pe limitare și erori de server; tokenul nu se loghează.

import { createHash } from 'node:crypto'
import type { CallBudget, FetchLike, Sleep } from '../shared/http-budget.ts'
import { PERMISSION_CODES, THROTTLE_CODES, TIKTOK_BASE_URL, TIKTOK_MIN_INTERVAL_MS, TIKTOK_RETRY_DELAYS_MS, TOKEN_CODES } from './config.ts'

export type TtFailureKind = 'access_denied' | 'permission_denied' | 'rate_limited' | 'server_error' | 'bad_request' | 'network_error' | 'budget_exhausted' | 'invalid_payload'
export type TtFailure = { ok: false; kind: TtFailureKind; status: number | null; code: number | null; message: string }
export type TtResult = { ok: true; data: unknown; payloadHash: string } | TtFailure

export function classify(httpStatus: number, code: number | null): TtFailureKind {
  if (code !== null && TOKEN_CODES.has(code)) return 'access_denied'
  if (code !== null && PERMISSION_CODES.has(code)) return 'permission_denied'
  if ((code !== null && THROTTLE_CODES.has(code)) || httpStatus === 429) return 'rate_limited'
  if ((code !== null && code >= 50000) || httpStatus >= 500) return 'server_error'
  if (httpStatus === 401) return 'access_denied'
  if (httpStatus === 403) return 'permission_denied'
  return 'bad_request'
}

const MESSAGES: Record<TtFailureKind, string> = {
  access_denied: 'TikTok a refuzat tokenul (expirat sau revocat).',
  permission_denied: 'Fără acces la acest advertiser (nu e printre cele autorizate).',
  rate_limited: 'Limita de cereri TikTok e atinsă.',
  server_error: 'Eroare temporară la TikTok.',
  bad_request: 'Cerere respinsă de TikTok.',
  network_error: 'Eroare de rețea.',
  budget_exhausted: 'Bugetul de apeluri al rulării e epuizat.',
  invalid_payload: 'Răspuns TikTok ilizibil.',
}

export type TtClientOptions = { accessToken: string; budget: CallBudget; fetch?: FetchLike; sleep?: Sleep; now?: () => number; baseUrl?: string }

export class TikTokClient {
  readonly budget: CallBudget
  readonly #o: TtClientOptions
  readonly #fetch: FetchLike
  readonly #sleep: Sleep
  readonly #now: () => number
  #last = Number.NEGATIVE_INFINITY

  constructor(o: TtClientOptions) {
    this.#o = o
    this.budget = o.budget
    this.#fetch = o.fetch ?? globalThis.fetch
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = o.now ?? Date.now
  }

  url(path: string, params: Record<string, string | number>): string {
    const u = new URL(`${(this.#o.baseUrl ?? TIKTOK_BASE_URL).replace(/\/+$/, '')}${path}`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    return u.toString()
  }

  async get(path: string, params: Record<string, string | number>): Promise<TtResult> {
    const url = this.url(path, params)
    let last: TtFailure | null = null
    for (let attempt = 0; attempt <= TIKTOK_RETRY_DELAYS_MS.length; attempt++) {
      if (!this.budget.tryConsume()) return { ok: false, kind: 'budget_exhausted', status: null, code: null, message: MESSAGES.budget_exhausted }
      const wait = this.#last + TIKTOK_MIN_INTERVAL_MS - this.#now()
      if (wait > 0) await this.#sleep(wait)
      this.#last = this.#now()
      let res: Response
      try {
        res = await this.#fetch(url, { method: 'GET', headers: { 'Access-Token': this.#o.accessToken, Accept: 'application/json' } })
      } catch (err) {
        last = { ok: false, kind: 'network_error', status: null, code: null, message: `${MESSAGES.network_error} ${(err as Error).message}` }
        if (attempt < TIKTOK_RETRY_DELAYS_MS.length) await this.#sleep(TIKTOK_RETRY_DELAYS_MS[attempt]!)
        continue
      }
      const text = await res.text()
      let body: { code?: unknown; data?: unknown } | null = null
      try {
        body = JSON.parse(text) as { code?: unknown; data?: unknown }
      } catch {
        body = null
      }
      const code = typeof body?.code === 'number' ? body.code : null
      if (res.ok && code === 0) return { ok: true, data: body!.data, payloadHash: createHash('sha256').update(text).digest('hex') }
      if (res.ok && body === null) return { ok: false, kind: 'invalid_payload', status: res.status, code: null, message: MESSAGES.invalid_payload }
      const kind = classify(res.status, code)
      last = { ok: false, kind, status: res.status, code, message: `${MESSAGES[kind]} (HTTP ${res.status}${code !== null ? `, cod ${code}` : ''})` }
      if (kind !== 'rate_limited' && kind !== 'server_error') return last
      if (attempt < TIKTOK_RETRY_DELAYS_MS.length) await this.#sleep(TIKTOK_RETRY_DELAYS_MS[attempt]!)
    }
    return last!
  }
}

/** Reînnoirea tokenului (refresh token valabil un an, după SDK-ul oficial). Întoarce noile câmpuri de token. */
export async function refreshTikTok(fetchFn: FetchLike, app: { appId: string; secret: string }, refreshToken: string, baseUrl = TIKTOK_BASE_URL): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; revoked: boolean; message: string }> {
  let res: Response
  try {
    res = await fetchFn(`${baseUrl}/oauth2/refresh_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: app.appId, secret: app.secret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    })
  } catch (err) {
    return { ok: false, revoked: false, message: `Eroare de rețea la reînnoirea tokenului TikTok: ${(err as Error).message}` }
  }
  const body = (await res.json().catch(() => ({}))) as { code?: unknown; data?: Record<string, unknown> }
  if (res.ok && body.code === 0 && typeof body.data?.access_token === 'string') return { ok: true, data: body.data }
  const code = typeof body.code === 'number' ? body.code : null
  return { ok: false, revoked: code !== null && TOKEN_CODES.has(code), message: `TikTok a refuzat reînnoirea tokenului (HTTP ${res.status}${code !== null ? `, cod ${code}` : ''}). Reconectează contul TikTok.` }
}
