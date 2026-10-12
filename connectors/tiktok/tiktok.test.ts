import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectTikTok, type TikTokEnv } from './collect-core.ts'
import { classify } from './client.ts'
import { advertiserId, chunks } from './normalize.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

// Răspunsuri construite după SDK-ul oficial și documentația Business API v1.3, derivate, neconfirmate.

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const CRED = '50000000-0000-0000-0000-0000000000a7'
const CONN = '50000000-0000-0000-0000-0000000000a8'
const NOW = new Date('2026-10-08T07:00:00Z')
const ENV: TikTokEnv = { app: { appId: 'app', secret: 'APP-SECRET' } }
const ok = (data: unknown): FakeResponse => ({ status: 200, body: JSON.stringify({ code: 0, message: 'OK', data }) })
const fail = (code: number, status = 200): FakeResponse => ({ status, body: JSON.stringify({ code, message: 'x', data: {} }) })
const row = (day: string, campaign: string, o: Record<string, unknown> = {}) => ({ dimensions: { campaign_id: campaign, stat_time_day: `${day} 00:00:00` }, metrics: { spend: '20.00', impressions: '900', clicks: '30', conversion: '2', campaign_name: `C ${campaign}`, ...o } })

function routes(over: Record<string, FakeResponse | ((u: URL) => FakeResponse)> = {}) {
  const base: Record<string, FakeResponse | ((u: URL) => FakeResponse)> = {
    '/open_api/v1.3/oauth2/refresh_token/': ok({ access_token: 'NEW-ACCESS', refresh_token: 'NEW-REFRESH', access_token_expire_in: 86400 }),
    '/open_api/v1.3/advertiser/info/': ok({ list: [{ advertiser_id: '7001234567890123456', name: 'Urinal TT', currency: 'RON', timezone: 'Europe/Bucharest' }] }),
    '/open_api/v1.3/report/integrated/get/': (u) =>
      u.searchParams.get('start_date') === '2026-09-03'
        ? ok({ list: [row('2026-09-03', '11'), row('2026-09-04', '11', { impressions: null })], page_info: { page: 1, page_size: 1000, total_number: 2, total_page: 1 } })
        : ok({ list: [row('2026-10-06', '11')], page_info: { page: 1, page_size: 1000, total_number: 1, total_page: 1 } }),
  }
  const table = { ...base, ...over }
  return fakeFetch((raw) => {
    const u = new URL(raw)
    const r = table[u.pathname]
    if (!r) throw new Error(`rută neașteptată ${u.pathname}`)
    return typeof r === 'function' ? r(u) : r
  })
}

function setup(o: { token?: Record<string, unknown> | string; credential?: string | null } = {}) {
  const cred = o.credential === undefined ? 'valid' : o.credential
  const db = new FakeDb({
    source_connections: [
      ...(cred ? [{ id: CRED, tenant_id: T1, brand_id: null, provider: 'tiktok_account', external_account_id: 'TikTok Business (1 conturi)', status: 'active', credential_status: cred }] : []),
      { id: CONN, tenant_id: T1, brand_id: B1, provider: 'tiktok_ads', external_account_id: '7001234567890123456', status: 'active', credential_status: 'missing' },
    ],
    sync_runs: [], provider_api_calls: [], paid_daily: [],
  })
  const rotated: string[] = []
  const validations: Array<Record<string, unknown>> = []
  const token = o.token ?? { access_token: 'OLD-ACCESS', refresh_token: 'OLD-REFRESH', advertiser_ids: ['7001234567890123456'] }
  db.rpcs.get_source_token = () => (typeof token === 'string' ? token : JSON.stringify(token))
  db.rpcs.rotate_source_token = (a) => {
    rotated.push(String(a.p_token))
    return 'valid'
  }
  db.rpcs.record_source_validation = (a) => void validations.push(a)
  return { db, rotated, validations }
}

