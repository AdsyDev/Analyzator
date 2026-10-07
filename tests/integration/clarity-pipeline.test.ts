// Integrare pe Supabase LOCAL: fixtures docs-derived → worker (parser + upsert real) → clarity_daily →
// view clarity_metric_observations (cu RLS) → metrics.compute (definițiile draft din registru).
// Rulare: npm run test:integration (resetează baza locală).
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectConnection } from '../../connectors/clarity/collect-core.ts'
import { clarityParser } from '../../connectors/clarity/parse.ts'
import { clarityWriter } from '../../connectors/clarity/write.ts'
import { docsFixture } from '../../connectors/clarity/docs-fixtures.ts'
import { SupabaseRest } from '../../connectors/shared/supabase-rest.ts'
import { loadActiveConnections } from '../../connectors/shared/connections.ts'
import { fakeFetch, noSleep, type FakeResponse } from '../../connectors/shared/test-helpers.ts'

const API_URL = process.env.API_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.ANON_KEY ?? ''
const JWT_SECRET = process.env.JWT_SECRET ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) {
  throw new Error(`Testele de integrare rulează doar pe Supabase local (API_URL=${API_URL || 'lipsă'}).`)
}

const ROOT = join(import.meta.dirname, '..', '..')
const PROJECT_ID = /^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8'))![1]
const DB_CONTAINER = `supabase_db_${PROJECT_ID}`

const CLARITY_1A = '50000000-0000-0000-0000-000000000031'
const ADMIN_T1 = '30000000-0000-0000-0000-000000000001'
const CLIENT_T1 = '30000000-0000-0000-0000-000000000004' // acces la 1A
const STRATEGIST_T2 = '30000000-0000-0000-0000-000000000012'
const CLIENT_NONE = '30000000-0000-0000-0000-000000000005'
// 8 oct 2026, 01:05 la București → ziua stocată 7 oct.
const now = () => new Date('2026-10-07T22:05:00Z')

const db = new SupabaseRest({ url: API_URL, serviceRoleKey: SERVICE_ROLE_KEY })

function userToken(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', iat: t, exp: t + 600 })}`
  return `${unsigned}.${createHmac('sha256', JWT_SECRET).update(unsigned).digest('base64url')}`
}

