// Orchestrarea cu parser și writer simulate (implementările reale vin după probă).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CLARITY_CALLS, collectConnection, type ClarityParser, type ClarityWriter } from './collect-core.ts'
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
const now = () => new Date('2026-10-07T04:00:00Z')
const TOKEN = 'secret-token'

type StubRow = { dimension: string }
const stubParser: ClarityParser<StubRow> = {
  parse: (payload, ctx) => ({
    rows: Array.isArray(payload) && payload.length ? [{ dimension: ctx.call.key }] : [],
    notes: [],
  }),
}
function stubWriter() {
  const written: StubRow[] = []
  const writer: ClarityWriter<StubRow> = {
    upsert: async (_scope, rows) => {
      written.push(...rows)
      return rows.length
    },
  }
  return { writer, written }
}

const OK: FakeResponse = { status: 200, body: '[{"metricName":"Traffic","information":[{}]}]' }

function dimensionOf(url: string): string {
  return new URL(url).searchParams.get('dimension1') ?? 'none'
}

function makeDb(callsToday = 0) {
  const db = new FakeDb({
    provider_api_calls: callsToday
      ? [{ source_connection_id: connection.id, call_date_utc: '2026-10-07', calls: callsToday, tenant_id: connection.tenant_id }]
      : [],
  })
  db.rpcs.get_source_token = (args) => {
    assert.deepEqual(args, { p_connection_id: connection.id })
    return TOKEN
  }
  return db
}

async function collect(responses: Parameters<typeof fakeFetch>[0], opts: { callsToday?: number; db?: FakeDb } = {}) {
  const db = opts.db ?? makeDb(opts.callsToday)
  const f = fakeFetch(responses)
  const w = stubWriter()
  const outcome = await collectConnection(
    { db, parser: stubParser, writer: w.writer, fetch: f.fetch, sleep: noSleep().sleep, now },
    connection,
  )
  const recorded = (db.tables.provider_api_calls ?? []).filter((r) => r.purpose === 'collect')
  return { outcome, db, f, w, run: db.tables.sync_runs![0]!, recorded }
}

