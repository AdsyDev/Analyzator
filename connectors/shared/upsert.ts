// Upsert idempotent generic, cu verificarea explicită a tenantului și brandului (înainte și după scriere).
// Rândurile duplicate în același lot se comasează (ultimul câștigă): Postgres refuză un upsert care atinge
// de două ori același rând. Folosit de conectorii noi (Google, CSV); SEOmonitor și Clarity au scriitorii lor.

import { assertUuid, type Db, type Row } from './supabase-rest.ts'

const BATCH = 500

export function dedupeByKey(rows: Row[], key: readonly string[]): Row[] {
  const byKey = new Map<string, Row>()
  for (const row of rows) byKey.set(key.map((k) => String(row[k])).join('|'), row)
  return [...byKey.values()]
}

export async function upsertScoped(
  db: Db,
  table: string,
  key: readonly string[],
  rows: Row[],
  scope: { tenant_id: string; brand_id?: string },
): Promise<number> {
  assertUuid(scope.tenant_id, 'tenant_id')
  if (scope.brand_id) assertUuid(scope.brand_id, 'brand_id')
  const check = (r: Row, when: string) => {
    if (r.tenant_id !== scope.tenant_id) throw new Error(`${table}: rând ${when} pentru alt tenant; opresc rularea.`)
    if (scope.brand_id && r.brand_id !== scope.brand_id) throw new Error(`${table}: rând ${when} pentru alt brand; opresc rularea.`)
  }
  const unique = dedupeByKey(rows, key)
  for (const r of unique) check(r, 'trimis')
  let written = 0
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const returned = await db.upsert<Row>(table, batch, [...key])
    if (returned.length !== batch.length) throw new Error(`${table}: upsert a întors ${returned.length} din ${batch.length} rânduri.`)
    for (const r of returned) check(r, 'întors')
    written += returned.length
  }
  return written
}
