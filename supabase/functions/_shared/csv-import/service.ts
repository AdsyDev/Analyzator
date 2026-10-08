// Fluxul importului CSV: previzualizare (validare + păstrarea rândurilor în import_batch_rows) și confirmare
// (upsert idempotent în tabelele tipizate). Doar service role scrie; autorizarea (rol + brand_access) se face în handler,
// înainte de orice apel de aici, și se repetă la confirmare. Fără dependențe: rulează în Deno și Node.

import { CONTRACTS, isSource, type SourceId } from './contracts.ts'
import { CsvError, decodeBytes, detectDelimiter, parseCsv } from './csv.ts'
import { sha256Hex, validateTable, type Declared, type StagedRow, type Target } from './validate.ts'

export type Row = Record<string, unknown>

export interface ImportDb {
  select<T = Row>(table: string, query: string): Promise<T[]>
  insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]>
  upsert<T = Row>(table: string, rows: Row[], onConflict: string[]): Promise<T[]>
  update<T = Row>(table: string, query: string, patch: Row): Promise<T[]>
  delete(table: string, query: string): Promise<number>
}

export class ImportError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_RECORDS = 50_000
export const SCHEMA_VERSION = 'csv-1'
const CHUNK = 500

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function assertUuid(value: string, label: string): void {
  if (!UUID.test(value)) throw new ImportError(400, 'invalid_id', `${label} invalid`)
}

export const CONFLICT_KEYS: Record<Target, string[]> = {
  paid_daily: ['tenant_id', 'brand_id', 'source', 'account_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date', 'breakdown_signature', 'attribution_config'],
  social_daily: ['tenant_id', 'brand_id', 'platform', 'account_id', 'date'],
  social_posts: ['tenant_id', 'brand_id', 'platform', 'account_id', 'post_id', 'snapshot_date', 'metrics_scope'],
  mentions: ['tenant_id', 'brand_id', 'native_id'],
}

export type BatchRow = {
  id: string
  tenant_id: string
  brand_id: string
  source: SourceId
  file_name: string | null
  file_sha256: string
  status: string
  rows_accepted: number
  rows_rejected: number
  rows_total: number | null
  rows_skipped: number
  currency: string | null
  timezone: string | null
  attribution_config: string | null
  click_type: string | null
  period_start: string | null
  period_end: string | null
  detected: Record<string, unknown>
  uploaded_by: string
  confirmed_by: string | null
  confirmed_at: string | null
}

export type DeclaredInput = { currency?: string | null; timezone?: string | null; attribution_config?: string | null; click_type?: string | null }

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const LABEL = /^[A-Za-z0-9_.:+\- ]{1,64}$/

/** Declarațiile pe lot: moneda (obligatorie pentru paid) și fusul orar (obligatoriu) nu se deduc din fișier. */
export function validateDeclared(source: SourceId, input: DeclaredInput): Declared {
  const contract = CONTRACTS[source]
  const timezone = input.timezone?.trim()
  if (!timezone) throw new ImportError(422, 'timezone_required', 'Fusul orar nu e declarat pe lot (de ex. Europe/Bucharest).')
  if (!isTimeZone(timezone)) throw new ImportError(422, 'timezone_invalid', `Fus orar necunoscut: ${timezone}`)
  const declared: Declared = { timezone }
  if (contract.declares.includes('currency')) {
    const currency = input.currency?.trim().toUpperCase()
    if (!currency) throw new ImportError(422, 'currency_required', 'Moneda nu e declarată pe lot. Costurile nu se interpretează fără monedă.')
    if (!/^[A-Z]{3}$/.test(currency)) throw new ImportError(422, 'currency_invalid', `Cod de monedă invalid: ${input.currency} (ISO 4217, trei litere)`)
    declared.currency = currency
  }
  for (const key of ['attribution_config', 'click_type'] as const) {
    const v = input[key]?.trim()
    if (v) {
      if (!contract.declares.includes(key)) throw new ImportError(422, `${key}_not_applicable`, `${key} nu se aplică sursei ${source}.`)
      if (!LABEL.test(v)) throw new ImportError(422, `${key}_invalid`, `${key}: doar litere, cifre și . _ : + - spațiu, maximum 64 de caractere.`)
      declared[key] = v
    }
  }
  return declared
}

