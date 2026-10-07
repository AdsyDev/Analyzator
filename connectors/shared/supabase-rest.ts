// Acces minimal la PostgREST cu service role, fără dependențe.
// Doar în worker. Cheia nu se loghează și nu apare în mesajele de eroare.

import type { FetchLike } from './http-budget.ts'

export type Row = Record<string, unknown>

export interface Db {
  select<T extends Row>(table: string, query: string): Promise<T[]>
  insert<T extends Row>(table: string, row: Row): Promise<T[]>
  update<T extends Row>(table: string, query: string, patch: Row): Promise<T[]>
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

  constructor(config: SupabaseRestConfig) {
    this.#url = config.url
    this.#key = config.serviceRoleKey
    this.#fetch = config.fetch ?? globalThis.fetch
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T[]> {
    const res = await this.#fetch(`${this.#url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.#key,
        Authorization: `Bearer ${this.#key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
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
    return text ? (JSON.parse(text) as T[]) : []
  }

  select<T extends Row>(table: string, query: string): Promise<T[]> {
    return this.#request<T>('GET', `${table}?${query}`)
  }

  insert<T extends Row>(table: string, row: Row): Promise<T[]> {
    return this.#request<T>('POST', table, row)
  }

  update<T extends Row>(table: string, query: string, patch: Row): Promise<T[]> {
    return this.#request<T>('PATCH', `${table}?${query}`, patch)
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
