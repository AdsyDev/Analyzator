import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { advertisersByBrand, collectAdsTransparency } from './collect-core.ts'
import { runQuery, type AuthedRequest } from './bigquery.ts'
import { SCHEMA_SQL, adRow, countOf, creativesSql, formatOf, isoDateOf, regionFields } from './normalize.ts'
import { FakeDb } from '../shared/test-helpers.ts'

// Răspunsurile BigQuery sunt construite după forma documentată a jobs.query (rânduri `f`/`v`, schema cu nume de câmpuri).
// Coloanele setului `creative_stats` sunt NECONFIRMATE pe o rulare reală (vezi docs/contracts/ads-transparency.md).

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000012'
const B3 = '20000000-0000-0000-0000-000000000021'
const SA = '50000000-0000-0000-0000-0000000000d1'
const NOW = new Date('2026-11-24T08:00:00Z') // 10:00 în București; ieri = 2026-11-23
const KEY = '-----BEGIN PRIVATE KEY-----SECRET-----END PRIVATE KEY-----'
const SA_JSON = JSON.stringify({ type: 'service_account', client_email: 'collector@stada-proj.iam.gserviceaccount.com', private_key: KEY, project_id: 'stada-proj' })

const FIELDS = ['advertiser_id', 'advertiser_disclosed_name', 'creative_id', 'ad_format_type', 'creative_page_url', 'region_code', 'region_stats']
const region = (first: string | null, last: string | null, extra: Record<string, unknown> = {}) => JSON.stringify({ region_code: 'RO', first_shown: first, last_shown: last, ...extra })
const bqRow = (adv: string, cr: string, fmt: string, first: string | null, last: string | null, extra: Record<string, unknown> = {}) => ({
  f: [adv, `Advertiser ${adv}`, cr, fmt, `https://adstransparency.google.com/advertiser/${adv}/creative/${cr}?region=RO`, 'RO', region(first, last, extra)].map((v) => ({ v })),
})
const page = (rows: unknown[], o: Record<string, unknown> = {}) => ({ jobComplete: true, jobReference: { projectId: 'stada-proj', jobId: 'job1', location: 'US' }, schema: { fields: FIELDS.map((name) => ({ name, type: 'STRING' })) }, rows, totalBytesBilled: '12000000000', ...o })

const ALL_FIELDS = ['advertiser_id', 'advertiser_disclosed_name', 'creative_id', 'ad_format_type', 'creative_page_url', 'topic', 'region_stats', 'region_stats.region_code',
  'region_stats.first_shown', 'region_stats.last_shown', 'region_stats.times_shown_lower_bound', 'region_stats.times_shown_upper_bound']
const schemaPage = (paths: string[] = ALL_FIELDS) => ({ status: 200, data: { jobComplete: true, jobReference: { projectId: 'stada-proj', jobId: 'schema', location: 'US' },
  schema: { fields: [{ name: 'field_path' }, { name: 'data_type' }] }, rows: paths.map((p) => ({ f: [{ v: p }, { v: 'STRING' }] })), totalBytesBilled: '10485760' } })

function fakeRequest(responses: Array<{ status: number; data: unknown }>) {
  const calls: Array<{ url: string; method: string; data?: unknown }> = []
  const request: AuthedRequest = async (req) => {
    calls.push(req)
    const next = responses.shift()
    if (!next) throw new Error(`cerere neașteptată ${req.url}`)
    return next
  }
  return { request, calls }
}

