// Worker-ul Clarity cap-coadă (fetch simulat cu fixtures docs-derived, parser și writer reale, bază în memorie):
// rulare dublă idempotentă, buget, 401/403, pagină goală, payload invalid, câmpuri necunoscute logate.
import { test, describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import { collectConnection } from './collect-core.ts'
import { clarityParser } from './parse.ts'
import { clarityWriter } from './write.ts'
import { docsFixture } from './docs-fixtures.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'
import type { SourceConnection } from '../shared/connections.ts'

const connection: SourceConnection = {
  id: '50000000-0000-0000-0000-000000000031',
  tenant_id: '10000000-0000-0000-0000-000000000001',
  brand_id: '20000000-0000-0000-0000-000000000011',
  provider: 'clarity',
  external_account_id: 'clarity-1a',
  credential_status: 'valid',
}
// 8 oct 2026, 01:05 la București (22:05 UTC pe 7 oct) → ziua stocată 7 oct; ziua de buget UTC 7 oct.
const now = () => new Date('2026-10-07T22:05:00Z')

const FIXTURE_BY_DIMENSION: Record<string, Parameters<typeof docsFixture>[0]> = {
  none: 'all', Device: 'device', Source: 'source', URL: 'page',
}

function docsResponder(overrides: Record<string, FakeResponse> = {}) {
  return (url: string): FakeResponse => {
    const dim = new URL(url).searchParams.get('dimension1') ?? 'none'
    if (overrides[dim]) return overrides[dim]!
    return { status: 200, body: JSON.stringify(docsFixture(FIXTURE_BY_DIMENSION[dim]!).payload) }
  }
}

function makeDb(callsToday = 0) {
  const db = new FakeDb({
    provider_api_calls: callsToday
      ? [{ source_connection_id: connection.id, call_date_utc: '2026-10-07', calls: callsToday, tenant_id: connection.tenant_id }]
      : [],
  })
  db.rpcs.get_source_token = () => 'docs-derived-token'
  return db
}

async function run(db: FakeDb, responder: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(responder)
  const outcome = await collectConnection(
    { db, parser: clarityParser, writer: clarityWriter(db), fetch: f.fetch, sleep: noSleep().sleep, now },
    connection,
  )
  return { outcome, f }
}

const clarityRows = (db: FakeDb) => db.tables.clarity_daily ?? []
const snapshot = (db: FakeDb) =>
  clarityRows(db)
    .map((r) => `${r.date}|${r.dimension}|${r.dimension_value}|${r.sessions}|${r.bot_sessions}|${r.distinct_users}|${r.pages_per_session}|${r.scroll_depth}`)
    .sort()

describe('worker Clarity cu fixtures docs-derived', () => {
  test('o rulare: 7 rânduri (1 total, 2 device, 2 source, 2 page), ziua anterioară în Europe/Bucharest, succeeded', async () => {
    const db = makeDb()
    const { outcome } = await run(db, docsResponder())
    assert.equal(outcome.status, 'succeeded')
    assert.equal(outcome.rows_written, 7)
    assert.equal(clarityRows(db).length, 7)
    assert.ok(clarityRows(db).every((r) => r.date === '2026-10-07'))
    const total = clarityRows(db).find((r) => r.dimension === 'all')!
    assert.equal(total.sessions, 1200)
    assert.equal(total.scroll_depth, null, 'metricile nedocumentate rămân NULL')
    assert.equal(total.source_id, connection.id)
    assert.equal(total.sync_run_id, db.tables.sync_runs![0]!.id)
    assert.match(String(total.payload_hash), /^[0-9a-f]{64}$/)
    assert.equal(total.collected_at, '2026-10-07T22:05:00.000Z')
  })

  test('rulare dublă în aceeași zi: nu dublează nimic, aceleași totaluri', async () => {
    const db = makeDb()
    await run(db, docsResponder())
    const first = snapshot(db)
    const sumFirst = clarityRows(db).reduce((s, r) => s + Number(r.sessions ?? 0), 0)
    const { outcome } = await run(db, docsResponder())
    assert.equal(outcome.status, 'succeeded')
    assert.equal(clarityRows(db).length, 7, 'același număr de rânduri')
    assert.deepEqual(snapshot(db), first, 'aceleași valori')
    assert.equal(clarityRows(db).reduce((s, r) => s + Number(r.sessions ?? 0), 0), sumFirst)
    assert.equal(db.tables.sync_runs!.length, 2, 'două sync_runs, câte unul per rulare')
    const calls = db.tables.provider_api_calls!.filter((r) => r.purpose === 'collect').map((r) => r.calls)
    assert.deepEqual(calls, [4, 4], 'apelurile ambelor rulări sunt contorizate')
  })

  test('buget: cu 6 apeluri deja făcute azi, exact 4 apeluri; cu 7, nu pornește', async () => {
    const ok = await run(makeDb(6), docsResponder())
    assert.equal(ok.f.calls.length, 4)
    assert.equal(ok.outcome.status, 'succeeded')
    const db = makeDb(7)
    const refused = await run(db, docsResponder())
    assert.equal(refused.f.calls.length, 0)
    assert.equal(refused.outcome.status, 'failed')
    assert.equal(clarityRows(db).length, 0)
  })

  test('buget epuizat la mijloc: totalurile se păstrează, paginile se pierd', async () => {
    // 6 deja folosite → 4 disponibile; Device consumă 2 (503, apoi 200) → la URL nu mai e buget.
    let deviceCalls = 0
    const responder = (url: string): FakeResponse => {
      const dim = new URL(url).searchParams.get('dimension1') ?? 'none'
      if (dim === 'Device' && deviceCalls++ === 0) return { status: 503 }
      return docsResponder()(url)
    }
    const db = makeDb(6)
    const { outcome, f } = await run(db, responder)
    assert.equal(f.calls.length, 4)
    assert.equal(outcome.status, 'partial')
    assert.deepEqual(outcome.not_collected, ['page'])
    assert.ok(clarityRows(db).some((r) => r.dimension === 'all'))
    assert.ok(!clarityRows(db).some((r) => r.dimension === 'page'))
    const errors = db.tables.sync_runs![0]!.errors as Array<{ code: string; dimension: string }>
    assert.ok(errors.some((e) => e.code === 'budget_exhausted' && e.dimension === 'page'))
  })

  for (const status of [401, 403]) {
    test(`${status}: run failed, un singur apel, nimic scris`, async () => {
      const db = makeDb()
      const { outcome, f } = await run(db, () => ({ status }))
      assert.equal(f.calls.length, 1)
      assert.equal(outcome.status, 'failed')
      assert.equal(clarityRows(db).length, 0)
      const errors = db.tables.sync_runs![0]!.errors as Array<{ code: string; status: number | null }>
      assert.equal(errors[0]!.code, 'access_denied')
      assert.equal(errors[0]!.status, status)
    })
  }

  test('pagină goală ([] la URL): zero rânduri pentru pagini, run partial, restul scris', async () => {
    const db = makeDb()
    const { outcome } = await run(db, docsResponder({ URL: { status: 200, body: '[]' } }))
    assert.equal(outcome.status, 'partial')
    assert.equal(clarityRows(db).filter((r) => r.dimension === 'page').length, 0)
    assert.equal(clarityRows(db).length, 5)
    const errors = db.tables.sync_runs![0]!.errors as Array<{ code: string; dimension: string }>
    assert.ok(errors.some((e) => e.code === 'empty_payload' && e.dimension === 'page'))
  })

  test('bloc Traffic fără rânduri la URL: tratat tot ca pagină goală', async () => {
    const db = makeDb()
    const { outcome } = await run(db, docsResponder({
      URL: { status: 200, body: JSON.stringify([{ metricName: 'Traffic', information: [] }]) },
    }))
    assert.equal(outcome.status, 'partial')
  })

  test('payload cu formă invalidă la Source: dimensiunea pierdută, nimic scris pentru ea, run partial', async () => {
    const db = makeDb()
    const { outcome } = await run(db, docsResponder({ Source: { status: 200, body: '{"error":"x"}' } }))
    assert.equal(outcome.status, 'partial')
    assert.deepEqual(outcome.not_collected, ['source'])
    assert.equal(clarityRows(db).filter((r) => r.dimension === 'source').length, 0)
  })

  test('câmpuri necunoscute: logate (console.warn și sync_runs.errors), statusul rămâne succeeded', async () => {
    const warn = mock.method(console, 'warn', () => {})
    try {
      const db = makeDb()
      const extra = JSON.stringify([
        { metricName: 'Traffic', information: [{ totalSessionCount: '5', brandNewField: '1' }] },
        { metricName: 'Rage Click Count', information: [{ sessionsCount: '2' }] },
      ])
      const { outcome } = await run(db, docsResponder({ none: { status: 200, body: extra } }))
      assert.equal(outcome.status, 'succeeded')
      const errors = db.tables.sync_runs![0]!.errors as Array<{ code: string }>
      assert.ok(errors.some((e) => e.code === 'parser_unknown_field'))
      assert.ok(errors.some((e) => e.code === 'parser_unconfirmed_field'))
      assert.ok(warn.mock.calls.some((c) => String(c.arguments[0]).includes('brandNewField')))
      assert.equal(clarityRows(db).find((r) => r.dimension === 'all')!.rage_click_count, null)
    } finally {
      warn.mock.restore()
    }
  })

  test('tokenul nu ajunge în clarity_daily, sync_runs sau provider_api_calls', async () => {
    const db = makeDb()
    await run(db, docsResponder())
    assert.doesNotMatch(JSON.stringify(db.tables), /docs-derived-token/)
  })

  test('writer-ul refuză rânduri pentru alt brand', async () => {
    const db = makeDb()
    const writer = clarityWriter(db)
    await assert.rejects(
      writer.upsert({ tenant_id: connection.tenant_id, brand_id: connection.brand_id },
        [{ ...clarityRows(db)[0], tenant_id: connection.tenant_id, brand_id: '20000000-0000-0000-0000-000000000012' } as never]),
      /alt tenant sau brand/,
    )
  })
})
