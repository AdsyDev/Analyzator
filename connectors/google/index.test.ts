import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { candidateUrls, collectIndex, inspectionRow, urlInProperty, INDEX_MAX_URLS, INDEX_SOURCE, INDEX_TOP_PAGES, UrlInspectionSchema } from './index-core.ts'
import type { UrlInspectionClient, UrlInspectionRequest } from './clients.ts'
import { FakeDb } from '../shared/test-helpers.ts'

// Răspunsurile sunt construite după documentația publică urlInspection.index.inspect: derivate din documentație,
// neconfirmate pe un cont real.

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const CRED = '50000000-0000-0000-0000-0000000000a1'
const GSC = '50000000-0000-0000-0000-0000000000a3'
const GSC_T2 = '50000000-0000-0000-0000-0000000000b3'
const NOW = new Date('2026-11-11T07:00:00Z') // 09:00 în București
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'reader@proj.iam.gserviceaccount.com', private_key: 'PRIVATE-KEY-DO-NOT-LOG' })
const md5 = (v: string) => createHash('md5').update(v).digest('hex')

const result = (o: Record<string, unknown> = {}) => ({
  inspectionResult: {
    inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=x',
    indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', pageFetchState: 'SUCCESSFUL', crawledAs: 'MOBILE', lastCrawlTime: '2026-11-09T04:12:33Z', googleCanonical: 'https://site.test/a', userCanonical: 'https://site.test/a', ...o },
  },
})
const page = (p: string, clicks: number | null, date = '2026-11-05', brand = B1, tenant = T1, impressions: number | null = null) => ({ tenant_id: tenant, brand_id: brand, date, device: 'MOBILE', query: 'q', page: p, clicks, impressions })

function setup(o: { priority?: string[]; pages?: Array<Record<string, unknown>>; respond?: (req: UrlInspectionRequest, n: number) => unknown; credential?: boolean; site?: string; tables?: Record<string, Array<Record<string, unknown>>> } = {}) {
  const db = new FakeDb({
    source_connections: [
      ...(o.credential === false ? [] : [{ id: CRED, tenant_id: T1, brand_id: null, provider: 'google_service_account', external_account_id: 'sa', status: 'active', credential_status: 'valid' }]),
      { id: GSC, tenant_id: T1, brand_id: B1, provider: 'gsc', external_account_id: o.site ?? 'sc-domain:site.test', status: 'active', credential_status: 'missing' },
    ],
    index_urls: (o.priority ?? []).map((url) => ({ tenant_id: T1, brand_id: B1, url, url_md5: md5(url) })),
    search_queries: o.pages ?? [],
    index_inspections: [],
    sync_runs: [],
    provider_api_calls: [],
    ...o.tables,
  })
  db.rpcs.get_source_token = (a) => {
    if (a.p_connection_id !== CRED) throw new Error('token cerut pentru altă conexiune')
    return SERVICE_ACCOUNT
  }
  const requests: UrlInspectionRequest[] = []
  const client: UrlInspectionClient = {
    async inspect(req) {
      requests.push(req)
      const r = (o.respond ?? (() => result()))(req, requests.length)
      if (r instanceof Error) throw r
      return r
    },
  }
  const delays: number[] = []
  const deps = { db, createInspection: () => client, now: () => NOW, sleep: async (ms: number) => void delays.push(ms) }
  return { db, deps, requests, delays }
}
const httpError = (status: number, message = 'refuzat') => Object.assign(new Error(message), { response: { status } })

describe('urlInProperty', () => {
  test('sc-domain acoperă domeniul și subdomeniile, nu domenii care doar se termină la fel', () => {
    assert.equal(urlInProperty('https://site.test/a', 'sc-domain:site.test'), true)
    assert.equal(urlInProperty('http://www.site.test/a?x=1', 'sc-domain:site.test'), true)
    assert.equal(urlInProperty('https://altsite.test/a', 'sc-domain:site.test'), false)
    assert.equal(urlInProperty('https://site.test.evil.example/a', 'sc-domain:site.test'), false)
  })
  test('proprietate URL-prefix: doar adresele de sub ea', () => {
    assert.equal(urlInProperty('https://www.site.test/blog/a', 'https://www.site.test/'), true)
    assert.equal(urlInProperty('http://www.site.test/blog/a', 'https://www.site.test/'), false)
    assert.equal(urlInProperty('nu-e-url', 'https://www.site.test/'), false)
  })
})