function setup(o: { credential?: boolean; members?: Array<Record<string, unknown>>; sets?: Array<Record<string, unknown>> } = {}) {
  const db = new FakeDb({
    source_connections: o.credential === false ? [] : [{ id: SA, tenant_id: T1, brand_id: null, provider: 'google_service_account', external_account_id: 'sa', status: 'active', credential_status: 'valid' }],
    competitor_sets: o.sets ?? [
      { id: 's1', tenant_id: T1, brand_id: B1, effective_from: '2026-10-01' },
      { id: 's2', tenant_id: T1, brand_id: B2, effective_from: '2026-10-01' },
    ],
    competitor_set_members: o.members ?? [
      { competitor_set_id: 's1', tenant_id: T1, brand_id: B1, ads_advertiser_ids: ['AR11111', 'AR22222'] },
      { competitor_set_id: 's1', tenant_id: T1, brand_id: B1, ads_advertiser_ids: [] },
      { competitor_set_id: 's2', tenant_id: T1, brand_id: B2, ads_advertiser_ids: ['AR22222'] },
    ],
    sync_runs: [],
    provider_api_calls: [],
    competitor_ads: [],
    competitor_trackers: [],
  })
  db.rpcs.get_source_token = (a) => {
    if (a.p_connection_id !== SA) throw new Error('token cerut pentru altă conexiune')
    return SA_JSON
  }
  return db
}

describe('normalizare', () => {
  test('datele: DATE sau TIMESTAMP serializat; altceva = null', () => {
    assert.equal(isoDateOf('2026-11-02'), '2026-11-02')
    assert.equal(isoDateOf('2026-11-02 00:00:00+00'), '2026-11-02')
    assert.equal(isoDateOf('2026-11-02T10:00:00Z'), '2026-11-02')
    assert.equal(isoDateOf('ieri'), null)
    assert.equal(isoDateOf(null), null)
  })
  test('numărul de afișări: întreg ≥ 0, ca număr sau text; lipsa rămâne null, nu 0', () => {
    assert.equal(countOf(1000), 1000)
    assert.equal(countOf('2000'), 2000)
    assert.equal(countOf(undefined), null)
    assert.equal(countOf(-1), null)
    assert.equal(countOf('1e3'), null)
    assert.deepEqual(regionFields(region('2026-01-01', '2026-02-01', { times_shown_lower_bound: 5000, times_shown_upper_bound: 4000 })), { first_shown: '2026-01-01', last_shown: '2026-02-01', lower: null, upper: null })
    assert.deepEqual(regionFields('nu e json'), { first_shown: null, last_shown: null, lower: null, upper: null })
  })
  test('formatul: text, image, video; restul = unknown', () => {
    assert.equal(formatOf('VIDEO'), 'video')
    assert.equal(formatOf('AUDIO'), 'unknown')
    assert.equal(formatOf(null), 'unknown')
  })
  test('rânduri sărite cu motiv: advertiser, reclamă, interval inversat', () => {
    const p = { tenant_id: T1, brand_id: B1, source_id: SA, sync_run_id: 'r', collected_at: NOW.toISOString() }
    assert.deepEqual(adRow({ advertiser_id: 'X1', creative_id: 'CR1', region_code: 'RO', region_stats: null }, p), { ok: false, reason: 'advertiser_id' })
    assert.deepEqual(adRow({ advertiser_id: 'AR11111', creative_id: '', region_code: 'RO', region_stats: null }, p), { ok: false, reason: 'creative_id' })
    assert.deepEqual(adRow({ advertiser_id: 'AR11111', creative_id: 'CR1', region_code: 'RO', region_stats: region('2026-03-01', '2026-02-01') }, p), { ok: false, reason: 'shown_interval' })
    const ok = adRow({ advertiser_id: 'AR11111', creative_id: 'CR1', region_code: 'RO', region_stats: null, creative_page_url: 'https://evil.test/x' }, p)
    assert.ok(ok.ok)
    assert.equal(ok.row.source_url, null, 'doar linkuri spre adstransparency.google.com')
    assert.equal(ok.row.first_shown, null)
  })
  test('interogarea citește doar coloanele folosite și filtrează pe parametri, nu pe text concatenat', () => {
    const sql = creativesSql(new Set(ALL_FIELDS))
    assert.match(sql, /IN UNNEST\(@advertiser_ids\)/)
    assert.match(sql, /rs\.region_code = @region/)
    assert.match(sql, /cs\.creative_page_url/)
    assert.doesNotMatch(sql, /SELECT \*|cs\.\*|topic/)
    assert.match(SCHEMA_SQL, /INFORMATION_SCHEMA\.COLUMN_FIELD_PATHS/)
  })
  test('o coloană opțională absentă din schemă devine NULL în interogare, nu o eroare', () => {
    const sql = creativesSql(new Set(ALL_FIELDS.filter((f) => f !== 'ad_format_type')))
    assert.match(sql, /CAST\(NULL AS STRING\) AS ad_format_type/)
    assert.doesNotMatch(sql, /cs\.ad_format_type/)
  })
})

