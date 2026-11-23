import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectPlanable } from './collect-core.ts'
import { competitorDailyRows, normalizeHandle } from './competitors.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

// Răspunsurile sunt construite după specificația OpenAPI publică (citită 2026-11-23): derivate din documentație,
// neconfirmate pe un cont real.

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const CRED = '50000000-0000-0000-0000-0000000000c1'
const CONN = '50000000-0000-0000-0000-0000000000c2'
const NOW = new Date('2026-10-08T07:00:00Z') // ieri în București = 2026-10-07; fereastra 2026-09-03 … 2026-10-07
const TOKEN = 'pln_SECRET-TOKEN-DO-NOT-LOG'
const WS = 'ws-urinal'

const json = (body: unknown, status = 200): FakeResponse => ({ status, body: JSON.stringify(body) })
const page = (id: string, platform: string) => ({ id, name: `Pagina ${id}`, platform, workspaceId: WS, isConnected: true })
const tracked = (handle: string, scrapedPageId: string | null, platform = 'instagram') => ({ trackedCompetitorId: `t-${handle}`, scrapedPageId, handle, displayName: handle.toUpperCase(), platform, profileImageUrl: null, syncStatus: 'synced', lastSyncedAt: null })
const series = (handle: string, isOwn: boolean, points: Array<[string, number | null, number | null]>) => ({
  id: `s-${handle}`, isOwn, handle, displayName: `Nume ${handle}`, platform: 'instagram', profileImageUrl: null,
  points: points.map(([date, followers, engagement]) => ({ date, followers, engagement })),
})
const topPost = (n: number, handle = 'cystenal', o: Record<string, unknown> = {}) => ({
  scrapedPageId: 'sp-1', handle, url: `https://www.instagram.com/p/c${n}/`, content: 'text', mediaType: 'image', postedAt: '2026-10-02T09:00:00Z',
  likes: 10, comments: 2, shares: null, views: null, engagementRate: 0.1, hashtags: [], ...o,
})

type Table = Record<string, FakeResponse | ((url: URL) => FakeResponse)>
function run(overrides: Table = {}) {
  const base: Table = {
    '/api/v1/workspaces': json({ data: [{ id: WS, name: 'Urinal', timezone: 'Europe/Bucharest' }] }),
    '/api/v1/pages': json({ data: [page('pg-ig', 'instagram'), page('pg-x', 'twitter')], pagination: { offset: 0, limit: 50, hasMore: false } }),
    '/api/v1/pages/pg-ig/metrics': json({ data: [], pagination: { offset: 0, limit: 90, hasMore: false } }),
    '/api/v1/pages/pg-x/metrics': json({ data: [], pagination: { offset: 0, limit: 90, hasMore: false } }),
    '/api/v1/posts': json({ data: [], pagination: { offset: 0, limit: 50, hasMore: false } }),
    '/api/v1/pages/pg-ig/competitors': json({ data: [tracked('Cystenal', 'sp-1'), tracked('nou', null)] }),
    '/api/v1/pages/pg-ig/competitors/metrics': json({
      data: [
        series('urinal', true, [['2026-10-06T00:00:00Z', 5000, 50]]),
        series('@Cystenal', false, [['2026-10-06T00:00:00Z', 1200, 30], ['2026-10-07T00:00:00Z', 1210, null], ['2026-10-07T00:00:00Z', 1211, 7]]),
      ],
    }),
    '/api/v1/pages/pg-ig/competitors/top-posts': json({ data: [topPost(1), topPost(2, 'Cystenal', { shares: 4, likes: -1 })] }),
    '/api/v1/keywords': json({ data: [] }),
  }
  const table = { ...base, ...overrides }
  const f = fakeFetch((raw) => {
    const url = new URL(raw)
    const r = table[url.pathname]
    if (!r) throw new Error(`rută neașteptată ${url.pathname}`)
    return typeof r === 'function' ? r(url) : r
  })
  const db = new FakeDb({
    source_connections: [
      { id: CRED, tenant_id: T1, brand_id: null, provider: 'planable_account', external_account_id: 'STADA', status: 'active', credential_status: 'valid' },
      { id: CONN, tenant_id: T1, brand_id: B1, provider: 'planable', external_account_id: WS, status: 'active', credential_status: 'missing' },
    ],
    sync_runs: [], provider_api_calls: [], social_daily: [], social_posts: [], mentions: [], competitor_social_daily: [], competitor_social_posts: [],
  })
  db.rpcs.get_source_token = () => TOKEN
  db.rpcs.record_source_validation = () => undefined
  return { db, f, out: collectPlanable({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW }) }
}

