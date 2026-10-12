import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectPlanable } from './collect-core.ts'
import { mentionNativeId, pageMetrics, platformOf } from './normalize.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

// Răspunsurile sunt construite după schema OpenAPI publică (api.planable.io/api/v1/openapi.json, 2026-10-12):
// derivate din documentație, neconfirmate pe un cont real.

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const CRED = '50000000-0000-0000-0000-0000000000c1'
const CONN = '50000000-0000-0000-0000-0000000000c2'
const CONN_T2 = '50000000-0000-0000-0000-0000000000c3'
const NOW = new Date('2026-10-08T07:00:00Z') // 10:00 în București; ieri = 2026-10-07
const TOKEN = 'pln_SECRET-TOKEN-DO-NOT-LOG'
const WS = 'ws-urinal'

const page = (id: string, platform: string, isConnected = true) => ({ id, name: `Pagina ${id}`, platform, workspaceId: WS, createdAt: '2026-01-01T00:00:00Z', isConnected, profilePicture: null, link: null })
const snapshot = (fetchedAt: string, totalFollowers: number, extra: Record<string, unknown> = {}) => ({
  pageId: 'pg-ig', pageType: 'instagram', fetchedAt, partial: false,
  instagram: { gainedFollowers: 3, unFollows: 1, totalFollowers, impressions: 900, views: 1200, reach: 700, engagement: 55, ...extra },
})
const post = (id: string, o: Record<string, unknown> = {}) => ({
  id, workspaceId: WS, pageId: 'pg-ig', type: 'post', classification: 'organic', plainText: `Text ${id}`, createdAt: '2026-10-01T08:00:00Z', creatorId: 'u1',
  campaignId: null, media: [], scheduledAt: '2026-10-02T09:30:00Z', status: 'published', approved: true, approval: {}, published: true, scheduledSet: true,
  teamOnly: false, archived: false, commentsCounter: 0, notesCounter: 0, suggestionsCounter: 0, publishedPostLink: `https://www.instagram.com/p/${id}/`, ...o,
})
const mention = (url: string, sentiment = 'positive') => ({ platform: 'instagram', publishedAt: '2026-10-05T12:00:00Z', engagement: 10, sentiment, url, text: `Mențiune ${url}`, author: { name: 'A', username: 'a', profileImageUrl: null } })
const json = (body: unknown, status = 200): FakeResponse => ({ status, body: JSON.stringify(body) })

function routes(overrides: Record<string, FakeResponse | ((url: URL) => FakeResponse)> = {}) {
  const base: Record<string, FakeResponse | ((url: URL) => FakeResponse)> = {
    '/api/v1/workspaces': json({ data: [{ id: WS, name: 'Urinal', companyId: 'co1', timezone: 'Europe/Bucharest' }] }),
    '/api/v1/pages': json({ data: [page('pg-ig', 'instagram'), page('pg-off', 'facebook', false)], pagination: { offset: 0, limit: 50, hasMore: false } }),
    '/api/v1/pages/pg-ig/metrics': json({
      data: [snapshot('2026-10-06T05:00:00Z', 5000), snapshot('2026-10-06T20:00:00Z', 5010), snapshot('2026-10-07T05:00:00Z', 5020, { reach: undefined })],
      pagination: { offset: 0, limit: 90, hasMore: false },
    }),
    '/api/v1/posts': json({ data: [post('p1'), post('p2', { published: false, status: 'draft' })], pagination: { offset: 0, limit: 50, hasMore: false } }),
    '/api/v1/posts/p1/metrics': json({ data: { postId: 'p1', pageId: 'pg-ig', pageType: 'instagram', fetchedAt: '2026-10-07T06:00:00Z', impressions: 400, engagement: 30, reactions: 25, instagram: {} } }),
    '/api/v1/keywords': json({ data: [{ keywordId: 'k1', text: 'Urinal', type: 'brand', createdAt: '2026-01-01T00:00:00Z' }] }),
    '/api/v1/keywords/k1/mentions': (url) =>
      url.searchParams.get('cursor') === '1'
        ? json({ data: [mention('https://x.com/b/1', 'negative')], pagination: { nextCursor: null, total: 2 } })
        : json({ data: [mention('https://x.com/a/1')], pagination: { nextCursor: 1, total: 2 } }),
  }
  const table = { ...base, ...overrides }
  return fakeFetch((raw) => {
    const url = new URL(raw)
    const r = table[url.pathname]
    if (!r) throw new Error(`rută neașteptată ${url.pathname}`)
    return typeof r === 'function' ? r(url) : r
  })
}