describe('advertisersByBrand', () => {
  test('setul în vigoare azi și versiunile viitoare; nu și cele trecute', () => {
    const sets = [
      { id: 'old', tenant_id: T1, brand_id: B1, effective_from: '2026-09-01' },
      { id: 'cur', tenant_id: T1, brand_id: B1, effective_from: '2026-10-01' },
      { id: 'next', tenant_id: T1, brand_id: B1, effective_from: '2026-12-01' },
    ]
    const members = [
      { competitor_set_id: 'old', tenant_id: T1, brand_id: B1, ads_advertiser_ids: ['AR00000'] },
      { competitor_set_id: 'cur', tenant_id: T1, brand_id: B1, ads_advertiser_ids: ['AR11111'] },
      { competitor_set_id: 'next', tenant_id: T1, brand_id: B1, ads_advertiser_ids: ['AR33333', 'invalid'] },
    ]
    assert.deepEqual([...advertisersByBrand(sets, members, '2026-11-23')], [[B1, { tenant_id: T1, ids: ['AR11111', 'AR33333'] }]])
  })
})

describe('runQuery', () => {
  test('parametri numiți, plafon de bytes, locația US; job neterminat → getQueryResults; pagini', async () => {
    const f = fakeRequest([
      { status: 200, data: { jobComplete: false, jobReference: { projectId: 'p-1', jobId: 'j/1', location: 'US' } } },
      { status: 200, data: page([bqRow('AR11111', 'CR1', 'IMAGE', '2026-11-01', '2026-11-20')], { pageToken: 't2' }) },
      { status: 200, data: { rows: [bqRow('AR11111', 'CR2', 'TEXT', '2026-11-02', '2026-11-21')] } },
    ])
    const r = await runQuery(f.request, { project: 'p-1', sql: 'SELECT 1', params: [{ name: 'ids', type: 'ARRAY<STRING>', values: ['AR11111'] }], maxBytesBilled: 5e9 })
    assert.ok(r.ok)
    assert.equal(r.rows.length, 2)
    assert.equal(r.calls, 3)
    const body = f.calls[0]!.data as Record<string, unknown>
    assert.equal(body.maximumBytesBilled, '5000000000')
    assert.equal(body.location, 'US')
    assert.equal(body.useLegacySql, false)
    assert.deepEqual(body.queryParameters, [{ name: 'ids', parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: [{ value: 'AR11111' }] } }])
    assert.match(f.calls[1]!.url, /\/projects\/p-1\/queries\/j%2F1\?/)
    assert.match(f.calls[2]!.url, /pageToken=t2/)
  })
  test('eroare BigQuery: motivul și mesajul din răspuns', async () => {
    const f = fakeRequest([{ status: 400, data: { error: { code: 400, message: 'Query exceeded limit for bytes billed: 100000000000.', errors: [{ reason: 'bytesBilledLimitExceeded' }] } } }])
    const r = await runQuery(f.request, { project: 'p-1', sql: 'SELECT 1', params: [], maxBytesBilled: 1 })
    assert.deepEqual(r.ok ? null : [r.reason, r.status], ['bytesBilledLimitExceeded', 400])
  })
})

