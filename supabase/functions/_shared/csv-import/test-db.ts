// ImportDb în memorie, doar pentru teste: filtre eq./not.is.null, order, limit, offset, chei unice ca în schemă.
import type { ImportDb, Row } from './service.ts'

const UNIQUE: Record<string, string[]> = {
  import_batches: ['tenant_id', 'brand_id', 'source', 'file_sha256'],
  import_batch_rows: ['batch_id', 'row_number'],
}

export class MemImportDb implements ImportDb {
  readonly tables: Record<string, Row[]> = {}
  readonly log: Array<{ op: string; table: string; query?: string }> = []
  /** Eșuează upsert-ul de N ori pe tabelul dat (simulează o cădere la mijlocul confirmării). */
  failUpsert: { table: string; times: number } | null = null
  readonly conflictKeys: Record<string, string[]> = {}

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }))
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }

  #filter(rows: Row[], query: string): Row[] {
    let out = rows
    for (const part of query.split('&')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      const col = part.slice(0, eq)
      const expr = part.slice(eq + 1)
      if (['select', 'order', 'limit', 'offset'].includes(col)) continue
      if (expr.startsWith('eq.')) out = out.filter((r) => String(r[col]) === expr.slice(3))
      else if (expr === 'not.is.null') out = out.filter((r) => r[col] !== null && r[col] !== undefined)
      else if (expr === 'is.null') out = out.filter((r) => r[col] === null || r[col] === undefined)
      else throw new Error(`MemImportDb: filtru nesuportat ${part}`)
    }
    return out
  }

  async select<T = Row>(table: string, query: string): Promise<T[]> {
    this.log.push({ op: 'select', table, query })
    let out = this.#filter(this.rows(table), query)
    const order = /(?:^|&)order=([a-z_]+)\.(asc|desc)/.exec(query)
    if (order) {
      const [, col, dir] = order
      out = [...out].sort((a, b) => (Number(a[col!]) - Number(b[col!]) || String(a[col!]).localeCompare(String(b[col!]))) * (dir === 'desc' ? -1 : 1))
    }
    const offset = Number(/(?:^|&)offset=(\d+)/.exec(query)?.[1] ?? 0)
    const limit = /(?:^|&)limit=(\d+)/.exec(query)?.[1]
    out = out.slice(offset, limit ? offset + Number(limit) : undefined)
    return out.map((r) => ({ ...r }) as T)
  }

  async insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]> {
    const list = Array.isArray(rows) ? rows : [rows]
    this.log.push({ op: 'insert', table })
    const out: Row[] = []
    for (const r of list) {
      const key = UNIQUE[table]
      if (key && this.rows(table).some((x) => key.every((k) => String(x[k]) === String(r[k])))) {
        throw new Error(`INSERT ${table}: HTTP 409 (23505)`)
      }
      const stored: Row = table === 'import_batches' || table === 'audit_events' ? { id: crypto.randomUUID(), ...r } : { ...r }
      this.rows(table).push(stored)
      out.push({ ...stored })
    }
    return out as T[]
  }

  async upsert<T = Row>(table: string, rows: Row[], onConflict: string[]): Promise<T[]> {
    this.log.push({ op: 'upsert', table })
    this.conflictKeys[table] = onConflict
    if (this.failUpsert && this.failUpsert.table === table && this.failUpsert.times > 0) {
      this.failUpsert.times--
      throw new Error(`POST ${table}: HTTP 500`)
    }
    const keyOf = (r: Row) => onConflict.map((c) => String(r[c])).join('\u001f')
    const batchKeys = new Set<string>()
    const out: Row[] = []
    for (const r of rows) {
      const k = keyOf(r)
      if (batchKeys.has(k)) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time')
      batchKeys.add(k)
      const existing = this.rows(table).find((x) => keyOf(x) === k)
      if (existing) {
        Object.assign(existing, r)
        out.push({ ...existing })
      } else {
        const stored = { ...r }
        this.rows(table).push(stored)
        out.push({ ...stored })
      }
    }
    return out as T[]
  }

  async update<T = Row>(table: string, query: string, patch: Row): Promise<T[]> {
    this.log.push({ op: 'update', table, query })
    const hit = this.#filter(this.rows(table), query)
    for (const r of hit) Object.assign(r, patch)
    return hit.map((r) => ({ ...r }) as T)
  }

  async delete(table: string, query: string): Promise<number> {
    this.log.push({ op: 'delete', table, query })
    const hit = new Set(this.#filter(this.rows(table), query))
    this.tables[table] = this.rows(table).filter((r) => !hit.has(r))
    return hit.size
  }
}
