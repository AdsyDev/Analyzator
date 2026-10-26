// Upsert idempotent în tabelele SEOmonitor, pe cheile naturale din migrație, cu verificarea explicită a
// tenantului și brandului (înainte și după scriere). Rândurile duplicate în același lot se comasează (ultimul
// câștigă), altfel Postgres refuză un upsert care atinge același rând de două ori.

import { createHash } from 'node:crypto'
import { assertUuid, DbError, type Db, type Row } from '../shared/supabase-rest.ts'

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
/**
 * Plafon de mărime per cerere (aprox. JSON). Răspunsurile AI originale au textul complet (zeci–sute de KB fiecare):
 * 500 într-o cerere depășeau `statement_timeout` (57014) pe date reale.
 */
export const MAX_BATCH_BYTES = 1_000_000

/** Loturi de cel mult `BATCH` rânduri și cel mult `MAX_BATCH_BYTES`; un rând mai mare decât plafonul merge singur. */
export function batches(rows: Row[], maxRows = BATCH, maxBytes = MAX_BATCH_BYTES): Row[][] {
  const out: Row[][] = []
  let cur: Row[] = []
  let size = 0
  for (const r of rows) {
    const bytes = JSON.stringify(r).length
    if (cur.length > 0 && (cur.length >= maxRows || size + bytes > maxBytes)) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(r)
    size += bytes
  }
  if (cur.length) out.push(cur)
  return out
}

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
  for (const batch of batches(unique)) {
    const returned = await db.upsert<Row>(table, batch, [...KEYS[table]])
    if (returned.length !== batch.length) throw new Error(`${table}: upsert a întors ${returned.length} din ${batch.length} rânduri.`)
    for (const r of returned) check(r, 'întors')
    out.push(...returned)
  }
  return out
}

/**
 * Plafon mai mic pentru originale: textele complete sunt mari, iar rescrierea lor e scumpă. Pe 20 oct. 2026, loturile
 * de ~1 MB tot depășeau `statement_timeout` (57014).
 */
export const ORIGINALS_BATCH_BYTES = 250_000
/** Câte id-uri intră într-un filtru `in.(...)` la citirea hash-urilor existente (URL-ul rămâne scurt). */
const ID_CHUNK = 100
const ID = /^[0-9a-f-]{1,36}$/i

export const contentHash = (raw: string | null) => createHash('sha256').update(raw ?? '').digest('hex')

const isTimeout = (err: unknown) => err instanceof Error && /57014|statement timeout/.test(err.message)

/**
 * Originalele răspunsurilor AI (doar pentru audit de agenție). Se scriu doar cele noi sau cu alt conținut decât cel
 * salvat (`content_sha256`): fereastra de 35 de zile se suprapune de la o rulare la alta, iar textele vechi nu se
 * mai rescriu. La timeout, lotul se împarte în două, până la un singur rând. Întoarce câte rânduri au fost scrise.
 */
export async function upsertOriginals(db: Db, rows: Row[], scope: { tenant_id: string; brand_id: string }): Promise<number> {
  assertUuid(scope.tenant_id, 'tenant_id')
  assertUuid(scope.brand_id, 'brand_id')
  const unique = dedupe(rows, KEYS.ai_answer_originals).map((r): Row => ({ ...r, content_sha256: contentHash((r.raw_content as string | null) ?? null) }))
  for (const r of unique) {
    if (r.tenant_id !== scope.tenant_id || r.brand_id !== scope.brand_id) throw new Error('ai_answer_originals: rând trimis pentru alt tenant sau brand; opresc rularea.')
    if (!ID.test(String(r.answer_id))) throw new Error(`ai_answer_originals: answer_id invalid: ${JSON.stringify(r.answer_id)}`)
  }

  const stored = new Map<string, string | null>()
  for (let i = 0; i < unique.length; i += ID_CHUNK) {
    const ids = unique.slice(i, i + ID_CHUNK).map((r) => String(r.answer_id))
    const existing = await db.select<{ answer_id: string; content_sha256: string | null; tenant_id: string; brand_id: string }>(
      'ai_answer_originals',
      `select=answer_id,content_sha256,tenant_id,brand_id&tenant_id=eq.${scope.tenant_id}&brand_id=eq.${scope.brand_id}&answer_id=in.(${ids.join(',')})`,
    )
    for (const e of existing) {
      if (e.tenant_id !== scope.tenant_id || e.brand_id !== scope.brand_id) throw new Error('ai_answer_originals: rând citit din alt tenant sau brand; opresc rularea.')
      stored.set(String(e.answer_id), e.content_sha256)
    }
  }
  const changed = unique.filter((r) => stored.get(String(r.answer_id)) !== r.content_sha256)

  const write = async (batch: Row[]): Promise<number> => {
    try {
      const returned = await db.upsert<Row>('ai_answer_originals', batch, [...KEYS.ai_answer_originals])
      if (returned.length !== batch.length) throw new Error(`ai_answer_originals: upsert a întors ${returned.length} din ${batch.length} rânduri.`)
      return returned.length
    } catch (err) {
      if (!isTimeout(err) || batch.length === 1) throw err
      const half = Math.ceil(batch.length / 2)
      return (await write(batch.slice(0, half))) + (await write(batch.slice(half)))
    }
  }
  let written = 0
  for (const batch of batches(changed, BATCH, ORIGINALS_BATCH_BYTES)) written += await write(batch)
  return written
}

/**
 * ai_answers + originalele lor (tabel separat, doar agenție). Originalele sunt doar pentru audit: dacă baza de date nu
 * le poate scrie (HTTP), răspunsurile rămân salvate și eroarea se raportează, fără să oprească rularea.
 */
export async function upsertAnswers(
  db: Db,
  answers: Row[],
  originals: Array<{ key: string; raw_content: string | null; raw_format: string }>,
  scope: { tenant_id: string; brand_id: string },
): Promise<{ written: number; originalsError: string | null }> {
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
  try {
    await upsertOriginals(db, originalRows, scope)
  } catch (err) {
    // Doar erorile bazei de date; o nepotrivire de tenant sau brand oprește rularea, ca peste tot.
    if (err instanceof DbError) return { written: written.length, originalsError: err.message }
    throw err
  }
  return { written: written.length, originalsError: null }
}
