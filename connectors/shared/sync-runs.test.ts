import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { finishSyncRun, startSyncRun } from './sync-runs.ts'
import { FakeDb } from './test-helpers.ts'
import type { Db, Row } from './supabase-rest.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const scope = { tenant_id: T1, brand_id: B1, source: 'clarity', period_start: '2026-10-06', period_end: '2026-10-06' }
const t0 = new Date('2026-10-07T04:00:00Z')
const t1 = new Date('2026-10-07T04:00:12Z')

describe('sync_runs', () => {
  test('start: insert cu status running și started_at', async () => {
    const db = new FakeDb()
    const handle = await startSyncRun(db, scope, () => t0)
    const row = db.tables.sync_runs![0]!
    assert.equal(row.status, 'running')
    assert.equal(row.started_at, t0.toISOString())
    assert.equal(row.tenant_id, T1)
    assert.equal(row.brand_id, B1)
    assert.equal(row.source, 'clarity')
    assert.equal(handle.id, row.id)
  })

  test('finish: status, rânduri, erori, încercări, finished_at (durata = finished − started)', async () => {
    const db = new FakeDb()
    const handle = await startSyncRun(db, scope, () => t0)
    await finishSyncRun(
      db,
      handle,
      {
        status: 'partial',
        rows_written: 42,
        attempt_count: 10,
        errors: [{ code: 'budget_exhausted', dimension: 'page', status: null, message: 'Necolectat' }],
      },
      () => t1,
    )
    const row = db.tables.sync_runs![0]!
    assert.equal(row.status, 'partial')
    assert.equal(row.rows_written, 42)
    assert.equal(row.attempt_count, 10)
    assert.deepEqual(row.errors, [{ code: 'budget_exhausted', dimension: 'page', status: null, message: 'Necolectat' }])
    assert.equal(Date.parse(row.finished_at as string) - Date.parse(row.started_at as string), 12_000)
  })

  test('finish filtrează explicit pe id, tenant_id și brand_id', async () => {
    const db = new FakeDb()
    const handle = await startSyncRun(db, scope, () => t0)
    await finishSyncRun(db, handle, { status: 'succeeded', rows_written: 1, attempt_count: 1, errors: [] }, () => t1)
    const update = db.log.find((l) => l.op === 'update')!
    assert.match(update.query!, new RegExp(`id=eq\\.${handle.id}`))
    assert.match(update.query!, new RegExp(`tenant_id=eq\\.${T1}`))
    assert.match(update.query!, new RegExp(`brand_id=eq\\.${B1}`))
  })

  test('finish cu handle pe alt brand: 0 rânduri afectate → eroare', async () => {
    const db = new FakeDb()
    const handle = await startSyncRun(db, scope, () => t0)
    await assert.rejects(
      finishSyncRun(db, { ...handle, brand_id: B2 }, { status: 'failed', rows_written: 0, attempt_count: 0, errors: [] }),
      /0 rânduri/,
    )
    assert.equal(db.tables.sync_runs![0]!.status, 'running', 'rândul original nu e atins')
  })

  test('rând întors pentru alt tenant/brand: eroare (verificare explicită)', async () => {
    const lying: Db = {
      select: async () => [],
      insert: async <T extends Row>(_t: string, row: Row) => [{ ...row, id: '00000000-0000-4000-8000-000000000001', brand_id: B2 } as unknown as T],
      update: async () => [],
      rpc: async () => { throw new Error('nefolosit') },
      upsert: async () => [],
    }
    await assert.rejects(startSyncRun(lying, scope), /altui tenant sau brand/)
  })

  test('ID-uri invalide: respinse înainte de scriere', async () => {
    const db = new FakeDb()
    await assert.rejects(startSyncRun(db, { ...scope, tenant_id: 'x&brand_id=neq.0' }))
    assert.equal(db.log.length, 0)
  })
})