// --- previzualizare ---------------------------------------------------------------------------------------------------------

export type PreviewInput = {
  tenant_id: string
  brand_id: string
  user_id: string
  source: string
  file_name: string | null
  bytes: Uint8Array
  declared: DeclaredInput
}

export type PreviewReport = {
  batch_id: string
  status: 'validated' | 'rejected'
  source: SourceId
  file_name: string | null
  rows_total: number
  rows_accepted: number
  rows_rejected: number
  rows_skipped: number
  period: { start: string; end: string } | null
  declared: Declared
  detected: Record<string, unknown>
  errors: string[]
  sample_accepted: Array<{ row_number: number; target: string | null; data: Row | null }>
  rejected: Array<{ row_number: number; reason: string }>
  rejected_by_reason: Array<{ reason: string; count: number }>
  totals: Record<string, number | null>
  can_confirm: boolean
}

const SAMPLE = 20
const REJECTED_SHOWN = 100

export async function previewImport(deps: { db: ImportDb; now?: () => Date }, input: PreviewInput): Promise<PreviewReport> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  assertUuid(input.tenant_id, 'tenant_id')
  assertUuid(input.brand_id, 'brand_id')
  assertUuid(input.user_id, 'user_id')
  if (!isSource(input.source)) throw new ImportError(400, 'unknown_source', `Sursă necunoscută: ${input.source}`)
  const source = input.source
  const declared = validateDeclared(source, input.declared)
  if (input.bytes.length === 0) throw new ImportError(422, 'empty_file', 'Fișierul e gol.')
  if (input.bytes.length > MAX_BYTES) throw new ImportError(413, 'file_too_large', `Fișierul depășește ${MAX_BYTES / 1024 / 1024} MB.`)
  const fileName = input.file_name ? input.file_name.slice(0, 255) : null

  const hash = await sha256Hex(input.bytes)
  const existing = await db.select<{ id: string; status: string }>(
    'import_batches',
    `select=id,status&tenant_id=eq.${input.tenant_id}&brand_id=eq.${input.brand_id}&source=eq.${source}&file_sha256=eq.${hash}`,
  )
  const previous = existing[0]
  if (previous?.status === 'imported') throw new ImportError(409, 'duplicate_file', 'Acest fișier (același conținut) a fost deja importat pentru acest brand și această sursă.')
  if (previous?.status === 'validating') throw new ImportError(409, 'import_in_progress', 'Fișierul e în curs de import.')

  // Decodare + parsare
  const decoded = decodeBytes(input.bytes)
  const delimiter = detectDelimiter(decoded.text)
  let table: string[][] = []
  const parseErrors: string[] = []
  if (!delimiter) parseErrors.push('delimitator nedetectat (se acceptă virgulă, punct și virgulă sau TAB)')
  else {
    try {
      table = parseCsv(decoded.text, delimiter)
    } catch (err) {
      parseErrors.push(err instanceof CsvError ? err.message : 'fișier CSV ilizibil')
    }
  }
  if (table.length > MAX_RECORDS + 20) parseErrors.push(`prea multe rânduri (maximum ${MAX_RECORDS})`)

  const result = parseErrors.length
    ? { ok: false, errors: parseErrors, header_row: 0, column_map: {}, ignored_columns: [] as string[], rows: [] as StagedRow[], skipped: 0, period: null, total: 0 }
    : await validateTable(source, table, declared, now)

  const accepted = result.rows.filter((r) => r.status === 'accepted')
  const rejected = result.rows.filter((r) => r.status === 'rejected')
  const status: 'validated' | 'rejected' = result.ok && accepted.length > 0 ? 'validated' : 'rejected'
  const errors = [...result.errors]
  if (result.ok && accepted.length === 0) errors.push('niciun rând acceptat')

  const detected = {
    encoding: decoded.encoding, delimiter, header_row: result.header_row, column_map: result.column_map,
    ignored_columns: result.ignored_columns, errors,
  }
  const batchFields = {
    file_name: fileName, status, rows_accepted: accepted.length, rows_rejected: rejected.length, rows_total: result.rows.length,
    rows_skipped: result.skipped, currency: declared.currency ?? null, timezone: declared.timezone,
    attribution_config: declared.attribution_config ?? null, click_type: declared.click_type ?? null,
    period_start: result.period?.start ?? null, period_end: result.period?.end ?? null, detected,
    confirmed_by: null, confirmed_at: null,
  }

  let batchId: string
  if (previous) {
    const updated = await db.update<{ id: string }>(
      'import_batches',
      `id=eq.${previous.id}&tenant_id=eq.${input.tenant_id}&brand_id=eq.${input.brand_id}`,
      batchFields,
    )
    if (updated.length !== 1) throw new ImportError(500, 'batch_update_failed', 'Lotul nu a putut fi actualizat.')
    batchId = previous.id
    await db.delete('import_batch_rows', `batch_id=eq.${batchId}&tenant_id=eq.${input.tenant_id}&brand_id=eq.${input.brand_id}`)
  } else {
    const created = await db.insert<{ id: string; tenant_id: string; brand_id: string }>('import_batches', {
      tenant_id: input.tenant_id, brand_id: input.brand_id, source, file_sha256: hash, uploaded_by: input.user_id, ...batchFields,
    })
    const row = created[0]
    if (created.length !== 1 || !row || row.tenant_id !== input.tenant_id || row.brand_id !== input.brand_id) {
      throw new ImportError(500, 'batch_insert_failed', 'Lotul nu a putut fi creat.')
    }
    batchId = row.id
  }

  const stagedRows = result.rows.map((r) => ({
    batch_id: batchId, row_number: r.row_number, tenant_id: input.tenant_id, brand_id: input.brand_id,
    status: r.status, reason: r.reason, target: r.target, data: r.data,
  }))
  for (let i = 0; i < stagedRows.length; i += CHUNK) await db.insert('import_batch_rows', stagedRows.slice(i, i + CHUNK))

  await db.insert('audit_events', {
    tenant_id: input.tenant_id, brand_id: input.brand_id, actor_user_id: input.user_id, actor_type: 'user',
    action: 'import_previewed', entity_type: 'import_batches', entity_id: batchId,
    after: { source, status, rows_accepted: accepted.length, rows_rejected: rejected.length, file_sha256: hash },
  })

  const byReason = new Map<string, number>()
  for (const r of rejected) {
    const key = (r.reason ?? '').replace(/„[^”]*”/g, '„…”').replace(/rândul \d+/, 'rândul N')
    byReason.set(key, (byReason.get(key) ?? 0) + 1)
  }

  return {
    batch_id: batchId, status, source, file_name: fileName, rows_total: result.rows.length, rows_accepted: accepted.length,
    rows_rejected: rejected.length, rows_skipped: result.skipped, period: result.period, declared, detected, errors,
    sample_accepted: accepted.slice(0, SAMPLE).map((r) => ({ row_number: r.row_number, target: r.target, data: r.data })),
    rejected: rejected.slice(0, REJECTED_SHOWN).map((r) => ({ row_number: r.row_number, reason: r.reason ?? '' })),
    rejected_by_reason: [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
    totals: totalsOf(accepted),
    can_confirm: status === 'validated',
  }
}