function setup(o: { credential?: 'unverified' | 'missing' | 'invalid' | null; connections?: Array<Record<string, unknown>>; tables?: Record<string, Array<Record<string, unknown>>> } = {}) {
  const cred = o.credential === undefined ? 'unverified' : o.credential
  const db = new FakeDb({
    source_connections: [
      ...(cred ? [{ id: CRED, tenant_id: T1, brand_id: null, provider: 'planable_account', external_account_id: 'STADA', status: 'active', credential_status: cred }] : []),
      ...(o.connections ?? [{ id: CONN, tenant_id: T1, brand_id: B1, provider: 'planable', external_account_id: WS, status: 'active', credential_status: 'missing' }]),
    ],
    sync_runs: [],
    provider_api_calls: [],
    social_daily: [],
    social_posts: [],
    mentions: [],
    ...o.tables,
  })
  const validations: Array<Record<string, unknown>> = []
  db.rpcs.get_source_token = (a) => {
    if (a.p_connection_id !== CRED) throw new Error('token cerut pentru altă conexiune')
    return TOKEN
  }
  db.rpcs.record_source_validation = (a) => void validations.push(a)
  return { db, validations }
}

describe('normalizare Planable', () => {
  test('platformele, ca în contractul CSV', () => {
    assert.equal(platformOf('twitter'), 'x')
    assert.equal(platformOf('googleMyBusiness'), 'google_business')
    assert.equal(platformOf('Instagram'), 'instagram')
  })

  test('metricile de pagină: câmp lipsă → NULL, valoare negativă → NULL cu notă', () => {
    const notes: string[] = []
    const r = pageMetrics({ pageId: 'p', pageType: 'linkedin', fetchedAt: '2026-10-07T00:00:00Z', partial: false, linkedin: { totalFollowers: 10, impressions: -1, reactions: 0 } }, notes)
    assert.equal(r.metrics.followers, 10)
    assert.equal(r.metrics.impressions, null)
    assert.equal(r.metrics.likes, 0)
    assert.equal(r.metrics.comments, null)
    assert.equal(notes.length, 1)
  })

  test('native_id identic cu importul CSV fără ID (hash-ul URL-ului)', () => {
    assert.match(mentionNativeId('https://x.com/a/1'), /^h:[0-9a-f]{32}$/)
  })
})

