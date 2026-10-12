import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectMeta } from './collect-core.ts'
import { classify, MetaClient } from './client.ts'
import { accountNumber } from './normalize.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

// Răspunsuri construite după documentația Marketing API (Ad Account, Insights, Handling errors), derivate, neconfirmate.

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000012'
const CRED = '50000000-0000-0000-0000-0000000000d1'
const CONN = '50000000-0000-0000-0000-0000000000d2'
const CONN2 = '50000000-0000-0000-0000-0000000000d3'
const NOW = new Date('2026-10-08T07:00:00Z')
const TOKEN = 'EAAG-SECRET-SYSTEM-USER-TOKEN'
const json = (body: unknown, status = 200): FakeResponse => ({ status, body: JSON.stringify(body) })
const row = (date: string, ad: string, o: Record<string, unknown> = {}) => ({
  date_start: date, date_stop: date, account_id: '111', account_name: 'Urinal RO', campaign_id: 'c1', campaign_name: 'Toamna', adset_id: 's1', adset_name: '25-44',
  ad_id: ad, ad_name: `Ad ${ad}`, spend: '12.50', impressions: '1000', clicks: '40', account_currency: 'RON', ...o,
})

function routes(over: Record<string, FakeResponse | ((u: URL) => FakeResponse)> = {}) {
  const base: Record<string, FakeResponse | ((u: URL) => FakeResponse)> = {
    '/v26.0/act_111': json({ id: 'act_111', name: 'Urinal RO', currency: 'RON', timezone_name: 'Europe/Bucharest' }),
    '/v26.0/act_111/insights': (u) =>
      u.searchParams.get('after') === 'p2'
        ? json({ data: [row('2026-10-07', 'a1')], paging: {} })
        : json({ data: [row('2026-10-06', 'a1'), row('2026-10-06', 'a2', { impressions: undefined })], paging: { cursors: { after: 'p2' }, next: `https://graph.facebook.com/v26.0/act_111/insights?access_token=${TOKEN}&after=p2` } }),
  }
  const table = { ...base, ...over }
  return fakeFetch((raw) => {
    const u = new URL(raw)
    const r = table[u.pathname]
    if (!r) throw new Error(`rută neașteptată ${u.pathname}`)
    return typeof r === 'function' ? r(u) : r
  })
}

function setup(o: { credential?: string | null; connections?: Array<Record<string, unknown>>; paid?: Array<Record<string, unknown>> } = {}) {
  const cred = o.credential === undefined ? 'unverified' : o.credential
  const db = new FakeDb({
    source_connections: [
      ...(cred ? [{ id: CRED, tenant_id: T1, brand_id: null, provider: 'meta_account', external_account_id: 'BM agenție', status: 'active', credential_status: cred }] : []),
      ...(o.connections ?? [{ id: CONN, tenant_id: T1, brand_id: B1, provider: 'meta_ads', external_account_id: 'act_111', status: 'active', credential_status: 'missing' }]),
    ],
    sync_runs: [], provider_api_calls: [], paid_daily: o.paid ?? [],
  })
  const validations: Array<Record<string, unknown>> = []
  db.rpcs.get_source_token = () => TOKEN
  db.rpcs.record_source_validation = (a) => void validations.push(a)
  return { db, validations }
}

describe('Meta: utilitare', () => {
  test('ID-ul contului acceptă act_123 sau 123', () => {
    assert.equal(accountNumber('act_111'), '111')
    assert.equal(accountNumber(' 111 '), '111')
    assert.equal(accountNumber('act_x'), null)
  })
  test('erorile Graph se clasifică după cod, nu doar după HTTP', () => {
    assert.equal(classify(400, 190), 'access_denied')
    assert.equal(classify(400, 17), 'rate_limited')
    assert.equal(classify(400, 200), 'permission_denied')
    assert.equal(classify(500, null), 'server_error')
    assert.equal(classify(400, 100), 'bad_request')
  })
  test('paging.next nu poartă tokenul mai departe', () => {
    assert.ok(!MetaClient.cleanNext(`https://graph.facebook.com/v26.0/x?access_token=${TOKEN}&after=p2`).includes(TOKEN))
  })
})

