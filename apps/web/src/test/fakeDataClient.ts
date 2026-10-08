import type { DataClient } from '../data/supabase/dataClient'

type Row = Record<string, unknown>
export interface Call {
  table: string
  filters: Array<[string, string, unknown]>
  op: 'select' | 'insert' | 'update'
  payload?: unknown
}

interface Opts {
  tables?: Record<string, Row[]>
  errors?: Record<string, { code?: string; message: string }>
  /** Răspuns pentru `functions.invoke`; poate fi o eroare cu `context.json()`. */
  /** Utilizatorul sesiunii (pentru `auth.getSession`). */
  userId?: string | null
  invoke?: (name: string, body: unknown) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>
}

/**
 * Client Supabase fals, suficient pentru providerii de Administrare. Aplică filtrele `eq`, `is`, `lte`, ca testele
 * să prindă un provider care uită un filtru (de ex. `brand_id`).
 */
export function fakeDataClient(opts: Opts = {}) {
  const calls: Call[] = []
  const invocations: Array<{ name: string; body: unknown }> = []
  const tables = opts.tables ?? {}

  function builder(table: string) {
    const call: Call = { table, filters: [], op: 'select' }
    calls.push(call)
    let limit: number | null = null
    let order: { col: string; asc: boolean } | null = null
    let single: 'one' | 'maybe' | null = null
    let rows = () => {
      let out = (tables[table] ?? []).filter((r) =>
        call.filters.every(([col, op, val]) => {
          const v = r[col]
          if (op === 'eq') return v === val
          if (op === 'is') return v === val
          if (op === 'lte') return String(v) <= String(val)
          return true
        }),
      )
      if (order) {
        const o = order
        out = [...out].sort((a, b) => (String(a[o.col]) < String(b[o.col]) ? -1 : 1) * (o.asc ? 1 : -1))
      }
      return limit === null ? out : out.slice(0, limit)
    }
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (payload: unknown) => {
        call.op = 'insert'
        call.payload = payload
        return b
      },
      update: (payload: unknown) => {
        call.op = 'update'
        call.payload = payload
        return b
      },
      eq: (c: string, v: unknown) => (call.filters.push([c, 'eq', v]), b),
      is: (c: string, v: unknown) => (call.filters.push([c, 'is', v]), b),
      lte: (c: string, v: unknown) => (call.filters.push([c, 'lte', v]), b),
      order: (col: string, o?: { ascending?: boolean }) => ((order = { col, asc: o?.ascending !== false }), b),
      limit: (n: number) => ((limit = n), b),
      maybeSingle: () => ((single = 'maybe'), b),
      single: () => ((single = 'one'), b),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        const err = opts.errors?.[`${table}:${call.op}`] ?? opts.errors?.[table]
        let result: { data: unknown; error: unknown }
        if (err) result = { data: null, error: err }
        else if (call.op === 'update') {
          for (const r of rows()) Object.assign(r, call.payload as Row)
          result = { data: null, error: null }
        } else if (call.op === 'insert') result = { data: single ? { ...(call.payload as Row), id: 'new-id', credential_status: 'missing' } : call.payload, error: null }
        else {
          const r = rows()
          result = { data: single ? (r[0] ?? null) : r, error: null }
        }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return b
  }

  const client = {
    auth: { getSession: async () => ({ data: { session: opts.userId === null ? null : { user: { id: opts.userId ?? 'me' } } } }) },
    from: (table: string) => builder(table),
    functions: {
      invoke: async (name: string, init: { body: unknown }) => {
        invocations.push({ name, body: init.body })
        return (await opts.invoke?.(name, init.body)) ?? { data: null, error: { message: 'no handler' } }
      },
    },
  } as unknown as DataClient

  return { client, calls, invocations }
}
