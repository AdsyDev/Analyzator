// Upsert idempotent în tabelele SEOmonitor, pe cheile naturale din migrație, cu verificarea explicită a
// tenantului și brandului (înainte și după scriere). Rândurile duplicate în același lot se comasează (ultimul
// câștigă), altfel Postgres refuză un upsert care atinge același rând de două ori.

import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'

export const KEYS = {
  keyword_groups: ['tenant_id', 'brand_id', 'source_id', 'campaign_id', 'group_id'],
  keywords: ['tenant_id', 'brand_id', 'source_id', 'keyword_id'],
  rank_observations: ['tenant_id', 'brand_id', 'keyword_id', 'device', 'date', 'domain'],
  seomonitor_group_visibility_daily: ['tenant_id', 'brand_id', 'campaign_id', 'group_id', 'date', 'device', 'domain'],
  ai_answers: ['tenant_id', 'brand_id', 'engine', 'keyword_id', 'crawl_at', 'device'],
  ai_answer_originals: ['answer_id'],
  ai_brand_observations: ['tenant_id', 'brand_id', 'engine', 'keyword_id', 'crawl_at', 'device', 'observed_domain'],
  ai_citations: ['tenant_id', 'brand_id', 'engine', 'keyword_id', 'crawl_at', 'device', 'url'],
  seomonitor_ai_visibility_daily: ['tenant_id', 'brand_id', 'campaign_id', 'group_id', 'date', 'engine', 'metric'],
  seomonitor_ai_engine_stats: ['tenant_id', 'brand_id', 'campaign_id', 'group_id', 'engine', 'period_start', 'period_end'],
  seomonitor_mapping_queue: ['tenant_id', 'source_id', 'campaign_id', 'group_id', 'reason'],
} as const
export type TableName = keyof typeof KEYS

const BATCH = 500

export function dedupe(rows: Row[], key: readonly string[]): Row[] {
  const byKey = new Map<string, Row>()
  for (const row of rows) byKey.set(key.map((k) => String(row[k])).join('|'), row)
  return [...byKey.values()]
}

export async function upsertRows(
  db: Db,
  table: TableName,
  rows: Row[],
  scope: { tenant_id: string; brand_id?: string },
): Promise<Row[]> {
  assertUuid(scope.tenant_id, 'tenant_id')
  if (scope.brand_id) assertUuid(scope.brand_id, 'brand_id')
  const check = (r: Row, when: string) => {
    if (r.tenant_id !== undefined && r.tenant_id !== scope.tenant_id) {
      throw new Error(`${table}: rând ${when} pentru alt tenant; opresc rularea.`)
    }
    if (scope.brand_id && r.brand_id !== undefined && r.brand_id !== scope.brand_id) {
      throw new Error(`${table}: rând ${when} pentru alt brand; opresc rularea.`)
    }
  }
  const unique = dedupe(rows, KEYS[table])
  for (const r of unique) check(r, 'trimis')
  const out: Row[] = []
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    const returned = await db.upsert<Row>(table, batch, [...KEYS[table]])
    if (returned.length !== batch.length) throw new Error(`${table}: upsert a întors ${returned.length} din ${batch.length} rânduri.`)
    for (const r of returned) check(r, 'întors')
    out.push(...returned)
  }
  return out
}

/** ai_answers + originalele lor (tabel separat, doar agenție). */
export async function upsertAnswers(
  db: Db,
  answers: Row[],
  originals: Array<{ key: string; raw_content: string | null; raw_format: string }>,
  scope: { tenant_id: string; brand_id: string },
): Promise<number> {
  const written = await upsertRows(db, 'ai_answers', answers, scope)
  const idByKey = new Map(written.map((r) => [`${r.engine}|${r.keyword_id}|${r.crawl_at}|${r.device}`, r]))
  const originalRows = originals.flatMap((o) => {
    const answer = idByKey.get(o.key)
    if (!answer) return []
    return [{
      answer_id: answer.id,
      tenant_id: scope.tenant_id,
      brand_id: scope.brand_id,
      raw_content: o.raw_content,
      raw_format: o.raw_format,
      collected_at: answer.collected_at,
      payload_hash: answer.payload_hash,
    }]
  })
  await upsertRows(db, 'ai_answer_originals', originalRows, scope)
  return written.length
}
