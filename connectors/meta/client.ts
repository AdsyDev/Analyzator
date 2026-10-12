// Client Meta Graph API: Authorization Bearer <token system user>, doar GET, retry pe limitare și erori tranzitorii.
// Meta întoarce erorile de token și de limită ca HTTP 400 cu `error.code` în corp, deci clasificarea citește corpul.
// Tokenul nu se loghează și nu apare în mesaje (inclusiv în URL-urile `paging.next`, care se curăță).

import { createHash } from 'node:crypto'
import type { CallBudget, FetchLike, Sleep } from '../shared/http-budget.ts'
import { parseRetryAfter } from '../shared/http-budget.ts'
import {
  META_BASE_URL,
  META_MIN_INTERVAL_MS,
  META_RETRY_DELAYS_MS,
  PERMISSION_ERROR_CODES,
  THROTTLE_ERROR_CODES,
  TOKEN_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
} from './config.ts'

export type MetaFailureKind = 'access_denied' | 'permission_denied' | 'rate_limited' | 'server_error' | 'bad_request' | 'network_error' | 'budget_exhausted' | 'invalid_payload'
export type MetaFailure = { ok: false; kind: MetaFailureKind; status: number | null; code: number | null; message: string }
export type MetaResult = { ok: true; payload: unknown; payloadHash: string } | MetaFailure

export type MetaClientOptions = { token: string; budget: CallBudget; fetch?: FetchLike; sleep?: Sleep; now?: () => number; baseUrl?: string }

export function classify(status: number, code: number | null): MetaFailureKind {
  if (code !== null && TOKEN_ERROR_CODES.has(code)) return 'access_denied'
  if (code !== null && PERMISSION_ERROR_CODES.has(code)) return 'permission_denied'
  if ((code !== null && THROTTLE_ERROR_CODES.has(code)) || status === 429) return 'rate_limited'
  if ((code !== null && TRANSIENT_ERROR_CODES.has(code)) || status >= 500) return 'server_error'
  if (status === 401) return 'access_denied'
  if (status === 403) return 'permission_denied'
  return 'bad_request'
}

const MESSAGES: Record<MetaFailureKind, string> = {
  access_denied: 'Token refuzat de Meta (invalid, expirat sau revocat).',
  permission_denied: 'Tokenul nu are drept pe acest cont de ads (ads_read sau atribuirea contului lipsește).',
  rate_limited: 'Limita de utilizare Meta e atinsă.',
  server_error: 'Eroare temporară la Meta.',
  bad_request: 'Cerere respinsă de Meta (parametri invalizi sau cont inexistent).',
  network_error: 'Eroare de rețea.',
  budget_exhausted: 'Bugetul de apeluri al rulării e epuizat.',
  invalid_payload: 'Răspuns Meta ilizibil.',
}

export class MetaClient {
  readonly budget: CallBudget
  readonly #token: string
  readonly #fetch: FetchLike
  readonly #sleep: Sleep
  readonly #now: () => number
  readonly #baseUrl: string
  #last = Number.NEGATIVE_INFINITY

  constructor(o: MetaClientOptions) {
    if (!o.token) throw new Error('Token Meta lipsă.')
    this.#token = o.token
    this.budget = o.budget
    this.#fetch = o.fetch ?? globalThis.fetch
    this.#sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = o.now ?? Date.now
    this.#baseUrl = (o.baseUrl ?? META_BASE_URL).replace(/\/+$/, '')
  }

  url(path: string, params: Record<string, string | number | undefined> = {}): string {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v))
    const qs = search.toString()
    return `${this.#baseUrl}${path}${qs ? `?${qs}` : ''}`
  }

  /** `paging.next` poate conține `access_token`: îl scoatem; autentificarea rămâne doar în antet. */
  static cleanNext(next: string): string {
    const u = new URL(next)
    u.searchParams.delete('access_token')
    return u.toString()
  }

  async get(url: string): Promise<MetaResult> {
    let last: MetaFailure | null = null
    for (let attempt = 0; attempt <= META_RETRY_DELAYS_MS.length; attempt++) {
      if (!this.budget.tryConsume()) return { ok: false, kind: 'budget_exhausted', status: null, code: null, message: MESSAGES.budget_exhausted }
      const wait = this.#last + META_MIN_INTERVAL_MS - this.#now()
      if (wait > 0) await this.#sleep(wait)
      this.#last = this.#now()
      let res: Response
      try {
        res = await this.#fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' } })
      } catch (err) {
        last = { ok: false, kind: 'network_error', status: null, code: null, message: `${MESSAGES.network_error} ${(err as Error).message}` }
        if (attempt < META_RETRY_DELAYS_MS.length) await this.#sleep(META_RETRY_DELAYS_MS[attempt]!)
        continue
      }
      const body = await res.text()
      if (res.ok) {
        try {
          return { ok: true, payload: JSON.parse(body), payloadHash: createHash('sha256').update(body).digest('hex') }
        } catch {
          return { ok: false, kind: 'invalid_payload', status: res.status, code: null, message: MESSAGES.invalid_payload }
        }
      }
      let code: number | null = null
      try {
        const e = (JSON.parse(body) as { error?: { code?: unknown } }).error
        code = typeof e?.code === 'number' ? e.code : null
      } catch {
        // corp non-JSON
      }
      const kind = classify(res.status, code)
      last = { ok: false, kind, status: res.status, code, message: `${MESSAGES[kind]} (HTTP ${res.status}${code !== null ? `, cod ${code}` : ''})` }
      if (kind !== 'rate_limited' && kind !== 'server_error') return last
      if (attempt < META_RETRY_DELAYS_MS.length) await this.#sleep(parseRetryAfter(res.headers.get('retry-after'), this.#now()) ?? META_RETRY_DELAYS_MS[attempt]!)
    }
    return last!
  }
}