describe('candidateUrls', () => {
  test('întâi lista agenției, apoi paginile cu cele mai multe clickuri din 28 de zile; fără dubluri și fără pagini nevăzute în search', async () => {
    const { db } = setup({
      priority: ['https://site.test/z', 'https://site.test/a'],
      pages: [page('https://site.test/a', 500), page('https://site.test/b', 3), page('https://site.test/b', 4, '2026-11-06'), page('https://site.test/c', 9), page('https://site.test/zero', 0), page('https://site.test/nul', null), page('https://site.test/vechi', 900, '2026-10-01')],
    })
    assert.deepEqual(await candidateUrls(db, { tenant_id: T1, brand_id: B1 }, '2026-11-11'), [
      { url: 'https://site.test/a', origin: 'priority' },
      { url: 'https://site.test/z', origin: 'priority' },
      { url: 'https://site.test/c', origin: 'top_page' },
      { url: 'https://site.test/b', origin: 'top_page' },
    ])
  })

  test('site mic, fără clickuri pe rândurile query × pagină: paginile se aleg după afișări', async () => {
    const { db } = setup({ pages: [page('https://site.test/rar', 0, '2026-11-05', B1, T1, 4), page('https://site.test/des', null, '2026-11-05', B1, T1, 90), page('https://site.test/click', 1, '2026-11-05', B1, T1, 2), page('https://site.test/nimic', 0, '2026-11-05', B1, T1, 0)] })
    assert.deepEqual((await candidateUrls(db, { tenant_id: T1, brand_id: B1 }, '2026-11-11')).map((c) => c.url), ['https://site.test/click', 'https://site.test/des', 'https://site.test/rar'])
  })

  test(`cel mult ${INDEX_TOP_PAGES} de pagini după clickuri și ${INDEX_MAX_URLS} de URL-uri în total`, async () => {
    const many = setup({ pages: Array.from({ length: 80 }, (_, i) => page(`https://site.test/p${i}`, 100 - i)) })
    const top = await candidateUrls(many.db, { tenant_id: T1, brand_id: B1 }, '2026-11-11')
    assert.equal(top.length, INDEX_TOP_PAGES)
    assert.equal(top[0]!.url, 'https://site.test/p0')
    const full = setup({ priority: Array.from({ length: 190 }, (_, i) => `https://site.test/u${String(i).padStart(3, '0')}`), pages: Array.from({ length: 80 }, (_, i) => page(`https://site.test/p${i}`, 100 - i)) })
    const capped = await candidateUrls(full.db, { tenant_id: T1, brand_id: B1 }, '2026-11-11')
    assert.equal(capped.length, INDEX_MAX_URLS)
    assert.equal(capped.filter((c) => c.origin === 'priority').length, 190, 'lista agenției are prioritate la plafon')
  })

  test('un rând citit pentru alt brand oprește rularea', async () => {
    const { db } = setup({ pages: [page('https://alt.test/a', 5, '2026-11-05', B2, T2)] })
    // FakeDb aplică filtrele; rândul străin se strecoară doar dacă filtrul ar lipsi. Îl forțăm prin scope greșit pe rând.
    db.tables.search_queries!.push({ ...page('https://site.test/x', 5), brand_id: B1, tenant_id: T1 })
    const real = db.select.bind(db)
    db.select = (async (table: string, query: string) => (table === 'search_queries' ? [...(await real(table, query)), page('https://alt.test/a', 5, '2026-11-05', B2, T2)] : real(table, query))) as typeof db.select
    await assert.rejects(candidateUrls(db, { tenant_id: T1, brand_id: B1 }, '2026-11-11'), /alt client sau alt brand/)
  })
})