describe('competitorii din Planable', () => {
  test('seriile zilnice și postările competitorilor, cu proveniență; pagina proprie nu intră; aceeași rulare socială', async () => {
    const { db, f, out } = run()
    const outcomes = await out
    assert.deepEqual(outcomes.map((o) => [o.source, o.status]), [['planable_analytics', 'succeeded'], ['planable_listening', 'not_connected']])
    const daily = db.tables.competitor_social_daily!
    assert.deepEqual(daily.map((r) => [r.platform, r.handle, r.date, r.followers, r.engagement]).sort(), [
      ['instagram', 'cystenal', '2026-10-06', 1200, 30],
      ['instagram', 'cystenal', '2026-10-07', 1211, 7],
    ], 'handle-ul fără „@”, cu litere mici; două puncte în aceeași zi → ultimul; seria proprie nu intră')
    const posts = db.tables.competitor_social_posts!
    assert.equal(posts.length, 2)
    assert.deepEqual(posts.map((r) => [r.handle, r.likes, r.comments, r.shares]), [['cystenal', 10, 2, null], ['cystenal', null, 2, 4]],
      'o valoare negativă devine NULL (cu notă), distribuirile lipsă rămân NULL')
    for (const r of [...daily, ...posts]) {
      assert.equal(r.tenant_id, T1)
      assert.equal(r.brand_id, B1)
      assert.equal(r.source_id, CONN)
      assert.match(String(r.payload_hash), /^[0-9a-f]{64}$/)
      assert.equal(r.schema_version, 'openapi-2026-11-23')
    }
    assert.match(String(posts[0]!.post_key), /^[0-9a-f]{32}$/)
    // Twitter nu are analiza competitorilor: nicio cerere; competitorul fără date în Planable nu are cerere de postări.
    assert.ok(!f.calls.some((c) => c.url.includes('pg-x/competitors')))
    const postCalls = f.calls.filter((c) => c.url.includes('/top-posts'))
    assert.equal(postCalls.length, 1)
    const u = new URL(postCalls[0]!.url)
    assert.equal(u.searchParams.get('scrapedPageIds'), 'sp-1')
    assert.equal(u.searchParams.get('limit'), '100')
    assert.equal(u.searchParams.get('startDate'), '2026-09-03T00:00:00.000Z')
    const run1 = db.tables.sync_runs!.find((r) => r.source === 'planable_analytics')!
    assert.equal(run1.rows_written, 4)
    const notes = (run1.errors as Array<{ message: string }>).map((e) => e.message)
    assert.ok(notes.some((n) => n.includes('@nou nu are încă date')))
    assert.ok(notes.some((n) => n.includes('valoare invalidă pentru likes')))
    const calls = db.tables.provider_api_calls!.reduce((s, c) => s + (c.calls as number), 0)
    assert.equal(calls, f.calls.length, 'fiecare cerere e contorizată')
  })

  test('limita de 100 de postări: cererea se reia pe săptămâni', async () => {
    const full = Array.from({ length: 100 }, (_, i) => topPost(i))
    const { db, f, out } = run({
      '/api/v1/pages/pg-ig/competitors/top-posts': (url) =>
        url.searchParams.get('startDate') === '2026-09-03T00:00:00.000Z' && url.searchParams.get('endDate') === '2026-10-07T23:59:59.999Z'
          ? json({ data: full })
          : json({ data: [topPost(Number(url.searchParams.get('startDate')!.slice(8, 10)) + 1000)] }),
    })
    await out
    const weeks = f.calls.filter((c) => c.url.includes('/top-posts')).map((c) => new URL(c.url).searchParams.get('startDate')!.slice(0, 10))
    assert.deepEqual(weeks, ['2026-09-03', '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24', '2026-10-01'])
    assert.equal(db.tables.competitor_social_posts!.length, 105, 'postările din cererea întreagă și din săptămâni, fiecare o dată')
  })

  test('add-on inactiv (403) sau rețea nesuportată (400): notă, rularea socială rămâne reușită', async () => {
    for (const status of [400, 403]) {
      const { db, out } = run({ '/api/v1/pages/pg-ig/competitors': json({ error: { code: 'FORBIDDEN' } }, status) })
      const outcomes = await out
      assert.equal(outcomes[0]!.status, 'succeeded', `HTTP ${status}`)
      assert.equal(db.tables.competitor_social_daily!.length, 0)
    }
  })

  test('eroare de server pe serii: rularea devine parțială, postările se scriu', async () => {
    const { db, out } = run({ '/api/v1/pages/pg-ig/competitors/metrics': json({}, 404) })
    const outcomes = await out
    assert.equal(outcomes[0]!.status, 'partial')
    assert.equal(db.tables.competitor_social_daily!.length, 0)
    assert.equal(db.tables.competitor_social_posts!.length, 2)
  })

  test('forma schimbată a listei de competitori: eroare, nicio cerere mai departe', async () => {
    const { db, f, out } = run({ '/api/v1/pages/pg-ig/competitors': json({ competitors: [] }) })
    const outcomes = await out
    assert.equal(outcomes[0]!.status, 'failed', 'nicio linie scrisă și o eroare reală')
    assert.ok(!f.calls.some((c) => c.url.includes('/competitors/')))
    assert.equal(db.tables.competitor_social_posts!.length, 0)
  })
})

describe('normalizare', () => {
  test('handle: fără „@”, litere mici; spațiile sau căile sunt respinse', () => {
    assert.equal(normalizeHandle(' @Cystenal.RO '), 'cystenal.ro')
    assert.equal(normalizeHandle('cu spatiu'), null)
    assert.equal(normalizeHandle('a/b'), null)
  })
  test('rețea fără analiza competitorilor: seria e ignorată cu notă', () => {
    const notes: string[] = []
    const rows = competitorDailyRows({ data: [{ ...series('x', false, [['2026-10-06T00:00:00Z', 1, 1]]), platform: 'twitter' }] }, 'instagram', 'Europe/Bucharest',
      { tenant_id: T1, brand_id: B1, source_id: CONN, sync_run_id: 'r', collected_at: 'now' }, 'a'.repeat(64), notes)
    assert.equal(rows.length, 0)
    assert.equal(notes.length, 1)
  })
})