/** Totaluri informative ale rândurilor acceptate (null = nicio valoare, nu 0). */
function totalsOf(rows: StagedRow[]): Record<string, number | null> {
  const sums: Record<string, number | null> = {}
  for (const r of rows) {
    if (!r.data) continue
    for (const k of ['spend', 'impressions', 'clicks', 'conversions', 'engagements']) {
      const v = r.data[k]
      if (typeof v === 'number') sums[k] = (sums[k] ?? 0) + v
    }
  }
  return sums
}

// --- confirmare -----------------------------------------------------------------------------------------------------------------

export type ConfirmResult = { batch_id: string; status: 'imported'; written: Partial<Record<Target, number>>; rows_accepted: number }

async function loadAccepted(db: ImportDb, batch: BatchRow): Promise<Array<{ row_number: number; target: Target; data: Row }>> {
  const out: Array<{ row_number: number; target: Target; data: Row }> = []
  for (let offset = 0; ; offset += 1000) {
    const page = await db.select<{ row_number: number; target: Target; data: Row; tenant_id: string; brand_id: string }>(
      'import_batch_rows',
      `select=row_number,target,data,tenant_id,brand_id&batch_id=eq.${batch.id}&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}` +
        `&status=eq.accepted&order=row_number.asc&limit=1000&offset=${offset}`,
    )
    for (const r of page) {
      if (r.tenant_id !== batch.tenant_id || r.brand_id !== batch.brand_id) throw new ImportError(500, 'scope_violation', 'Rând din alt tenant sau brand; opresc importul.')
      out.push(r)
    }
    if (page.length < 1000) return out
  }
}