describe('collectConnection', () => {
  test('ordinea apelurilor = prioritatea; numOfDays=1; token din Vault; sync_run legat de conexiune', async () => {
    const { f, outcome, run, recorded } = await collect([OK, OK, OK, OK])
    assert.deepEqual(f.calls.map((c) => dimensionOf(c.url)), ['none', 'Device', 'Source', 'URL'])
    for (const c of f.calls) {
      assert.equal(new URL(c.url).searchParams.get('numOfDays'), '1')
      assert.equal((c.init?.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`)
    }
    assert.equal(outcome.status, 'succeeded')
    assert.equal(outcome.date, '2026-10-06')
    assert.equal(run.source_connection_id, connection.id)
    assert.equal(run.rows_written, 4)
    assert.equal(run.attempt_count, 4)
    assert.deepEqual(run.errors, [])
    assert.deepEqual(
      recorded.map((r) => [r.call_date_utc, r.calls, r.sync_run_id]),
      [['2026-10-07', 4, run.id]],
      'apelurile se contorizează în provider_api_calls, pe ziua UTC',
    )
  })

  test('pornește cu 10 minus apelurile de azi: 4 deja făcute → 6 disponibile', async () => {
    const { f, outcome, run } = await collect(() => ({ status: 503 }), { callsToday: 4 })
    assert.equal(outcome.calls_before_run, 4)
    assert.equal(f.calls.length, 6, 'niciun apel peste bugetul rămas')
    assert.equal(run.attempt_count, 6)
  })

  test('sub 4 apeluri rămase: nu pornește, nu citește tokenul, run failed cu motivul', async () => {
    const db = makeDb(7)
    db.rpcs.get_source_token = () => assert.fail('tokenul nu trebuie citit')
    const { f, outcome, run, recorded } = await collect([OK], { db })
    assert.equal(f.calls.length, 0)
    assert.equal(outcome.status, 'failed')
    assert.equal((run.errors as Array<{ code: string }>)[0]!.code, 'insufficient_budget')
    assert.match((run.errors as Array<{ message: string }>)[0]!.message, /3\/10/)
    assert.deepEqual(outcome.not_collected, ['all', 'device', 'source', 'page'])
    assert.equal(recorded.length, 0)
  })

  test('exact 4 rămase: pornește', async () => {
    const { f, outcome } = await collect([OK, OK, OK, OK], { callsToday: 6 })
    assert.equal(f.calls.length, 4)
    assert.equal(outcome.status, 'succeeded')
  })

  test('bugetul se termină: se pierd paginile, nu totalurile; dimensiunea listată în sync_runs', async () => {
    const { outcome, f, run, w, recorded } = await collect([
      { status: 503 }, { status: 503 }, OK,
      { status: 503 }, { status: 503 }, { status: 503 },
      { status: 503 }, { status: 503 }, OK,
      { status: 503 }, OK,
    ])
    assert.equal(f.calls.length, 10)
    assert.equal(run.attempt_count, 10)
    assert.equal(recorded[0]!.calls, 10)
    assert.equal(outcome.status, 'partial')
    assert.deepEqual(outcome.collected, ['all', 'source'])
    assert.deepEqual(outcome.not_collected, ['device', 'page'])
    assert.deepEqual(w.written.map((r) => r.dimension), ['all', 'source'])
    const errors = run.errors as Array<{ code: string; dimension: string }>
    assert.ok(errors.some((e) => e.code === 'server_error' && e.dimension === 'device'))
    assert.ok(errors.some((e) => e.code === 'budget_exhausted' && e.dimension === 'page'))
  })

  test('token expirat (401): fără retry, fără alte apeluri, run failed, apelul contorizat', async () => {
    const { outcome, f, run, recorded } = await collect([{ status: 401 }, OK, OK, OK])
    assert.equal(f.calls.length, 1)
    assert.equal(outcome.status, 'failed')
    const errors = run.errors as Array<{ code: string; dimension: string; status: number | null; message: string }>
    assert.equal(errors[0]!.code, 'access_denied')
    assert.equal(errors[0]!.status, 401)
    assert.match(errors[0]!.message, /token invalid, expirat/)
    assert.deepEqual(errors.slice(1).map((e) => e.code), Array(3).fill('skipped_after_access_denied'))
    assert.equal(recorded[0]!.calls, 1)
  })

  test('nume de dimensiune respins (400): dimensiunea se pierde, restul continuă', async () => {
    const { outcome, f } = await collect([OK, OK, { status: 400 }, OK])
    assert.equal(f.calls.length, 4)
    assert.deepEqual(outcome.not_collected, ['source'])
    assert.equal(outcome.status, 'partial')
  })

  test('payload gol: zero rânduri, status partial', async () => {
    const { outcome, run } = await collect([{ status: 200, body: '[]' }, OK, OK, OK])
    assert.equal(outcome.status, 'partial')
    assert.ok((run.errors as Array<{ code: string }>).some((e) => e.code === 'empty_payload'))
  })

  test('token indisponibil în Vault: run failed, niciun apel', async () => {
    const db = makeDb()
    db.rpcs.get_source_token = () => { throw new Error('Conexiune inexistentă, inactivă sau fără token') }
    const { f, outcome, run } = await collect([OK], { db })
    assert.equal(f.calls.length, 0)
    assert.equal(outcome.status, 'failed')
    assert.equal((run.errors as Array<{ code: string }>)[0]!.code, 'token_unavailable')
    assert.equal(run.status, 'failed', 'run-ul nu rămâne running')
  })

  test('excepție la scriere: run failed, apelurile tot contorizate', async () => {
    const db = makeDb()
    const f = fakeFetch([OK, OK, OK, OK])
    const outcome = await collectConnection(
      {
        db,
        parser: stubParser,
        writer: { upsert: async () => { throw new Error('conexiune pierdută') } },
        fetch: f.fetch,
        sleep: noSleep().sleep,
        now,
      },
      connection,
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(db.tables.sync_runs![0]!.status, 'failed')
    assert.equal(db.tables.provider_api_calls!.find((r) => r.purpose === 'collect')!.calls, 1)
  })

  test('tokenul nu apare în sync_runs sau provider_api_calls', async () => {
    const { db } = await collect([{ status: 401 }])
    assert.doesNotMatch(JSON.stringify(db.tables), /secret-token/)
  })

  test('conexiune non-Clarity: refuzată', async () => {
    await assert.rejects(
      collectConnection({ db: makeDb(), parser: stubParser, writer: stubWriter().writer }, { ...connection, provider: 'ga4' }),
      /nu e Clarity/,
    )
  })

  test('CLARITY_CALLS are exact 4 apeluri', () => {
    assert.equal(CLARITY_CALLS.length, 4)
  })
})
