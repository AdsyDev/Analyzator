// Utilitare doar pentru teste: fetch simulat și o bază în memorie compatibilă cu interfața Db.

import type { FetchLike } from './http-budget.ts'
import type { Db, Row } from './supabase-rest.ts'

export type FakeResponse = { status: number; body?: string; headers?: Record<string, string> } | Error

/** fetch simulat: răspunde din coadă și înregistrează URL-urile apelate. */
export function fakeFetch(responses: FakeResponse[] | ((url: string, callIndex: number) => FakeResponse)) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const queue = Array.isArray(responses) ? [...responses] : null
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const next = queue ? queue.shift() : (responses as (url: string, i: number) => FakeResponse)(url, calls.length - 1)
    if (!next) throw new Error(`fakeFetch: niciun răspuns pregătit pentru apelul ${calls.length} (${url})`)
    if (next instanceof Error) throw next
    return new Response(next.body ?? '', { status: next.status, headers: next.headers })
  }
  return { fetch: fn, calls }
}

export const noSleep = () => {
  const delays: number[] = []
  return { sleep: async (ms: number) => void delays.push(ms), delays }
}

/** Interpretează filtrele simple PostgREST folosite de conectori: col=eq.x, col=in.(a,b). */
function matches(row: Row, query: string): boolean {
  for (const part of query.split('&')) {
    const [col, expr] = part.split('=', 2) as [string, string | undefined]
    if (col === 'select' || expr === undefined) continue
    if (expr.startsWith('eq.')) {
      if (String(row[col]) !== expr.slice(3)) return false
    } else if (expr.startsWith('in.(')) {
      if (!expr.slice(4, -1).split(',').includes(String(row[col]))) return false
    } else {
      throw new Error(`FakeDb: filtru nesuportat ${part}`)
    }
  }
  return true
}

export class FakeDb implements Db {
  readonly tables: Record<string, Row[]>
  readonly log: Array<{ op: string; table: string; query?: string; row?: Row }> = []
  #seq = 0

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = tables
  }

  async select<T extends Row>(table: string, query: string): Promise<T[]> {
    this.log.push({ op: 'select', table, query })
    return (this.tables[table] ?? []).filter((r) => matches(r, query)).map((r) => ({ ...r }) as T)
  }

  async insert<T extends Row>(table: string, row: Row): Promise<T[]> {
    this.log.push({ op: 'insert', table, row })
    const stored = { id: `00000000-0000-4000-8000-${String(++this.#seq).padStart(12, '0')}`, ...row }
    ;(this.tables[table] ??= []).push(stored)
    return [{ ...stored } as unknown as T]
  }

  async update<T extends Row>(table: string, query: string, patch: Row): Promise<T[]> {
    this.log.push({ op: 'update', table, query, row: patch })
    const hit = (this.tables[table] ?? []).filter((r) => matches(r, query))
    for (const r of hit) Object.assign(r, patch)
    return hit.map((r) => ({ ...r }) as T)
  }
}