describe('collectPlanable', () => {
  test('fără token al clientului: not_connected, fără sync_run și fără cereri', async () => {
    const { db } = setup({ credential: null })
    const f = routes()
    const out = await collectPlanable({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => [o.source, o.status]), [['planable_analytics', 'not_connected'], ['planable_listening', 'not_connected']])
    assert.equal(db.tables.sync_runs!.length, 0)
    assert.equal(f.calls.length, 0)
  })

  test('token marcat invalid: motivul apare pe conexiunile brandurilor', async () => {
    const { db } = setup({ credential: 'invalid' })
    const out = await collectPlanable({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'not_connected')
    assert.match(out[0]!.reason ?? '', /token Planable/)
  })

  test('rulare completă: social, postări, mențiuni, cu proveniență API și acoperire', async () => {
    const { db, validations } = setup()
    const f = routes()
    const out = await collectPlanable({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => [o.source, o.status]), [['planable_analytics', 'succeeded'], ['planable_listening', 'succeeded']])

    const daily = db.tables.social_daily!
    assert.deepEqual(daily.map((r) => [r.date, r.followers]).sort(), [['2026-10-06', 5010], ['2026-10-07', 5020]])
    const oct7 = daily.find((r) => r.date === '2026-10-07')!
    assert.equal(oct7.reach_not_additive, null, 'reach lipsă → NULL, nu 0')
    assert.equal(oct7.platform, 'instagram')
    assert.equal(oct7.account_id, 'pg-ig')
    for (const r of [...daily, ...db.tables.social_posts!, ...db.tables.mentions!]) {
      assert.equal(r.collection_method, 'api')
      assert.equal(r.import_batch_id, null)
      assert.equal(r.row_number, null)
      assert.equal(r.source_id, CONN)
      assert.equal(r.tenant_id, T1)
      assert.equal(r.brand_id, B1)
      assert.match(String(r.payload_hash), /^[0-9a-f]{64}$/)
    }

    assert.equal(db.tables.social_posts!.length, 1, 'doar postarea publicată')
    assert.deepEqual(
      (({ post_id, metrics_scope, snapshot_date, impressions, engagements, likes }) => ({ post_id, metrics_scope, snapshot_date, impressions, engagements, likes }))(db.tables.social_posts![0]!),
      { post_id: 'p1', metrics_scope: 'lifetime', snapshot_date: '2026-10-07', impressions: 400, engagements: 30, likes: 25 },
    )
    assert.deepEqual(db.tables.mentions!.map((m) => m.sentiment).sort(), ['negative', 'positive'])

    const analytics = db.tables.sync_runs!.find((r) => r.source === 'planable_analytics')!
    assert.equal(analytics.source_connection_id, CONN)
    assert.deepEqual(analytics.coverage, { social_daily: { expected_days: 35, covered_days: 2, coverage: 0.0571 } })
    assert.equal(analytics.period_end, '2026-10-07')

    assert.ok(f.calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`))
    assert.ok(!f.calls.some((c) => c.url.includes('pg-off/metrics')), 'pagina neconectată nu se interoghează')
    const calls = db.tables.provider_api_calls!
    assert.deepEqual(calls.map((c) => [c.source_connection_id, c.brand_id]), [[CRED, null], [CONN, B1]])
    assert.equal(calls.reduce((s, c) => s + (c.calls as number), 0), f.calls.length, 'fiecare cerere e contorizată')
    assert.deepEqual(validations, [{ p_connection_id: CRED, p_ok: true }])
    assert.ok(!JSON.stringify(db.tables).includes('SECRET-TOKEN'), 'tokenul nu ajunge în baza de date')
  })

  test('sentimentul revizuit de om nu se suprascrie; un rând CSV cu aceeași cheie devine rând API', async () => {
    const reviewedId = mentionNativeId('https://x.com/a/1')
    const { db } = setup({
      tables: {
        mentions: [{ id: 1, tenant_id: T1, brand_id: B1, native_id: reviewedId, sentiment: 'neutral', sentiment_reviewed_by: 'u-om', sentiment_reviewed_at: '2026-10-06T10:00:00Z', collection_method: 'csv', import_batch_id: 'lot-1', row_number: 4 }],
        social_daily: [{ id: 2, tenant_id: T1, brand_id: B1, platform: 'instagram', account_id: 'pg-ig', date: '2026-10-06', followers: 1, collection_method: 'csv', import_batch_id: 'lot-1', row_number: 1 }],
      },
    })
    await collectPlanable({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    const m = db.tables.mentions!.find((r) => r.native_id === reviewedId)!
    assert.equal(m.sentiment, 'neutral', 'corecția umană rămâne')
    assert.equal(m.collection_method, 'api')
    assert.equal(m.import_batch_id, null)
    const d = db.tables.social_daily!.find((r) => r.date === '2026-10-06')!
    assert.equal(d.followers, 5010)
    assert.equal(d.import_batch_id, null)
    assert.equal(d.row_number, null)
  })

  test('401 la /workspaces: tokenul se marchează invalid, ambele rulări eșuează', async () => {
    const { db, validations } = setup()
    const out = await collectPlanable({ db, fetch: routes({ '/api/v1/workspaces': json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401) }).fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => [o.source, o.status, o.errors[0]?.code]), [['planable_analytics', 'failed', 'access_denied'], ['planable_listening', 'failed', 'access_denied']])
    assert.deepEqual(validations.map((v) => v.p_ok), [false])
  })

  test('workspace-ul brandului nu e accesibil tokenului: failed, fără să marcheze tokenul invalid', async () => {
    const { db, validations } = setup({ connections: [{ id: CONN, tenant_id: T1, brand_id: B1, provider: 'planable', external_account_id: 'ws-altul', status: 'active', credential_status: 'missing' }] })
    const out = await collectPlanable({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'workspace_not_found')
    assert.deepEqual(validations.map((v) => v.p_ok), [true])
  })

  test('postare fără metrici (404): notă, nu eroare; metrici de pagină eșuate → parțial', async () => {
    const { db } = setup()
    const out = await collectPlanable({
      db,
      fetch: routes({ '/api/v1/posts/p1/metrics': { status: 404, body: '' }, '/api/v1/pages/pg-ig/metrics': json({ error: { code: 'INTERNAL' } }, 500) }).fetch,
      sleep: noSleep().sleep,
      now: () => NOW,
    })
    const a = out.find((o) => o.source === 'planable_analytics')!
    assert.equal(a.status, 'failed', 'fără niciun rând scris și cu erori → failed')
    assert.ok(a.errors.some((e) => e.code === 'parser_note' && /p1/.test(e.message)))
    assert.ok(a.errors.some((e) => e.code === 'server_error'))
  })

  test('fără cuvinte de tip brand în Listening: listening not_connected, fără sync_run', async () => {
    const { db } = setup()
    const out = await collectPlanable({ db, fetch: routes({ '/api/v1/keywords': json({ data: [] }) }).fetch, sleep: noSleep().sleep, now: () => NOW })
    const l = out.find((o) => o.source === 'planable_listening')!
    assert.equal(l.status, 'not_connected')
    assert.equal(db.tables.sync_runs!.filter((r) => r.source === 'planable_listening').length, 0)
  })

  test('izolare: tokenul unui client nu se folosește pentru brandul altui client', async () => {
    const { db } = setup({
      connections: [
        { id: CONN, tenant_id: T1, brand_id: B1, provider: 'planable', external_account_id: WS, status: 'active', credential_status: 'missing' },
        { id: CONN_T2, tenant_id: T2, brand_id: B2, provider: 'planable', external_account_id: WS, status: 'active', credential_status: 'missing' },
      ],
    })
    const out = await collectPlanable({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    const t2 = out.filter((o) => o.tenant_id === T2)
    assert.ok(t2.every((o) => o.status === 'not_connected'))
    assert.ok(db.tables.social_daily!.every((r) => r.tenant_id === T1))
  })
})