describe('collectMeta', () => {
  test('fără token al clientului: not_connected, fără sync_run și fără cereri', async () => {
    const { db } = setup({ credential: null })
    const f = routes()
    const out = await collectMeta({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => o.status), ['not_connected'])
    assert.equal(f.calls.length, 0)
    assert.equal(db.tables.sync_runs!.length, 0)
  })

  test('rulare completă: paginare, moneda contului, NULL pentru lipsă, proveniență API', async () => {
    const { db, validations } = setup()
    const f = routes()
    const out = await collectMeta({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'succeeded')
    const rows = db.tables.paid_daily!
    assert.equal(rows.length, 3)
    const a2 = rows.find((r) => r.ad_id === 'a2')!
    assert.equal(a2.impressions, null, 'afișări lipsă → NULL, nu 0')
    assert.equal(a2.spend, 12.5)
    for (const r of rows) {
      assert.equal(r.source, 'meta_ads')
      assert.equal(r.currency, 'RON')
      assert.equal(r.account_id, '111')
      assert.equal(r.ad_group_id, 's1')
      assert.equal(r.conversions, null)
      assert.equal(r.click_type, 'all')
      assert.equal(r.collection_method, 'api')
      assert.equal(r.import_batch_id, null)
      assert.equal(r.source_id, CONN)
      assert.equal(r.source_timezone, 'Europe/Bucharest')
    }
    const insights = f.calls.find((c) => c.url.includes('/insights'))!
    const u = new URL(insights.url)
    assert.equal(u.searchParams.get('level'), 'ad')
    assert.equal(u.searchParams.get('time_increment'), '1')
    assert.deepEqual(JSON.parse(u.searchParams.get('time_range')!), { since: '2026-09-03', until: '2026-10-07' })
    assert.ok(f.calls.every((c) => !c.url.includes(TOKEN)), 'tokenul nu apare în URL-uri')
    assert.ok(f.calls.every((c) => (c.init?.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`))
    assert.equal(db.tables.provider_api_calls![0]!.calls, f.calls.length)
    assert.deepEqual(validations.map((v) => v.p_ok), [true])
    assert.ok(!JSON.stringify(db.tables).includes('SECRET'))
  })

  test('rerulare idempotentă; un rând CSV cu aceeași cheie devine rând API', async () => {
    const { db } = setup({
      paid: [{ id: 9, tenant_id: T1, brand_id: B1, source: 'meta_ads', account_id: '111', campaign_id: 'c1', ad_group_id: 's1', ad_id: 'a1', date: '2026-10-06', breakdown_signature: 'none', attribution_config: 'unspecified', spend: 1, currency: 'RON', collection_method: 'csv', import_batch_id: 'lot', row_number: 2 }],
    })
    await collectMeta({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    await collectMeta({ db, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(db.tables.paid_daily!.length, 3)
    const r = db.tables.paid_daily!.find((x) => x.id === 9)!
    assert.equal(r.spend, 12.5)
    assert.equal(r.import_batch_id, null)
    assert.equal(r.row_number, null)
  })

  test('token expirat (400, cod 190): tokenul se marchează refuzat, celelalte conturi nu mai fac cereri', async () => {
    const { db, validations } = setup({
      connections: [
        { id: CONN, tenant_id: T1, brand_id: B1, provider: 'meta_ads', external_account_id: 'act_111', status: 'active', credential_status: 'missing' },
        { id: CONN2, tenant_id: T1, brand_id: B2, provider: 'meta_ads', external_account_id: 'act_222', status: 'active', credential_status: 'missing' },
      ],
    })
    const f = routes({ '/v26.0/act_111': json({ error: { message: 'Session has expired', type: 'OAuthException', code: 190 } }, 400) })
    const out = await collectMeta({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => [o.brand_id, o.status]), [[B1, 'failed'], [B2, 'not_connected']])
    assert.equal(out[0]!.errors[0]!.code, 'access_denied')
    assert.equal(f.calls.length, 1)
    assert.deepEqual(validations.map((v) => v.p_ok), [false])
  })

  test('cont fără permisiune (cod 200): eșuează doar brandul acela, tokenul rămâne valid', async () => {
    const { db, validations } = setup({
      connections: [
        { id: CONN2, tenant_id: T1, brand_id: B2, provider: 'meta_ads', external_account_id: 'act_222', status: 'active', credential_status: 'missing' },
        { id: CONN, tenant_id: T1, brand_id: B1, provider: 'meta_ads', external_account_id: 'act_111', status: 'active', credential_status: 'missing' },
      ],
    })
    const f = routes({ '/v26.0/act_222': json({ error: { message: 'Permissions error', code: 200 } }, 403) })
    const out = await collectMeta({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.deepEqual(out.map((o) => [o.brand_id, o.status]), [[B2, 'failed'], [B1, 'succeeded']])
    assert.equal(out[0]!.errors[0]!.code, 'permission_denied')
    assert.deepEqual(validations.map((v) => v.p_ok), [true])
  })

  test('limitare (cod 17): retry cu așteptare, apoi succes', async () => {
    const { db } = setup()
    let first = true
    const sleep = noSleep()
    const f = routes({
      '/v26.0/act_111': () => {
        if (first) {
          first = false
          return json({ error: { message: 'User request limit reached', code: 17 } }, 400)
        }
        return json({ id: 'act_111', name: 'Urinal RO', currency: 'RON', timezone_name: 'Europe/Bucharest' })
      },
    })
    const out = await collectMeta({ db, fetch: f.fetch, sleep: sleep.sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'succeeded')
    assert.ok(sleep.delays.includes(10_000))
  })

  test('ID de cont invalid: failed, fără cereri la Meta', async () => {
    const { db } = setup({ connections: [{ id: CONN, tenant_id: T1, brand_id: B1, provider: 'meta_ads', external_account_id: 'Urinal', status: 'active', credential_status: 'missing' }] })
    const f = routes()
    const out = await collectMeta({ db, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'invalid_account_id')
    assert.equal(f.calls.length, 0)
  })
})
