import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectGoogleAds, type GoogleAdsEnv } from './collect-core.ts'
import { adsErrorCode } from './client.ts'
import { campaignQuery } from './config.ts'
import { customerId } from './normalize.ts'
import { FakeDb, fakeFetch, noSleep, type FakeResponse } from '../shared/test-helpers.ts'

// Răspunsuri construite după documentația Google Ads API (REST, googleAds:search, GoogleAdsFailure), derivate, neconfirmate.

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const CRED = '50000000-0000-0000-0000-0000000000e1'
const CONN = '50000000-0000-0000-0000-0000000000e2'
const NOW = new Date('2026-10-08T07:00:00Z')
const REFRESH = 'REFRESH-SECRET-DO-NOT-LOG'
const ENV: GoogleAdsEnv = { oauth: { clientId: 'cid', clientSecret: 'CLIENT-SECRET' }, developerToken: 'DEV-TOKEN' }
const json = (body: unknown, status = 200): FakeResponse => ({ status, body: JSON.stringify(body) })

function routes(over: { token?: FakeResponse; customer?: FakeResponse; pages?: FakeResponse[] } = {}) {
  const pages = over.pages ?? [
    json({ results: [
      { segments: { date: '2026-10-06' }, campaign: { id: '111', name: 'Search Brand' }, metrics: { costMicros: '12500000', impressions: '1000', clicks: '40', conversions: 3.5 } },
      { segments: { date: '2026-10-06' }, campaign: { id: '222', name: 'PMax' }, metrics: { costMicros: '5000000', impressions: '300' } },
    ], nextPageToken: 'pg2' }),
    json({ results: [{ segments: { date: '2026-10-07' }, campaign: { id: '111', name: 'Search Brand' }, metrics: { costMicros: '1000000', impressions: '50', clicks: '2', conversions: 0.5 } }] }),
  ]
  let page = 0
  return fakeFetch((url, i) => {
    if (url === 'https://oauth2.googleapis.com/token') return over.token ?? json({ access_token: 'ACCESS', expires_in: 3599 })
    if (url === 'https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search') {
      return i === 1 ? (over.customer ?? json({ results: [{ customer: { id: '1234567890', descriptiveName: 'Urinal RO', currencyCode: 'RON', timeZone: 'Europe/Bucharest' } }] })) : pages[page++]!
    }
    throw new Error(`rută neașteptată ${url}`)
  })
}

function setup(o: { credential?: string | null; token?: string; external?: string } = {}) {
  const cred = o.credential === undefined ? 'valid' : o.credential
  const db = new FakeDb({
    source_connections: [
      ...(cred ? [{ id: CRED, tenant_id: T1, brand_id: null, provider: 'google_ads_account', external_account_id: '9998887777', status: 'active', credential_status: cred }] : []),
      { id: CONN, tenant_id: T1, brand_id: B1, provider: 'google_ads', external_account_id: o.external ?? '123-456-7890', status: 'active', credential_status: 'missing' },
    ],
    sync_runs: [], provider_api_calls: [], paid_daily: [],
  })
  const validations: Array<Record<string, unknown>> = []
  db.rpcs.get_source_token = () => o.token ?? JSON.stringify({ refresh_token: REFRESH, login_customer_id: '9998887777' })
  db.rpcs.record_source_validation = (a) => void validations.push(a)
  return { db, validations }
}