describe('inspectionRow', () => {
  const ctx = { tenant_id: T1, brand_id: B1, source_id: GSC, sync_run_id: 'run', inspected_on: '2026-11-11', collected_at: NOW.toISOString() }
  test('câmpurile vin neschimbate; md5 și hash pentru proveniență', () => {
    const r = inspectionRow(UrlInspectionSchema.parse(result()), { url: 'https://site.test/a', origin: 'priority' }, ctx)
    assert.equal(r.verdict, 'PASS')
    assert.equal(r.coverage_state, 'Submitted and indexed')
    assert.equal(r.last_crawl_time, '2026-11-09T04:12:33.000Z')
    assert.equal(r.url_md5, md5('https://site.test/a'))
    assert.match(String(r.payload_hash), /^[0-9a-f]{64}$/)
    assert.equal(r.origin, 'priority')
  })
  test('câmpurile lipsă rămân NULL: fără verdict nu înseamnă neindexat, o dată invalidă nu devine „acum”', () => {
    const r = inspectionRow(UrlInspectionSchema.parse({ inspectionResult: {} }), { url: 'https://site.test/a', origin: 'top_page' }, ctx)
    for (const k of ['verdict', 'coverage_state', 'indexing_state', 'robots_txt_state', 'page_fetch_state', 'crawled_as', 'last_crawl_time', 'google_canonical', 'user_canonical']) assert.equal(r[k], null, k)
    const bad = inspectionRow(UrlInspectionSchema.parse(result({ lastCrawlTime: 'niciodată', verdict: '' })), { url: 'https://site.test/a', origin: 'top_page' }, ctx)
    assert.equal(bad.last_crawl_time, null)
    assert.equal(bad.verdict, null)
  })
})