describe('TikTok: utilitare', () => {
  test('fereastra de 35 de zile în bucăți de cel mult 30', () => {
    assert.deepEqual(chunks('2026-09-03', '2026-10-07', 30), [{ start: '2026-09-03', end: '2026-10-02' }, { start: '2026-10-03', end: '2026-10-07' }])
  })
  test('advertiser ID: doar cifre', () => {
    assert.equal(advertiserId(' 7001234567890123456 '), '7001234567890123456')
    assert.equal(advertiserId('abc'), null)
  })
  test('codurile din corp: token, permisiuni, limite', () => {
    assert.equal(classify(200, 40105), 'access_denied')
    assert.equal(classify(200, 40002), 'permission_denied')
    assert.equal(classify(200, 40100), 'rate_limited')
    assert.equal(classify(200, 51000), 'server_error')
  })
})

describe('collectTikTok', () => {
  test('fără secretele aplicației: not_connected, fără cereri', async () => {
    const { db } = setup()
    const f = routes()
    const out = await collectTikTok({ db, env: {}, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.match(out[0]!.reason!, /TIKTOK_APP_ID/)
    assert.equal(f.calls.length, 0)
  })

  test('rulare completă: tokenul se reînnoiește și se salvează, raport în bucăți, NULL pentru lipsă', async () => {
    const { db, rotated } = setup()
    const f = routes()
    const out = await collectTikTok({ db, env: ENV, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'succeeded')
    assert.equal(rotated.length, 1)
    const saved = JSON.parse(rotated[0]!)
    assert.equal(saved.access_token, 'NEW-ACCESS')
    assert.equal(saved.refresh_token, 'NEW-REFRESH')
    assert.deepEqual(saved.advertiser_ids, ['7001234567890123456'])
    const reports = f.calls.filter((c) => c.url.includes('/report/integrated/get/'))
    assert.equal(reports.length, 2)
    assert.ok(reports.every((c) => (c.init?.headers as Record<string, string>)['Access-Token'] === 'NEW-ACCESS'))
    const rows = db.tables.paid_daily!
    assert.equal(rows.length, 3)
    assert.equal(rows.find((r) => r.date === '2026-09-04')!.impressions, null)
    for (const r of rows) {
      assert.equal(r.source, 'tiktok_ads')
      assert.equal(r.currency, 'RON')
      assert.equal(r.conversions, 2)
      assert.equal(r.spend, 20)
      assert.equal(r.collection_method, 'api')
      assert.equal(r.import_batch_id, null)
    }
    assert.ok(!JSON.stringify(db.tables).includes('ACCESS') && !JSON.stringify(db.tables).includes('APP-SECRET'))
  })

  test('reînnoire refuzată (token revocat): credențialul se marchează refuzat, brandul not_connected', async () => {
    const { db, validations } = setup()
    const out = await collectTikTok({ db, env: ENV, fetch: routes({ '/open_api/v1.3/oauth2/refresh_token/': fail(40105) }).fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'not_connected')
    assert.match(out[0]!.reason!, /Reconectează/)
    assert.deepEqual(validations.map((v) => v.p_ok), [false])
  })

  test('advertiser neautorizat (cod 40002 în corp, HTTP 200): failed', async () => {
    const { db } = setup()
    const out = await collectTikTok({ db, env: ENV, fetch: routes({ '/open_api/v1.3/advertiser/info/': fail(40002) }).fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'permission_denied')
  })

  test('limitare (40100) apoi succes: retry cu așteptare', async () => {
    const { db } = setup()
    let first = true
    const sleep = noSleep()
    const out = await collectTikTok({
      db, env: ENV, sleep: sleep.sleep, now: () => NOW,
      fetch: routes({ '/open_api/v1.3/advertiser/info/': () => (first ? ((first = false), fail(40100)) : ok({ list: [{ advertiser_id: '7001234567890123456', currency: 'RON', timezone: 'Europe/Bucharest' }] })) }).fetch,
    })
    assert.equal(out[0]!.status, 'succeeded')
    assert.ok(sleep.delays.includes(10_000))
  })

  test('token fără refresh: se folosește direct, fără rotire', async () => {
    const { db, rotated } = setup({ token: { access_token: 'LONG-LIVED' } })
    const f = routes()
    await collectTikTok({ db, env: ENV, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(rotated.length, 0)
    assert.ok(!f.calls.some((c) => c.url.includes('refresh_token')))
  })
})
