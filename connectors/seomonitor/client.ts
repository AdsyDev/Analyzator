// Client SEOmonitor API 3.0: Authorization = tokenul brut (fără Bearer), doar GET, limită de 10 cereri/secundă,
// buget zilnic comun, retry 1/5/15 minute cu jitter și Retry-After, fără retry pe 401/403. Tokenul nu se loghează.

import { createHash } from 'node:crypto'
import { CallBudget, fetchWithRetry, type FetchLike, type HttpFailure, type Sleep } from '../shared/http-budget.ts'
import {
  ROUTES,
  SEOMONITOR_BASE_URL,
  SEOMONITOR_MAX_PAGES,
  SEOMONITOR_MAX_RETRY_WAIT_MS,
  SEOMONITOR_MIN_INTERVAL_MS,
  SEOMONITOR_RETRY_DELAYS_MS,
  type RouteKey,
} from './config.ts'

export type Params = Record<string, string | number | boolean | undefined>

export type PageResult = { ok: true; payload: unknown; payloadHash: string; status: number } | ({ ok: false } & HttpFailure)

/** fără_pagini: rute fără limit/offset; scurtă: oprește la o pagină cu mai puțin de `limit` rânduri;
 *  goală: avansează cu `limit` până la o pagină goală (documentat pentru keywords/aio). */
export type PaginationMode = 'none' | 'until_short_page' | 'until_empty_page'

export type PaginatedResult =
  | { ok: true; pages: Array<{ payload: unknown; payloadHash: string }>; rows: number }
  | ({ ok: false; pagesFetched: number; pages: Array<{ payload: unknown; payloadHash: string }> } & (HttpFailure | { kind: 'pagination_stalled'; status: null; attempts: number; message: string }))

export type SeomonitorClientOptions = {
  token: string
  budget: CallBudget
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
  random?: () => number
  baseUrl?: string
}

export class SeomonitorClient {
  readonly budget: CallBudget
  readonly #token: string
  readonly #fetch: FetchLike
  readonly #sleep: Sleep
  readonly #now: () => number
  readonly #random: () => number
  readonly #baseUrl: string
  #lastRequestAt = Number.NEGATIVE_INFINITY

  constructor(options: SeomonitorClientOptions) {
    if (!options.token) throw new Error('Token SEOmonitor lipsă.')
    this.#token = options.token
    this.budget = options.budget
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#now = options.now ?? Date.now
    this.#random = options.random ?? Math.random
    this.#baseUrl = (options.baseUrl ?? SEOMONITOR_BASE_URL).replace(/\/+$/, '')
  }

  url(route: RouteKey, params: Params): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') search.set(key, String(value))
    }
    const qs = search.toString()
    return `${this.#baseUrl}${ROUTES[route]}${qs ? `?${qs}` : ''}`
  }

  async get(route: RouteKey, params: Params): Promise<PageResult> {
    // Limita documentată: 10 cereri pe secundă.
    const wait = this.#lastRequestAt + SEOMONITOR_MIN_INTERVAL_MS - this.#now()
    if (wait > 0) await this.#sleep(wait)
    this.#lastRequestAt = this.#now()

    const result = await fetchWithRetry(
      this.url(route, params),
      { method: 'GET', headers: { Authorization: this.#token, Accept: 'application/json' } },
      {
        budget: this.budget,
        fetch: this.#fetch,
        sleep: this.#sleep,
        now: this.#now,
        delaysMs: SEOMONITOR_RETRY_DELAYS_MS,
        maxDelayMs: SEOMONITOR_MAX_RETRY_WAIT_MS,
        jitter: (ms) => ms * (0.8 + 0.4 * this.#random()),
      },
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

  /** Paginare completă cu limit/offset. Oprește la eșec, la o pagină scurtă/goală sau la o pagină repetată. */
  async paginate(route: RouteKey, params: Params, mode: PaginationMode, pageSize: number): Promise<PaginatedResult> {
    const pages: Array<{ payload: unknown; payloadHash: string }> = []
    if (mode === 'none') {
      const r = await this.get(route, params)
      if (!r.ok) return { ...r, pagesFetched: 0, pages }
      pages.push({ payload: r.payload, payloadHash: r.payloadHash })
      return { ok: true, pages, rows: countRows(r.payload) }
    }

    let rows = 0
    let previousHash: string | null = null
    for (let page = 0; page < SEOMONITOR_MAX_PAGES; page++) {
      const r = await this.get(route, { ...params, limit: pageSize, offset: page * pageSize })
      if (!r.ok) return { ...r, pagesFetched: pages.length, pages }
      const count = countRows(r.payload)
      if (count > 0 && r.payloadHash === previousHash) {
        return {
          ok: false, kind: 'pagination_stalled', status: null, attempts: 1, pagesFetched: pages.length, pages,
          message: `Pagina ${page + 1} e identică cu precedenta: offset ignorat?`,
        }
      }
      previousHash = r.payloadHash
      if (count > 0) pages.push({ payload: r.payload, payloadHash: r.payloadHash })
      rows += count
      if (count === 0 || (mode === 'until_short_page' && count < pageSize)) return { ok: true, pages, rows }
    }
    return {
      ok: false, kind: 'pagination_stalled', status: null, attempts: 1, pagesFetched: pages.length, pages,
      message: `Paginarea nu s-a terminat după ${SEOMONITOR_MAX_PAGES} pagini.`,
    }
  }
}

function countRows(payload: unknown): number {
  if (Array.isArray(payload)) return payload.length
  if (payload && typeof payload === 'object') return Object.keys(payload).length === 0 ? 0 : 1
  return 0
}