describe('collectIndex', () => {
  test('rulare completă: un apel pe URL, rânduri pe ziua din București, proveniență și sync_run', async () => {
    const { db, deps, requests, delays } = setup({ priority: ['https://site.test/a'], pages: [page('https://site.test/b', 7)], respond: (req) => (req.inspectionUrl.endsWith('/b') ? result({ verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' }) : result()) })
    const [o] = await collectIndex(deps)
    assert.deepEqual([o!.status, o!.urls, o!.rows_written, o!.errors.length], ['succeeded', 2, 2, 0])
    assert.deepEqual(requests, [
      { siteUrl: 'sc-domain:site.test', inspectionUrl: 'https://site.test/a', languageCode: 'ro' },
      { siteUrl: 'sc-domain:site.test', inspectionUrl: 'https://site.test/b', languageCode: 'ro' },
    ])
    assert.equal(delays.length, 1, 'pauză între apeluri, nu înaintea primului')
    const rows = db.tables.index_inspections!
    assert.deepEqual(rows.map((r) => [r.url, r.inspected_on, r.origin, r.verdict]), [['https://site.test/a', '2026-11-11', 'priority', 'PASS'], ['https://site.test/b', '2026-11-11', 'top_page', 'NEUTRAL']])
    for (const r of rows) assert.deepEqual([r.tenant_id, r.brand_id, r.source_id], [T1, B1, GSC])
    const run = db.tables.sync_runs![0]!
    assert.deepEqual([run.source, run.status, run.rows_written, run.period_start, run.period_end, run.source_connection_id], [INDEX_SOURCE, 'succeeded', 2, '2026-11-11', '2026-11-11', GSC])
    assert.equal(db.tables.provider_api_calls![0]!.calls, 2)
    assert.ok(!JSON.stringify(db.tables).includes('PRIVATE-KEY'), 'cheia privată nu ajunge în baza de date')
  })

  test('a doua rulare în aceeași zi rescrie rândurile, nu le dublează', async () => {
    const { db, deps } = setup({ priority: ['https://site.test/a'] })
    await collectIndex(deps)
    await collectIndex({ ...deps, createInspection: () => ({ inspect: async () => result({ verdict: 'FAIL' }) }) })
    assert.deepEqual(db.tables.index_inspections!.map((r) => r.verdict), ['FAIL'])
  })

  test('URL în afara proprietății: fără apel, notat; un URL respins de Google nu oprește restul', async () => {
    const { db, deps, requests } = setup({ priority: ['https://alt.test/x', 'https://site.test/a', 'https://site.test/rau'], respond: (req) => (req.inspectionUrl.endsWith('/rau') ? httpError(400, 'URL invalid') : result()) })
    const [o] = await collectIndex(deps)
    assert.equal(o!.status, 'partial')
    assert.deepEqual(requests.map((r) => r.inspectionUrl), ['https://site.test/a', 'https://site.test/rau'])
    assert.deepEqual(o!.errors.map((e) => [e.code, e.dimension]), [['url_outside_property', 'https://alt.test/x'], ['inspection_rejected', 'https://site.test/rau']])
    assert.equal(db.tables.index_inspections!.length, 1)
  })

  test('acces refuzat: rularea se oprește la primul URL și eșuează, fără rânduri', async () => {
    const { db, deps, requests } = setup({ priority: ['https://site.test/a', 'https://site.test/b'], respond: () => httpError(403, 'fără acces la proprietate') })
    const [o] = await collectIndex(deps)
    assert.equal(o!.status, 'failed')
    assert.equal(requests.length, 1)
    assert.equal(o!.errors[0]!.code, 'access_denied')
    assert.equal(db.tables.index_inspections!.length, 0)
    assert.equal(db.tables.sync_runs![0]!.status, 'failed')
  })

  test('cota epuizată la mijloc: reîncercări, apoi oprire; ce s-a inspectat rămâne scris (parțial)', async () => {
    const { db, deps, requests } = setup({ priority: ['https://site.test/a', 'https://site.test/b', 'https://site.test/c'], respond: (req) => (req.inspectionUrl.endsWith('/a') ? result() : httpError(429, 'cotă')) })
    const [o] = await collectIndex(deps)
    assert.equal(o!.status, 'partial')
    assert.equal(o!.errors[0]!.code, 'rate_limited')
    assert.equal(requests.filter((r) => r.inspectionUrl.endsWith('/b')).length, 3, 'trei încercări pe URL-ul limitat')
    assert.equal(requests.some((r) => r.inspectionUrl.endsWith('/c')), false, 'restul listei nu se mai cere')
    assert.deepEqual(db.tables.index_inspections!.map((r) => r.url), ['https://site.test/a'])
    assert.equal(db.tables.provider_api_calls![0]!.calls, 4)
  })

  test('răspuns cu altă formă: URL-ul e notat, nu se scrie un rând inventat', async () => {
    const { db, deps } = setup({ priority: ['https://site.test/a'], respond: () => ({ altceva: true }) })
    const [o] = await collectIndex(deps)
    assert.equal(o!.status, 'failed')
    assert.equal(o!.errors[0]!.code, 'invalid_payload')
    assert.equal(db.tables.index_inspections!.length, 0)
  })

  test('fără nimic de inspectat: nicio rulare și niciun apel', async () => {
    const { db, deps, requests } = setup()
    const [o] = await collectIndex(deps)
    assert.equal(o!.status, 'not_connected')
    assert.match(o!.reason!, /niciun URL de inspectat/)
    assert.equal(requests.length, 0)
    assert.equal(db.tables.sync_runs!.length, 0)
  })

  test('fără credential Google al clientului: not_connected, fără rulare', async () => {
    const { db, deps, requests } = setup({ credential: false, priority: ['https://site.test/a'] })
    const [o] = await collectIndex(deps)
    assert.deepEqual([o!.status, requests.length, db.tables.sync_runs!.length], ['not_connected', 0, 0])
  })

  test('izolare: credentialul unui client nu se folosește pentru brandul altui client; --brand restrânge rularea', async () => {
    const { db, deps, requests } = setup({ priority: ['https://site.test/a'] })
    db.tables.source_connections!.push({ id: GSC_T2, tenant_id: T2, brand_id: B2, provider: 'gsc', external_account_id: 'sc-domain:alt.test', status: 'active', credential_status: 'missing' })
    db.tables.index_urls!.push({ tenant_id: T2, brand_id: B2, url: 'https://alt.test/a', url_md5: md5('https://alt.test/a') })
    const out = await collectIndex(deps)
    assert.deepEqual(out.map((o) => [o.brand_id, o.status]), [[B1, 'succeeded'], [B2, 'not_connected']])
    assert.deepEqual(requests.map((r) => r.inspectionUrl), ['https://site.test/a'])
    assert.ok(db.tables.index_inspections!.every((r) => r.tenant_id === T1 && r.brand_id === B1))
    const only = await collectIndex(deps, { brandId: B2 })
    assert.deepEqual(only.map((o) => o.brand_id), [B2])
    await assert.rejects(collectIndex(deps, { brandId: 'nu-e-uuid' }))
  })
})
