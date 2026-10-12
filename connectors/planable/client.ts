// Client Planable Public API v1: Authorization Bearer pln_…, doar GET, ritm de cel mult 4 cereri/secundă, retry la
// 429/5xx (Retry-After are prioritate), fără retry pe 401/403. Tokenul nu se loghează.

import { createHash } from 'node:crypto'
import { CallBudget, fetchWithRetry, type FetchLike, type HttpFailure, type Sleep } from '../shared/http-budget.ts'
import { PLANABLE_BASE_URL, PLANABLE_MAX_RETRY_WAIT_MS, PLANABLE_MIN_INTERVAL_MS, PLANABLE_RETRY_DELAYS_MS } from './config.ts'

export type Params = Record<string, string | number | boolean | undefined>
export type GetResult = { ok: true; payload: unknown; payloadHash: string; status: number } | ({ ok: false } & HttpFailure)

export type PlanableClientOptions = {
  token: string
  budget: CallBudget
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
  baseUrl?: string
}

export class PlanableClient {
  readonly budget: CallBudget
  readonly #token: string
  readonly #fetch: FetchLike
  readonly #sleep: Sleep
  readonly #now: () => number
  readonly #baseUrl: string
  #lastRequestAt = Number.NEGATIVE_INFINITY

  constructor(options: PlanableClientOptions) {
    if (!options.token) throw new Error('Token Planable lipsă.')
    this.#token = options.token
    this.budget = options.budget
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = options.now ?? Date.now
    this.#baseUrl = (options.baseUrl ?? PLANABLE_BASE_URL).replace(/\/+$/, '')
  }

  url(path: string, params: Params = {}): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value))
    }
    const qs = search.toString()
    return `${this.#baseUrl}${path}${qs ? `?${qs}` : ''}`
  }

  async get(path: string, params: Params = {}): Promise<GetResult> {
    const wait = this.#lastRequestAt + PLANABLE_MIN_INTERVAL_MS - this.#now()
    if (wait > 0) await this.#sleep(wait)
    this.#lastRequestAt = this.#now()
    const result = await fetchWithRetry(
      this.url(path, params),
      { method: 'GET', headers: { Authorization: `Bearer ${this.#token}`, Accept: 'application/json' } },
      { budget: this.budget, fetch: this.#fetch, sleep: this.#sleep, now: this.#now, delaysMs: PLANABLE_RETRY_DELAYS_MS, maxDelayMs: PLANABLE_MAX_RETRY_WAIT_MS },
    )
    if (!result.ok) return result
    let payload: unknown
    try {
      payload = result.body === '' ? null : JSON.parse(result.body)
    } catch {
      return { ok: false, kind: 'unexpected_status', status: result.status, attempts: result.attempts, message: 'Răspuns non-JSON.' }
    }
    return { ok: true, payload, payloadHash: createHash('sha256').update(result.body).digest('hex'), status: result.status }
  }
}