describe('Google Ads: utilitare', () => {
  test('customer ID cu sau fără cratime', () => {
    assert.equal(customerId('123-456-7890'), '1234567890')
    assert.equal(customerId('123'), null)
  })
  test('interogarea refuză un interval care nu e dată (fără injecție GAQL)', () => {
    assert.throws(() => campaignQuery("2026-01-01' OR 1=1 --", '2026-01-02'))
    assert.match(campaignQuery('2026-09-03', '2026-10-07'), /FROM campaign WHERE segments\.date BETWEEN '2026-09-03' AND '2026-10-07'$/)
  })
  test('codul de eroare Google Ads din detalii', () => {
    assert.equal(adsErrorCode({ error: { details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' } }] }] } }), 'DEVELOPER_TOKEN_NOT_APPROVED')
  })
})

describe('collectGoogleAds', () => {
  test('fără secretele aplicației în mediul workerului: not_connected cu motivul, fără cereri', async () => {
    const { db } = setup()
    const f = routes()
    const out = await collectGoogleAds({ db, env: { oauth: ENV.oauth }, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'not_connected')
    assert.match(out[0]!.reason!, /GOOGLE_ADS_DEVELOPER_TOKEN/)
    assert.equal(f.calls.length, 0)
  })

  test('cont neconectat: not_connected, fără cereri', async () => {
    const { db } = setup({ credential: null })
    const f = routes()
    const out = await collectGoogleAds({ db, env: ENV, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'not_connected')
    assert.equal(f.calls.length, 0)
  })

  test('rulare completă: antete, paginare, cost din micro, PMax inclus, proveniență API', async () => {
    const { db } = setup()
    const f = routes()
    const out = await collectGoogleAds({ db, env: ENV, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'succeeded')
    const rows = db.tables.paid_daily!
    assert.equal(rows.length, 3)
    const search = rows.find((r) => r.campaign_id === '111' && r.date === '2026-10-06')!
    assert.equal(search.spend, 12.5)
    assert.equal(search.conversions, 3.5)
    const pmax = rows.find((r) => r.campaign_id === '222')!
    assert.equal(pmax.clicks, 0, 'câmp cerut, absent din rând → 0 (proto3)')
    assert.equal(pmax.conversions, 0)
    for (const r of rows) {
      assert.equal(r.source, 'google_ads')
      assert.equal(r.account_id, '1234567890')
      assert.equal(r.ad_group_id, '')
      assert.equal(r.currency, 'RON')
      assert.equal(r.collection_method, 'api')
      assert.equal(r.import_batch_id, null)
      assert.equal(r.source_id, CONN)
    }
    const ads = f.calls.filter((c) => c.url.includes('googleAds:search'))
    const h = ads[0]!.init!.headers as Record<string, string>
    assert.equal(h.Authorization, 'Bearer ACCESS')
    assert.equal(h['developer-token'], 'DEV-TOKEN')
    assert.equal(h['login-customer-id'], '9998887777')
    assert.equal(JSON.parse(String(ads[2]!.init!.body)).pageToken, 'pg2')
    const notes = db.tables.sync_runs![0]!.errors as Array<{ code: string; message: string }>
    assert.ok(notes.some((n) => n.code === 'parser_note' && /clicks absent/.test(n.message)))
    assert.ok(!JSON.stringify(db.tables).includes('REFRESH-SECRET') && !JSON.stringify(db.tables).includes('CLIENT-SECRET'))
    assert.equal(db.tables.provider_api_calls![0]!.calls, 3, 'cererile Ads (fără schimbul de token) sunt contorizate')
  })

  test('refresh token revocat (invalid_grant): credențialul se marchează refuzat, brandurile not_connected', async () => {
    const { db, validations } = setup()
    const out = await collectGoogleAds({ db, env: ENV, fetch: routes({ token: json({ error: 'invalid_grant' }, 400) }).fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'not_connected')
    assert.match(out[0]!.reason!, /Reconectează/)
    assert.deepEqual(validations, [{ p_connection_id: CRED, p_ok: false, p_error: 'invalid_grant' }])
  })

  test('developer token neaprobat (403): failed cu codul Google Ads în mesaj', async () => {
    const { db } = setup()
    const denied = json({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' } }] }] } }, 403)
    const out = await collectGoogleAds({ db, env: ENV, fetch: routes({ customer: denied }).fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'permission_denied')
    assert.match(out[0]!.errors[0]!.message, /DEVELOPER_TOKEN_NOT_APPROVED/)
  })

  test('credențial stocat în altă formă: not_connected cu cerere de reconectare', async () => {
    const { db } = setup({ token: 'nu-e-json' })
    const out = await collectGoogleAds({ db, env: ENV, fetch: routes().fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.match(out[0]!.reason!, /reconectează/)
  })

  test('customer ID invalid: failed, fără cereri la Google Ads', async () => {
    const { db } = setup({ external: 'Urinal' })
    const f = routes()
    const out = await collectGoogleAds({ db, env: ENV, fetch: f.fetch, sleep: noSleep().sleep, now: () => NOW })
    assert.equal(out[0]!.errors[0]!.code, 'invalid_account_id')
    assert.ok(!f.calls.some((c) => c.url.includes('googleAds:search')))
  })
})