async function upsertScoped(db: ImportDb, table: Target, rows: Row[], batch: BatchRow): Promise<number> {
  let written = 0
  for (const r of rows) {
    if (r.tenant_id !== batch.tenant_id || r.brand_id !== batch.brand_id) throw new ImportError(500, 'scope_violation', `${table}: rând pentru alt tenant sau brand; opresc importul.`)
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const returned = await db.upsert<Row>(table, chunk, CONFLICT_KEYS[table])
    if (returned.length !== chunk.length) throw new ImportError(500, 'upsert_mismatch', `${table}: upsert a întors ${returned.length} din ${chunk.length} rânduri.`)
    for (const r of returned) {
      if (r.tenant_id !== batch.tenant_id || r.brand_id !== batch.brand_id) throw new ImportError(500, 'scope_violation', `${table}: rând întors pentru alt tenant sau brand.`)
    }
    written += returned.length
  }
  return written
}

export async function confirmImport(deps: { db: ImportDb; now?: () => Date }, batch: BatchRow, userId: string): Promise<ConfirmResult> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  assertUuid(userId, 'user_id')
  if (batch.status === 'imported') throw new ImportError(409, 'already_imported', 'Lotul a fost deja importat.')
  if (batch.status !== 'validated') throw new ImportError(409, 'not_validated', `Lotul nu poate fi confirmat din starea „${batch.status}”.`)
  if (batch.rows_accepted === 0) throw new ImportError(422, 'nothing_to_import', 'Lotul nu are rânduri acceptate.')

  // Revendicare atomică: doar un confirm câștigă (validated → validating).
  const claim = await db.update<{ id: string }>(
    'import_batches', `id=eq.${batch.id}&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}&status=eq.validated`, { status: 'validating' },
  )
  if (claim.length !== 1) throw new ImportError(409, 'import_in_progress', 'Lotul e deja în curs de confirmare sau și-a schimbat starea.')

  const written: Partial<Record<Target, number>> = {}
  try {
    const staged = await loadAccepted(db, batch)
    if (staged.length !== batch.rows_accepted) throw new ImportError(500, 'staged_mismatch', `Rânduri acceptate în lot: ${batch.rows_accepted}, găsite: ${staged.length}.`)
    const timezone = batch.timezone ?? 'Europe/Bucharest'
    const collectedAt = now.toISOString()

    const byTarget = new Map<Target, Row[]>()
    for (const s of staged) {
      const payloadHash = await sha256Hex(JSON.stringify(s.data))
      const base: Row = {
        ...s.data, tenant_id: batch.tenant_id, brand_id: batch.brand_id, import_batch_id: batch.id, row_number: s.row_number,
        collected_at: collectedAt, collection_method: 'csv', payload_hash: payloadHash, source_timezone: timezone, schema_version: SCHEMA_VERSION,
      }
      if (s.target === 'paid_daily') {
        base.source = batch.source
        base.currency = batch.currency
      }
      const list = byTarget.get(s.target) ?? []
      list.push(base)
      byTarget.set(s.target, list)
    }

    for (const [target, rows] of byTarget) {
      if (target === 'mentions') {
        // Corecțiile umane au prioritate: mențiunile cu sentiment revizuit se actualizează fără câmpul sentiment.
        const reviewed = new Set<string>()
        for (let offset = 0; ; offset += 1000) {
          const page = await db.select<{ native_id: string }>(
            'mentions', `select=native_id&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}&sentiment_reviewed_by=not.is.null&order=native_id.asc&limit=1000&offset=${offset}`,
          )
          for (const p of page) reviewed.add(p.native_id)
          if (page.length < 1000) break
        }
        const free = rows.filter((r) => !reviewed.has(r.native_id as string))
        const locked = rows.filter((r) => reviewed.has(r.native_id as string)).map((r) => {
          const { sentiment: _sentiment, ...rest } = r
          return rest
        })
        written.mentions = (await upsertScoped(db, 'mentions', free, batch)) + (await upsertScoped(db, 'mentions', locked, batch))
      } else {
        written[target] = await upsertScoped(db, target, rows, batch)
      }
    }

    const done = await db.update<{ id: string }>(
      'import_batches', `id=eq.${batch.id}&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}&status=eq.validating`,
      { status: 'imported', confirmed_by: userId, confirmed_at: collectedAt },
    )
    if (done.length !== 1) throw new ImportError(500, 'finalize_failed', 'Lotul nu a putut fi marcat ca importat.')
  } catch (err) {
    // Upsert-urile sunt idempotente: lotul revine la „validated” și poate fi reconfirmat.
    await db.update('import_batches', `id=eq.${batch.id}&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}&status=eq.validating`, { status: 'validated' }).catch(() => undefined)
    if (err instanceof ImportError) throw err
    throw new ImportError(500, 'import_failed', `Importul a eșuat: ${(err as Error).message}`)
  }

  await db.insert('audit_events', {
    tenant_id: batch.tenant_id, brand_id: batch.brand_id, actor_user_id: userId, actor_type: 'user',
    action: 'import_confirmed', entity_type: 'import_batches', entity_id: batch.id,
    after: { source: batch.source, written, uploaded_by: batch.uploaded_by, file_sha256: batch.file_sha256 },
  })
  return { batch_id: batch.id, status: 'imported', written, rows_accepted: batch.rows_accepted }
}

