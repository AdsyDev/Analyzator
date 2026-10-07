// Scrierea în sync_runs (doar worker, service role).
// Verificare explicită a tenantului: fiecare scriere filtrează pe tenant_id și brand_id
// și verifică rândul întors.

import { assertUuid, type Db } from './supabase-rest.ts'

export type SyncRunStatus = 'queued' | 'running' | 'partial' | 'succeeded' | 'failed'

export type SyncRunError = {
  code: string
  message: string
  /** Pentru colectările pe dimensiuni: ce nu s-a colectat. */
  dimension?: string
  status?: number | null
}

export type SyncRunScope = {
  tenant_id: string
  brand_id: string
  source: string
  period_start: string
  period_end: string
  source_connection_id?: string | null
}

export type SyncRunHandle = { id: string; tenant_id: string; brand_id: string; started_at: string }

type SyncRunRow = { id: string; tenant_id: string; brand_id: string; started_at: string; status: string }

function assertScope(row: SyncRunRow | undefined, expected: { tenant_id: string; brand_id: string }): SyncRunRow {
  if (!row) throw new Error('sync_runs: niciun rând întors.')
  if (row.tenant_id !== expected.tenant_id || row.brand_id !== expected.brand_id) {
    throw new Error('sync_runs: rândul întors aparține altui tenant sau brand; opresc rularea.')
  }
  return row
}

export async function startSyncRun(db: Db, scope: SyncRunScope, now: () => Date = () => new Date()): Promise<SyncRunHandle> {
  assertUuid(scope.tenant_id, 'tenant_id')
  assertUuid(scope.brand_id, 'brand_id')
  const rows = await db.insert<SyncRunRow>('sync_runs', {
    tenant_id: scope.tenant_id,
    brand_id: scope.brand_id,
    source_connection_id: scope.source_connection_id ?? null,
    source: scope.source,
    period_start: scope.period_start,
    period_end: scope.period_end,
    status: 'running',
    started_at: now().toISOString(),
  })
  if (rows.length !== 1) throw new Error(`sync_runs: insert a întors ${rows.length} rânduri.`)
  const row = assertScope(rows[0], scope)
  return { id: row.id, tenant_id: row.tenant_id, brand_id: row.brand_id, started_at: row.started_at }
}

export type SyncRunResult = {
  status: Exclude<SyncRunStatus, 'queued' | 'running'>
  rows_written: number
  attempt_count: number
  errors: SyncRunError[]
}

/** Durata = finished_at − started_at (schema nu are coloană separată pentru durată). */
export async function finishSyncRun(
  db: Db,
  handle: SyncRunHandle,
  result: SyncRunResult,
  now: () => Date = () => new Date(),
): Promise<void> {
  assertUuid(handle.id, 'sync_run id')
  assertUuid(handle.tenant_id, 'tenant_id')
  assertUuid(handle.brand_id, 'brand_id')
  const rows = await db.update<SyncRunRow>(
    'sync_runs',
    `id=eq.${handle.id}&tenant_id=eq.${handle.tenant_id}&brand_id=eq.${handle.brand_id}`,
    {
      status: result.status,
      rows_written: result.rows_written,
      attempt_count: result.attempt_count,
      errors: result.errors,
      finished_at: now().toISOString(),
    },
  )
  if (rows.length !== 1) throw new Error(`sync_runs: update a afectat ${rows.length} rânduri (așteptat 1).`)
  assertScope(rows[0], handle)
}
