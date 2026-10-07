// Orchestrarea cu parser și writer simulate (implementările reale vin după probă).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CLARITY_CALLS, collectProject, type ClarityParser, type ClarityWriter } from './collect-core.ts'
import { parseClarityProjects } from './config.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

const project = {
  tenant_slug: 'stada',
  brand_slug: 'brand-a',
  token: 'secret-token',
  tenant_id: '10000000-0000-0000-0000-000000000001',
  brand_id: '20000000-0000-0000-0000-000000000011',
}
const now = () => new Date('2026-10-07T04:00:00Z')

type StubRow = { dimension: string }
const stubParser: ClarityParser<StubRow> = {
  parse: (payload, ctx) => (Array.isArray(payload) && payload.length ? [{ dimension: ctx.call.key }] : []),
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

async function collect(responses: Parameters<typeof fakeFetch>[0]) {
  const db = new FakeDb()
  const f = fakeFetch(responses)
  const w = stubWriter()
  const outcome = await collectProject(
    { db, parser: stubParser, writer: w.writer, fetch: f.fetch, sleep: noSleep().sleep, now },
    project,
  )
  return { outcome, db, f, w, run: db.tables.sync_runs![0]! }
}

describe('collectProject', () => {
  test('ordinea apelurilor = prioritatea: totaluri, Device, Source, URL; numOfDays=1; token în header', async () => {
    const { f, outcome, run } = await collect([OK, OK, OK, OK])
    assert.deepEqual(f.calls.map((c) => dimensionOf(c.url)), ['none', 'Device', 'Source', 'URL'])
    for (const c of f.calls) {
      assert.equal(new URL(c.url).searchParams.get('numOfDays'), '1')
      assert.equal((c.init?.headers as Record<string, string>).Authorization, 'Bearer secret-token')
    }
    assert.equal(outcome.status, 'succeeded')
    assert.equal(outcome.date, '2026-10-06')
    assert.equal(run.status, 'succeeded')
    assert.equal(run.rows_written, 4)
    assert.equal(run.attempt_count, 4)
    assert.equal(run.period_start, '2026-10-06')
    assert.equal(run.source, 'clarity')
    assert.deepEqual(run.errors, [])
  })

  test('bugetul se termină: se pierd paginile, nu totalurile; run partial cu dimensiunea listată', async () => {
    // totaluri: 503, 503, 200 (3) · Device: 503 ×3 (3) · Source: 503, 503, 200 (3) · URL: 503 (1) → buget 10/10
    const { outcome, f, run, w } = await collect([
      { status: 503 }, { status: 503 }, OK,
      { status: 503 }, { status: 503 }, { status: 503 },
      { status: 503 }, { status: 503 }, OK,
      { status: 503 }, OK,
    ])
    assert.equal(f.calls.length, 10, 'niciun apel peste buget')
    assert.equal(run.attempt_count, 10)
    assert.equal(outcome.status, 'partial')
    assert.deepEqual(outcome.collected, ['all', 'source'])
    assert.deepEqual(outcome.not_collected, ['device', 'page'])
    assert.deepEqual(w.written.map((r) => r.dimension), ['all', 'source'])
    const errors = run.errors as Array<{ code: string; dimension: string }>
    assert.ok(errors.some((e) => e.code === 'server_error' && e.dimension === 'device'))
    assert.ok(errors.some((e) => e.code === 'budget_exhausted' && e.dimension === 'page'))
  })

  test('buget epuizat devreme: apelurile rămase sunt listate explicit ca necolectate, fără a fi încercate', async () => {
    const db = new FakeDb()
    const f = fakeFetch(() => ({ status: 503 }))
    const w = stubWriter()
    const outcome = await collectProject(
      { db, parser: stubParser, writer: w.writer, fetch: f.fetch, sleep: noSleep().sleep, now, budgetLimit: 4 },
      project,
    )
    assert.equal(f.calls.length, 4)
    assert.deepEqual(f.calls.map((c) => dimensionOf(c.url)), ['none', 'none', 'none', 'Device'])
    assert.equal(outcome.status, 'failed', 'nimic colectat → failed')
    assert.deepEqual(outcome.not_collected, ['all', 'device', 'source', 'page'])
    const errors = db.tables.sync_runs![0]!.errors as Array<{ code: string; dimension: string }>
    assert.deepEqual(errors.filter((e) => e.code === 'budget_exhausted').map((e) => e.dimension), ['device', 'source', 'page'])
  })

  test('token expirat (401): fără retry, fără alte apeluri, run failed cu eroare de acces', async () => {
    const { outcome, f, run } = await collect([{ status: 401 }, OK, OK, OK])
    assert.equal(f.calls.length, 1)
    assert.equal(outcome.status, 'failed')
    const errors = run.errors as Array<{ code: string; dimension: string; status: number | null; message: string }>
    assert.deepEqual(errors[0], {
      code: 'access_denied',
      dimension: 'all',
      status: 401,
      message: errors[0]!.message,
    })
    assert.match(errors[0]!.message, /token invalid, expirat/)
    assert.deepEqual(errors.slice(1).map((e) => e.code), Array(3).fill('skipped_after_access_denied'))
  })

  test('403: tratat la fel ca 401', async () => {
    const { outcome, f } = await collect([{ status: 403 }])
    assert.equal(f.calls.length, 1)
    assert.equal(outcome.status, 'failed')
  })

  test('nume de dimensiune respins (400): dimensiunea se pierde, restul continuă, fără ghicit', async () => {
    const { outcome, f } = await collect([OK, OK, { status: 400 }, OK])
    assert.equal(f.calls.length, 4)
    assert.deepEqual(outcome.not_collected, ['source'])
    assert.equal(outcome.status, 'partial')
  })

  test('payload gol: zero rânduri, status partial', async () => {
    const { outcome, run, w } = await collect([{ status: 200, body: '[]' }, OK, OK, OK])
    assert.equal(outcome.status, 'partial')
    assert.equal(w.written.length, 3)
    assert.ok((run.errors as Array<{ code: string }>).some((e) => e.code === 'empty_payload'))
  })

  test('toate payload-urile goale: zero rânduri, partial (nu failed: apelurile au reușit)', async () => {
    const empty = { status: 200, body: '[]' }
    const { outcome, run } = await collect([empty, empty, empty, empty])
    assert.equal(outcome.status, 'partial')
    assert.equal(run.rows_written, 0)
  })

  test('excepție la scriere: run închis ca failed, restul dimensiunilor listate', async () => {
    const db = new FakeDb()
    const f = fakeFetch([OK, OK, OK, OK])
    const outcome = await collectProject(
      {
        db,
        parser: stubParser,
        writer: { upsert: async () => { throw new Error('conexiune pierdută') } },
        fetch: f.fetch,
        sleep: noSleep().sleep,
        now,
      },
      project,
    )
    assert.equal(outcome.status, 'failed')
    assert.equal(db.tables.sync_runs![0]!.status, 'failed')
    assert.deepEqual(outcome.not_collected, ['all', 'device', 'source', 'page'])
  })

  test('tokenul nu apare în sync_runs', async () => {
    const { db } = await collect([{ status: 401 }])
    assert.doesNotMatch(JSON.stringify(db.tables), /secret-token/)
  })

  test('CLARITY_CALLS are exact 4 apeluri ≤ bugetul de 10', () => {
    assert.equal(CLARITY_CALLS.length, 4)
  })
})

describe('parseClarityProjects', () => {
  test('valid', () => {
    assert.deepEqual(parseClarityProjects('[{"tenant_slug":"stada","brand_slug":"brand-a","token":" t "}]'), [
      { tenant_slug: 'stada', brand_slug: 'brand-a', token: 't' },
    ])
  })
  test('lipsă, JSON invalid, slug invalid, token lipsă, duplicat', () => {
    assert.throws(() => parseClarityProjects(undefined), /Lipsește/)
    assert.throws(() => parseClarityProjects('{'), /JSON/)
    assert.throws(() => parseClarityProjects('[{"tenant_slug":"Stada","brand_slug":"a","token":"t"}]'), /tenant_slug/)
    assert.throws(() => parseClarityProjects('[{"tenant_slug":"s","brand_slug":"a"}]'), /token/)
    assert.throws(
      () => parseClarityProjects('[{"tenant_slug":"s","brand_slug":"a","token":"1"},{"tenant_slug":"s","brand_slug":"a","token":"2"}]'),
      /duplicat/,
    )
  })
})