// --- raport ----------------------------------------------------------------------------------------------------------------------

export async function loadBatch(db: ImportDb, batchId: string): Promise<BatchRow> {
  assertUuid(batchId, 'batch_id')
  const rows = await db.select<BatchRow>('import_batches', `select=*&id=eq.${batchId}`)
  const batch = rows[0]
  if (!batch) throw new ImportError(404, 'batch_not_found', 'Lot inexistent.')
  return batch
}

export async function batchReport(db: ImportDb, batch: BatchRow, offset = 0) {
  const rejected = await db.select<{ row_number: number; reason: string }>(
    'import_batch_rows',
    `select=row_number,reason&batch_id=eq.${batch.id}&tenant_id=eq.${batch.tenant_id}&brand_id=eq.${batch.brand_id}&status=eq.rejected&order=row_number.asc&limit=200&offset=${Math.max(0, Math.floor(offset))}`,
  )
  return {
    batch_id: batch.id, source: batch.source, file_name: batch.file_name, status: batch.status, rows_total: batch.rows_total,
    rows_accepted: batch.rows_accepted, rows_rejected: batch.rows_rejected, rows_skipped: batch.rows_skipped,
    period: batch.period_start && batch.period_end ? { start: batch.period_start, end: batch.period_end } : null,
    currency: batch.currency, timezone: batch.timezone, attribution_config: batch.attribution_config, click_type: batch.click_type,
    detected: batch.detected, uploaded_by: batch.uploaded_by, confirmed_by: batch.confirmed_by, confirmed_at: batch.confirmed_at, rejected,
  }
}
