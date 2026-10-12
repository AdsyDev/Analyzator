// Acces minimal la PostgREST cu service role, fără dependențe.
// Doar în worker. Cheia nu se loghează și nu apare în mesajele de eroare.

import type { FetchLike } from './http-budget.ts'

export type Row = Record<string, unknown>

export interface Db {
  select<T extends Row>(table: string, query: string): Promise<T[]>
  insert<T extends Row>(table: string, row: Row): Promise<T[]>
  update<T extends Row>(table: string, query: string, patch: Row): Promise<T[]>
  rpc<T>(fn: string, args: Row): Promise<T>
  /** Upsert idempotent pe cheia unică dată (on_conflict); întoarce rândurile scrise. */
  upsert<T extends Row>(table: string, rows: Row[], onConflict: string[]): Promise<T[]>
}

export class DbError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'DbError'
    this.status = status
  }
}

export type SupabaseRestConfig = { url: string; serviceRoleKey: string; fetch?: FetchLike }

export function supabaseConfigFromEnv(env: NodeJS.ProcessEnv): SupabaseRestConfig {
  const url = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('Lipsește SUPABASE_URL.')
  if (!serviceRoleKey) throw new Error('Lipsește SUPABASE_SERVICE_ROLE_KEY.')
  return { url: url.replace(/\/+$/, ''), serviceRoleKey }
}

export class SupabaseRest implements Db {
  readonly #url: string
  readonly #key: string
  readonly #fetch: FetchLike

  readonly #retryDelaysMs: number[] | undefined

  constructor(config: SupabaseRestConfig & { retryDelaysMs?: number[] }) {
    this.#url = config.url
    this.#key = config.serviceRoleKey
    this.#fetch = config.fetch ?? globalThis.fetch
    this.#retryDelaysMs = config.retryDelaysMs
  }

  /**
   * Reîncercare doar pentru cereri care pot fi repetate fără efecte duble: citiri și upsert-uri (cheie naturală).
   * Pe o rulare reală (12 oct 2026) un `fetch failed` izolat oprea colectarea tuturor brandurilor.
   */
  async #request<T>(method: string, path: string, body?: unknown, prefer = 'return=representation', idempotent = method === 'GET'): Promise<T> {
    const delays = idempotent ? (this.#retryDelaysMs ?? [2_000, 8_000]) : []
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#once<T>(method, path, body, prefer)
      } catch (err) {
        const transient = err instanceof DbError ? [429, 502, 503, 504].includes(err.status) : true
        if (!transient || attempt >= delays.length) throw err
        await new Promise((r) => setTimeout(r, delays[attempt]))
      }
    }
  }

  async #once<T>(method: string, path: string, body: unknown, prefer: string): Promise<T> {
    const res = await this.#fetch(`${this.#url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.#key,
        Authorization: `Bearer ${this.#key}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      let detail = text.slice(0, 300)
      try {
        const parsed = JSON.parse(text) as { message?: string; code?: string }
        detail = `${parsed.code ?? ''} ${parsed.message ?? ''}`.trim()
      } catch {
        // corp non-JSON
      }
      throw new DbError(`${method} ${path.split('?')[0]}: HTTP ${res.status} ${detail}`, res.status)
    }
    return (text ? JSON.parse(text) : null) as T
  }

  async select<T extends Row>(table: string, query: string): Promise<T[]> {
    return (await this.#request<T[] | null>('GET', `${table}?${query}`)) ?? []
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T[]> {
    return (await this.#request<T[] | null>('POST', table, row)) ?? []
  }

  async update<T extends Row>(table: string, query: string, patch: Row): Promise<T[]> {
    return (await this.#request<T[] | null>('PATCH', `${table}?${query}`, patch)) ?? []
  }

  async upsert<T extends Row>(table: string, rows: Row[], onConflict: string[]): Promise<T[]> {
    if (rows.length === 0) return []
    for (const col of onConflict) {
      if (!/^[a-z_]+$/.test(col)) throw new Error(`coloană on_conflict invalidă: ${col}`)
    }
    return (
      (await this.#request<T[] | null>(
        'POST',
        `${table}?on_conflict=${onConflict.join(',')}`,
        rows,
        'resolution=merge-duplicates,return=representation',
        true,
      )) ?? []
    )
  }

  /** Funcții SQL din public executabile doar de service_role (lista aprobată în teste). */
  rpc<T>(fn: string, args: Row): Promise<T> {
    return this.#request<T>('POST', `rpc/${fn}`, args)
  }
}

/** Validare pentru valori interpolate în filtre PostgREST (previne injecția de filtre). */
export function assertSlug(value: string, label: string): void {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) throw new Error(`${label} invalid: ${JSON.stringify(value)}`)
}

export function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} invalid: ${JSON.stringify(value)}`)
  }
}