async function asUser<T>(sub: string, path: string): Promise<T> {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken(sub)}` } })
  assert.equal(res.status, 200, `${path}: ${res.status}`)
  return (await res.json()) as T
}

function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: query,
    encoding: 'utf8',
  }).trim()
}

function compute(input: unknown): {
  metric: { value: number | null; status: string; coverage: number | null }
  warnings: Array<{ code: string }>
} {
  const json = JSON.stringify(input)
  assert.ok(!json.includes('$cmp$'))
  return JSON.parse(sql(`select metrics.compute($cmp$${json}$cmp$::jsonb);`))
}

const FIXTURE_BY_DIMENSION: Record<string, Parameters<typeof docsFixture>[0]> = { none: 'all', Device: 'device', Source: 'source', URL: 'page' }
const docsResponder = (url: string): FakeResponse => {
  const dim = new URL(url).searchParams.get('dimension1') ?? 'none'
  return { status: 200, body: JSON.stringify(docsFixture(FIXTURE_BY_DIMENSION[dim]!).payload) }
}

async function runWorker() {
  const { connections } = await loadActiveConnections(db, 'clarity')
  const connection = connections.find((c) => c.id === CLARITY_1A)
  assert.ok(connection, 'conexiunea Clarity 1A trebuie să fie activă și cu token')
  return collectConnection(
    { db, parser: clarityParser, writer: clarityWriter(db), fetch: fakeFetch(docsResponder).fetch, sleep: noSleep().sleep, now },
    connection,
  )
}

type Row = Record<string, unknown>
const tableSnapshot = async () =>
  (await db.select<Row>('clarity_daily', `select=date,dimension,dimension_value,sessions,bot_sessions,distinct_users,pages_per_session,scroll_depth&brand_id=eq.20000000-0000-0000-0000-000000000011`))
    .map((r) => JSON.stringify(r))
    .sort()

describe('pipeline Clarity pe Supabase local', () => {
  before(async () => {
    const status = await db.rpc<string>('set_source_token', {
      p_actor_user_id: ADMIN_T1,
      p_connection_id: CLARITY_1A,
      p_token: 'docs-derived-integration-token',
    })
    assert.equal(status, 'unverified')
  })

  test('rulare dublă: 7 rânduri în clarity_daily, aceleași valori, două sync_runs succeeded', async () => {
    const first = await runWorker()
    assert.equal(first.status, 'succeeded')
    assert.equal(first.rows_written, 7)
    const snap1 = await tableSnapshot()
    assert.equal(snap1.length, 7)

    const second = await runWorker()
    assert.equal(second.status, 'succeeded')
    const snap2 = await tableSnapshot()
    assert.deepEqual(snap2, snap1, 'upsert idempotent: niciun duplicat, aceleași valori')

    const runs = await db.select<Row>('sync_runs', `select=status,rows_written,attempt_count&source_connection_id=eq.${CLARITY_1A}`)
    assert.deepEqual(runs.map((r) => r.status), ['succeeded', 'succeeded'])
    const calls = await db.select<{ calls: number }>('provider_api_calls', `select=calls&source_connection_id=eq.${CLARITY_1A}&purpose=eq.collect`)
    assert.equal(calls.reduce((s, r) => s + r.calls, 0), 8)
  })

  test('valorile: totaluri din fixture, metricile nedocumentate NULL în baza reală', async () => {
    const [total] = await db.select<Row>('clarity_daily', `select=*&dimension=eq.all&brand_id=eq.20000000-0000-0000-0000-000000000011`)
    assert.equal(total!.date, '2026-10-07')
    assert.equal(total!.sessions, 1200)
    assert.equal(Number(total!.pages_per_session), 2.1)
    assert.equal(total!.rage_click_count, null)
    assert.equal(total!.scroll_depth, null)
    assert.equal(total!.window_days, 1)
    assert.equal(total!.collection_method, 'api')
    assert.equal(total!.schema_version, 'docs-2025-12-05')
    assert.doesNotMatch(JSON.stringify(total), /docs-derived-integration-token/)
  })

  test('RLS: clientul cu acces la 1A vede rândurile; strategist T2 și clientul fără acces nu', async () => {
    assert.equal((await asUser<Row[]>(CLIENT_T1, 'clarity_daily?select=id')).length, 7)
    assert.deepEqual(await asUser<Row[]>(STRATEGIST_T2, 'clarity_daily?select=id'), [])
    assert.deepEqual(await asUser<Row[]>(CLIENT_NONE, 'clarity_daily?select=id'), [])
    assert.deepEqual(await asUser<Row[]>(STRATEGIST_T2, 'clarity_metric_observations?select=metric_key'), [])
  })

  async function computeFromView(metricKey: string, asOf: string) {
    const [definition] = await asUser<Row[]>(CLIENT_T1, `metric_definitions_current?metric_key=eq.${metricKey}`)
    const obs = await asUser<Array<{ date: string; value: number | null; weight: number | null }>>(
      CLIENT_T1, `clarity_metric_observations?select=date,value,weight&metric_key=eq.${metricKey}&date=gte.2026-10-07&date=lte.2026-10-07`)
    const confirmed = obs.filter((o) => o.value !== null)
    return compute({
      definition,
      brand_id: '20000000-0000-0000-0000-000000000011',
      as_of_date: asOf,
      period: { start: '2026-10-07', end: '2026-10-07', kind: 'custom' },
      connection: { connected: true, query_ok: true },
      current: {
        observations: obs,
        confirmed_days: new Set(confirmed.map((o) => o.date)).size,
        data_as_of: confirmed.length ? confirmed.map((o) => o.date).sort().at(-1) : null,
      },
    })
  }

  test('view → metrics.compute: metricile Clarity draft sunt indisponibile (NULL), nu 0', async () => {
    const obs = await asUser<Row[]>(CLIENT_T1, 'clarity_metric_observations?select=metric_key,value,weight&order=metric_key')
    assert.deepEqual(obs.map((o) => o.metric_key), [
      'clarity_dead_click_sessions', 'clarity_quickback_sessions', 'clarity_rage_click_sessions', 'clarity_scroll_depth',
    ])
    assert.equal(obs.find((o) => o.metric_key === 'clarity_scroll_depth')!.weight, 1200, 'scroll depth ponderat cu sesiunile')

    for (const key of ['clarity_rage_click_sessions', 'clarity_scroll_depth']) {
      const r = await computeFromView(key, '2026-10-08')
      assert.equal(r.metric.status, 'unavailable', key)
      assert.equal(r.metric.value, null, key)
      const codes = r.warnings.map((w) => w.code)
      assert.ok(codes.includes('definition_draft'), `${key}: marcată draft`)
      assert.ok(codes.includes('no_confirmed_data'), `${key}: motivul e explicit`)
    }
  })

  test('când câmpul va fi confirmat: view → compute dă media ponderată cu sesiunile', async () => {
    // Simulăm maparea viitoare scriind direct (service role) o valoare de scroll depth.
    await db.update('clarity_daily', 'dimension=eq.all&brand_id=eq.20000000-0000-0000-0000-000000000011', { scroll_depth: 55 })
    const r = await computeFromView('clarity_scroll_depth', '2026-10-08')
    assert.equal(Number(r.metric.value), 55)
    assert.equal(r.metric.status, 'ok')
    assert.equal(Number(r.metric.coverage), 1)
  })
})
