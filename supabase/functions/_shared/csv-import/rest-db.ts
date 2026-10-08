// ImportDb peste PostgREST, cu service role. Doar în funcția server. Cheia nu se loghează.
import type { ImportDb, Row } from './service.ts'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function restImportDb(config: { url: string; serviceRoleKey: string; fetch?: FetchLike }): ImportDb {
  const doFetch: FetchLike = config.fetch ?? ((input, init) => fetch(input, init))
  const base = config.url.replace(/\/+$/, '')

  async function request<T>(method: string, path: string, body?: unknown, prefer = 'return=representation'): Promise<T> {
    const res = await doFetch(`${base}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      let code = ''
      try {
        code = (JSON.parse(text) as { code?: string }).code ?? ''
      } catch {
        // corp non-JSON
      }
      // Fără corpul răspunsului: poate conține valori din rânduri.
      throw new Error(`${method} ${path.split('?')[0]}: HTTP ${res.status}${code ? ` (${code})` : ''}`)
    }
    return (text ? JSON.parse(text) : []) as T
  }

  return {
    async select<T = Row>(table: string, query: string) {
      return (await request<T[]>('GET', `${table}?${query}`)) ?? []
    },
    async insert<T = Row>(table: string, rows: Row | Row[]) {
      return (await request<T[]>('POST', table, rows)) ?? []
    },
    async upsert<T = Row>(table: string, rows: Row[], onConflict: string[]) {
      if (rows.length === 0) return []
      for (const c of onConflict) if (!/^[a-z_]+$/.test(c)) throw new Error(`coloană on_conflict invalidă: ${c}`)
      return (await request<T[]>('POST', `${table}?on_conflict=${onConflict.join(',')}`, rows, 'resolution=merge-duplicates,return=representation')) ?? []
    },
    async update<T = Row>(table: string, query: string, patch: Row) {
      return (await request<T[]>('PATCH', `${table}?${query}`, patch)) ?? []
    },
    async delete(table: string, query: string) {
      const rows = await request<unknown[]>('DELETE', `${table}?${query}`)
      return rows.length
    },
  }
}