describe('collectAdsTransparency', () => {
  test('o interogare per client, scrisă pe fiecare brand doar pentru advertiserii lui; trackerii au și advertiserii fără reclame', async () => {
    const db = setup()
    const f = fakeRequest([schemaPage(), { status: 200, data: page([
      bqRow('AR11111', 'CR1', 'IMAGE', '2026-11-01', '2026-11-20', { times_shown_lower_bound: 1000, times_shown_upper_bound: 2000 }),
      bqRow('AR11111', 'CR2', 'VIDEO', '2025-01-01', '2025-02-01'),
      bqRow('AR11111', 'bad id!', 'TEXT', '2026-11-01', '2026-11-02'),
    ]) }])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    assert.equal(f.calls.length, 2, 'schema și o singură interogare pentru client')
    assert.match((f.calls[0]!.data as { query: string }).query, /COLUMN_FIELD_PATHS/)
    const params = (f.calls[1]!.data as { queryParameters: Array<{ name: string; parameterValue: unknown }> }).queryParameters
    assert.deepEqual(params.find((p) => p.name === 'advertiser_ids')!.parameterValue, { arrayValues: [{ value: 'AR11111' }, { value: 'AR22222' }] })
    assert.match(f.calls[1]!.url, /\/projects\/stada-proj\/queries$/, 'plătește proiectul service account-ului')

    assert.deepEqual(out.map((o) => [o.brand_id, o.status]).sort(), [[B1, 'succeeded'], [B2, 'succeeded']])
    const ads = db.tables.competitor_ads!
    assert.deepEqual(ads.map((a) => [a.brand_id, a.native_ad_id, a.format, a.first_shown, a.last_shown, a.times_shown_lower]).sort(), [
      [B1, 'CR1', 'image', '2026-11-01', '2026-11-20', 1000],
      [B1, 'CR2', 'video', '2025-01-01', '2025-02-01', null],
    ])
    assert.ok(ads.every((a) => a.region_code === 'RO' && a.source === 'google_ads_transparency' && a.source_id === SA && !('first_seen' in a)), 'first_seen nu se suprascrie la upsert')
    const t = db.tables.competitor_trackers!
    assert.deepEqual(t.map((r) => [r.brand_id, r.external_id, r.covered_to, r.covered_from, r.complete]).sort(), [
      [B1, 'AR11111', '2026-11-23', null, true],
      [B1, 'AR22222', '2026-11-23', null, true],
      [B2, 'AR22222', '2026-11-23', null, true],
    ], 'AR22222 fără reclame e totuși interogat: zero real')
    const b1 = out.find((o) => o.brand_id === B1)!
    assert.ok(b1.errors.some((e) => e.dimension === 'ads_skipped' && /1 reclamă sărită/.test(e.message)))
    assert.ok(b1.errors.some((e) => e.dimension === 'bytes_billed' && /12\.00 GB/.test(e.message)))
    assert.equal(db.tables.sync_runs!.filter((r) => r.source === 'ads_transparency').length, 2)
    assert.deepEqual(db.tables.provider_api_calls!.map((c) => [c.brand_id, c.calls]), [[null, 2]])
    assert.ok(!b1.errors.some((e) => e.dimension === 'schema'), 'toate câmpurile există: fără notă de schemă')
    assert.ok(!JSON.stringify(db.tables).includes('SECRET'), 'cheia privată nu ajunge în baza de date')
  })

  test('plafonul de bytes depășit: toate rulările clientului eșuează, cu indicația plafonului', async () => {
    const db = setup()
    const f = fakeRequest([schemaPage(), { status: 400, data: { error: { message: 'Query exceeded limit for bytes billed', errors: [{ reason: 'bytesBilledLimitExceeded' }] } } }])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: { ADS_TRANSPARENCY_MAX_GB: '20' } })
    assert.deepEqual(out.map((o) => o.status), ['failed', 'failed'])
    assert.match(out[0]!.errors[0]!.message, /Plafonul e 20 GB/)
    assert.equal((f.calls[1]!.data as { maximumBytesBilled: string }).maximumBytesBilled, '20000000000')
    assert.equal(db.tables.competitor_trackers!.length, 0, 'fără trackeri: nimic nu pare colectat')
  })

  test('fără service account: not_connected, fără sync_run și fără cereri', async () => {
    const db = setup({ credential: false })
    const f = fakeRequest([])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    assert.deepEqual(out.map((o) => o.status), ['not_connected', 'not_connected'])
    assert.equal(db.tables.sync_runs!.length, 0)
    assert.equal(f.calls.length, 0)
  })

  test('izolare: advertiserii altui client nu intră în interogarea acestui client', async () => {
    const db = setup({
      sets: [
        { id: 's1', tenant_id: T1, brand_id: B1, effective_from: '2026-10-01' },
        { id: 's3', tenant_id: T2, brand_id: B3, effective_from: '2026-10-01' },
      ],
      members: [
        { competitor_set_id: 's1', tenant_id: T1, brand_id: B1, ads_advertiser_ids: ['AR11111'] },
        { competitor_set_id: 's3', tenant_id: T2, brand_id: B3, ads_advertiser_ids: ['AR99999'] },
      ],
    })
    const f = fakeRequest([schemaPage(), { status: 200, data: page([bqRow('AR99999', 'CR9', 'TEXT', '2026-11-01', '2026-11-02')]) }])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    const params = (f.calls[1]!.data as { queryParameters: Array<{ name: string; parameterValue: unknown }> }).queryParameters
    assert.deepEqual(params.find((p) => p.name === 'advertiser_ids')!.parameterValue, { arrayValues: [{ value: 'AR11111' }] })
    assert.equal(db.tables.competitor_ads!.length, 0, 'un rând al altui advertiser din răspuns nu se scrie')
    assert.deepEqual(out.map((o) => [o.tenant_id, o.status]).sort(), [[T1, 'succeeded'], [T2, 'not_connected']])
  })

  test('rezultat trunchiat: rulare parțială, trackeri marcați incompleți', async () => {
    const db = setup()
    const f = fakeRequest([
      schemaPage(),
      { status: 200, data: page([bqRow('AR11111', 'CR1', 'IMAGE', '2026-11-01', '2026-11-20')], { pageToken: 'more' }) },
      ...Array.from({ length: 19 }, () => ({ status: 200, data: { rows: [], pageToken: 'more' } })),
    ])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    assert.deepEqual(out.map((o) => o.status), ['partial', 'partial'])
    assert.ok(db.tables.competitor_trackers!.every((t) => t.complete === false))
  })

  test('un câmp obligatoriu lipsă din schemă: toate rulările eșuează cu lista câmpurilor găsite, fără interogarea mare', async () => {
    const db = setup()
    const f = fakeRequest([schemaPage(ALL_FIELDS.filter((x) => x !== 'creative_id'))])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    assert.deepEqual(out.map((o) => [o.status, o.errors[0]!.code]), [['failed', 'schema_changed'], ['failed', 'schema_changed']])
    assert.match(out[0]!.errors[0]!.message, /nu are câmpurile creative_id\. Câmpuri găsite: .*advertiser_id/)
    assert.equal(f.calls.length, 1)
  })

  test('câmpuri opționale absente: interogarea merge, valorile rămân NULL, iar rularea notează câmpurile lipsă', async () => {
    const db = setup()
    const f = fakeRequest([
      schemaPage(ALL_FIELDS.filter((x) => x !== 'creative_page_url' && x !== 'region_stats.times_shown_upper_bound')),
      { status: 200, data: page([{ f: ['AR11111', 'Advertiser AR11111', 'CR1', 'IMAGE', null, 'RO', region('2026-11-01', '2026-11-20')].map((v) => ({ v })) }]) },
    ])
    const out = await collectAdsTransparency({ db, request: () => f.request, now: () => NOW, env: {} })
    assert.match((f.calls[1]!.data as { query: string }).query, /CAST\(NULL AS STRING\) AS creative_page_url/)
    assert.equal(db.tables.competitor_ads![0]!.source_url, null)
    const note = out[0]!.errors.find((e) => e.dimension === 'schema')!
    assert.match(note.message, /creative_page_url, region_stats\.times_shown_upper_bound/)
    assert.equal(out[0]!.status, 'succeeded', 'o notă nu schimbă statusul')
  })
})
