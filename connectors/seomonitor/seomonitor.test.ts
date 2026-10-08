// Conectorul SEOmonitor pe fixtures docs-derived (neconfirmate), cu API simulat și bază în memorie.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { collectSeomonitorConnection } from './collect-core.ts'
import { FIXTURE_FILES, seoFixture, type FixtureName } from './docs-fixtures.ts'
import { parseAioRank, parseRank, sanitizeContent, aiStatus, toNumber } from './normalize.ts'
import { currentMappings, resolveGroups, flattenGroups, type MappingRow } from './mapping.ts'
import { FakeDb, noSleep, type FakeResponse } from '../shared/test-helpers.ts'
import type { TenantConnection } from '../shared/connections.ts'
import type { FetchLike } from '../shared/http-budget.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const B1A = '20000000-0000-0000-0000-000000000011'
const B1B = '20000000-0000-0000-0000-000000000012'
const CONN = '50000000-0000-0000-0000-000000000010'
const TOKEN = 'seomonitor-raw-jwt-token'
const connection: TenantConnection = {
  id: CONN, tenant_id: T1, brand_id: null, provider: 'seomonitor', external_account_id: '20077', credential_status: 'valid',
}
// Marți 6 oct 2026, 04:00 UTC → ultima zi = 5 oct (Europe/Bucharest), fereastra 1 sep – 5 oct.
const now = () => new Date('2026-10-06T04:00:00Z')

const mapping = (over: Partial<MappingRow>): MappingRow => ({
  id: crypto.randomUUID(), tenant_id: T1, source_id: CONN, campaign_id: '102933', group_id: '0', version: 1,
  effective_from: '2026-09-01', mapping_kind: 'brand', brand_id: B1A, brand_type: 'nonbranded', is_primary_visibility: false, ...over,
})

function defaultMappings(): MappingRow[] {
  return [
    mapping({ group_id: '6001', is_primary_visibility: true }),
    mapping({ group_id: '5002', brand_type: 'branded' }),
    mapping({ group_id: '5001', mapping_kind: 'excluded', brand_id: null, brand_type: null }),
    mapping({ group_id: '7001', mapping_kind: 'multi_brand', brand_id: null, brand_type: null }),
    // 8001 rămâne nemapat → coadă.
  ]
}

function makeDb(mappings = defaultMappings(), callsToday = 0) {
  const db = new FakeDb({
    seomonitor_group_mappings: mappings,
    provider_api_calls: callsToday ? [{ source_connection_id: CONN, call_date_utc: '2026-10-06', calls: callsToday, tenant_id: T1 }] : [],
  })
  db.rpcs.get_source_token = () => TOKEN
  db.rpcs.record_source_validation = (args) => (args.p_ok ? 'valid' : 'invalid')
  return db
}

type Override = (url: URL, call: number) => FakeResponse | undefined
const PATH_TO_FIXTURE: Record<string, FixtureName> = {
  '/v3/dashboard/v3.0/campaigns/tracked': 'campaigns-tracked',
  '/v3/rank-tracker/v3.0/groups': 'groups',
  '/v3/rank-tracker/v3.0/keywords': 'keywords',
  '/v3/rank-tracker/v3.0/keywords/daily-ranks': 'daily-ranks',
  '/v3/rank-tracker/v3.0/groups/daily-visibility': 'groups-daily-visibility',
  '/v3/rank-tracker/v3.0/keywords/ais': 'keywords-ais',
  '/v3/rank-tracker/v3.0/keywords/daily-ranks/ais': 'keywords-daily-ranks-ais',
  '/v3/rank-tracker/v3.0/keywords/competition/ais': 'keywords-competition-ais',
  '/v3/rank-tracker/v3.0/groups/daily-visibility/ais-mentions': 'groups-daily-visibility-ais-mentions',
  '/v3/rank-tracker/v3.0/groups/daily-visibility/ais-citations': 'groups-daily-visibility-ais-citations',
  '/v3/rank-tracker/v3.0/ais/stats': 'ais-stats',
  '/v3/rank-tracker/v3.0/keywords/aio': 'keywords-aio',
}

function fakeApi(override?: Override) {
  const calls: URL[] = []
  const headers: Array<Record<string, string>> = []
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input)
    calls.push(url)
    headers.push((init?.headers ?? {}) as Record<string, string>)
    const custom = override?.(url, calls.length)
    const respond = (r: FakeResponse) => {
      if (r instanceof Error) throw r
      return new Response(r.body ?? '', { status: r.status, headers: r.headers })
    }
    if (custom) return respond(custom)
    let name = PATH_TO_FIXTURE[url.pathname]
    if (!name) return respond({ status: 404, body: '{"error":{"message":"Data not found"}}' })
    if (name === 'keywords' && url.searchParams.get('group_id') === '-1') name = 'keywords-branded'
    if (name === 'daily-ranks' && url.searchParams.get('get_archive') === 'true') name = 'daily-ranks-archive'
    // Paginare: doar prima pagină are date.
    if (Number(url.searchParams.get('offset') ?? 0) > 0) return respond({ status: 200, body: '[]' })
    return respond({ status: 200, body: JSON.stringify(seoFixture(name).payload) })
  }
  return { fetch, calls, headers }
}

async function run(db: FakeDb, api = fakeApi(), extra: { dailyQuota?: number; minBudgetToStart?: number } = {}) {
  const s = noSleep()
  const outcome = await collectSeomonitorConnection({ db, fetch: api.fetch, sleep: s.sleep, now, random: () => 0.5, ...extra }, connection)
  return { outcome, api, sleeps: s.delays }
}

const rows = (db: FakeDb, table: string) => db.tables[table] ?? []
const runOf = (db: FakeDb, brand = B1A) => rows(db, 'sync_runs').filter((r) => r.brand_id === brand)

describe('fixtures docs-derived', () => {
  for (const name of FIXTURE_FILES) {
    test(`${name}: marcat „derivat din documentație, neconfirmat" și cu sursă`, () => {
      const f = seoFixture(name)
      assert.equal(f.header, 'derivat din documentație, neconfirmat')
      assert.match(f.source, /^https:\/\/api-docs\.seomonitor\.com\/api-\d+\.md/)
    })
  }
})

describe('conectorul SEOmonitor pe fixtures docs-derived', () => {
  test('rulare completă: autentificare brută (fără Bearer), doar GET, sync_run succeeded cu acoperire', async () => {
    const db = makeDb()
    const { outcome, api } = await run(db)
    assert.equal(outcome.access, 'ok')
    assert.ok(api.headers.every((h) => h.Authorization === TOKEN), 'Authorization = tokenul brut')
    assert.ok(api.calls.every((u) => u.origin === 'https://apigw.seomonitor.com'))
    const [r] = outcome.runs
    assert.equal(r!.brand_id, B1A)
    assert.equal(r!.status, 'succeeded', JSON.stringify(r!.errors))
    assert.equal(runOf(db)[0]!.period_start, '2026-09-01')
    assert.equal(runOf(db)[0]!.period_end, '2026-10-05')
    const coverage = runOf(db)[0]!.coverage as Record<string, { covered_days: number; expected_days: number }>
    assert.equal(coverage.ranks!.expected_days, 35)
    assert.equal(coverage.ranks!.covered_days, 2)
    assert.equal(rows(db, 'provider_api_calls').find((c) => c.purpose === 'collect')!.calls, outcome.calls)
  })

  test('paginarea trece de prima pagină: 1.000 + 3 keywords, offset avansat cu limit', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({ keyword_id: 20000 + i, keyword: `kw ${i}`, groups: '6001' }))
    const tail = Array.from({ length: 3 }, (_, i) => ({ keyword_id: 30000 + i, keyword: `tail ${i}`, groups: '6001' }))
    const api = fakeApi((url) => {
      if (url.pathname.endsWith('/rank-tracker/v3.0/keywords') && url.searchParams.get('group_id') === '6001') {
        const offset = Number(url.searchParams.get('offset'))
        return { status: 200, body: JSON.stringify(offset === 0 ? big : offset === 1000 ? tail : []) }
      }
      return undefined
    })
    const db = makeDb([mapping({ group_id: '6001', is_primary_visibility: true })])
    await run(db, api)
    const kwCalls = api.calls.filter((u) => u.pathname.endsWith('/keywords') && u.searchParams.get('group_id') === '6001')
    assert.deepEqual(kwCalls.map((u) => u.searchParams.get('offset')), ['0', '1000'])
    assert.ok(kwCalls.every((u) => u.searchParams.get('limit') === '1000'))
    assert.equal(rows(db, 'keywords').filter((k) => k.status === 'active').length, 1003)
    // AI Overview: se avansează până la o pagină goală (documentat).
    const aioOffsets = api.calls.filter((u) => u.pathname.endsWith('/keywords/aio')).map((u) => u.searchParams.get('offset'))
    assert.deepEqual(aioOffsets, ['0', '1000'])
  })

  test('rulare dublă: nimic dublat, aceleași valori', async () => {
    const db = makeDb()
    await run(db)
    const tables = ['keywords', 'keyword_groups', 'rank_observations', 'seomonitor_group_visibility_daily', 'ai_answers',
      'ai_answer_originals', 'ai_citations', 'ai_brand_observations', 'seomonitor_ai_visibility_daily', 'seomonitor_ai_engine_stats',
      'seomonitor_mapping_queue']
    const snap = () => Object.fromEntries(tables.map((t) => [t, rows(db, t).map((r) => {
      const { id: _id, sync_run_id: _s, collected_at: _c, last_seen_at: _l, archived_detected_at: _a, answer_id: _x, ...rest } = r
      return JSON.stringify(rest)
    }).sort()]))
    const first = snap()
    await run(db)
    assert.deepEqual(snap(), first)
    assert.equal(runOf(db).length, 2)
  })

  test('pagină goală: zero rânduri pentru ruta respectivă, run-ul nu e marcat eșuat', async () => {
    const api = fakeApi((url) => (url.pathname.endsWith('/keywords/ais') ? { status: 200, body: '[]' } : undefined))
    const db = makeDb()
    const { outcome } = await run(db, api)
    assert.equal(rows(db, 'ai_answers').filter((a) => a.surface === 'ai_search').length, 0)
    assert.ok(rows(db, 'ai_answers').some((a) => a.surface === 'ai_overview'))
    assert.equal(outcome.runs[0]!.status, 'succeeded')
  })

  test('token expirat (401): un singur apel, fără retry, token marcat invalid, toate run-urile failed', async () => {
    const api = fakeApi(() => ({ status: 401, body: '{"error":{"message":"Invalid authentication"}}' }))
    const db = makeDb()
    const validations: unknown[] = []
    db.rpcs.record_source_validation = (args) => { validations.push(args); return 'invalid' }
    const { outcome, sleeps } = await run(db, api)
    assert.equal(api.calls.length, 1)
    assert.equal(outcome.access, 'denied')
    assert.deepEqual(outcome.runs.map((r) => r.status), ['failed'])
    assert.equal((outcome.runs[0]!.errors[0] as { code: string }).code, 'access_denied')
    assert.deepEqual(validations, [{ p_connection_id: CONN, p_ok: false, p_error: 'HTTP 401' }])
    assert.ok(!sleeps.some((d) => d >= 60_000), 'fără retry')
    assert.doesNotMatch(JSON.stringify(db.tables), new RegExp(TOKEN))
  })

  test('403 la mijlocul rulării: oprire imediată, fără retry, run failed', async () => {
    const api = fakeApi((url) => (url.pathname.endsWith('/keywords/daily-ranks') ? { status: 403 } : undefined))
    const db = makeDb()
    const { outcome } = await run(db, api)
    assert.equal(api.calls.filter((u) => u.pathname.endsWith('/keywords/daily-ranks')).length, 1)
    assert.equal(outcome.runs[0]!.status, 'failed')
  })

  test('zero vs null: visibility 0 rămâne 0, lipsa rămâne NULL; search_volume 0 = 0', async () => {
    const db = makeDb()
    await run(db)
    const vis = (date: string, device: string) =>
      rows(db, 'seomonitor_group_visibility_daily').find((r) => r.date === date && r.device === device && r.group_id === '6001')!
    assert.equal(vis('2026-10-06', 'desktop').visibility, 0)
    assert.equal(vis('2026-10-06', 'mobile').visibility, null)
    assert.equal(vis('2026-10-05', 'desktop').visibility, 0.53)
    const ai = (metric: string, date: string) => rows(db, 'seomonitor_ai_visibility_daily').find((r) => r.metric === metric && r.date === date)!
    assert.equal(ai('brand_mentions', '2026-10-06').value, 0)
    assert.equal(ai('site_citations', '2026-10-06').value, null)
    assert.equal(rows(db, 'keywords').find((k) => k.keyword_id === '1002')!.search_volume, 0)
  })

  test('rank absent: NULL, nu 100; valoarea originală păstrată', async () => {
    const db = makeDb()
    await run(db)
    const rank = (kw: string, device: string, date: string) =>
      rows(db, 'rank_observations').find((r) => r.keyword_id === kw && r.device === device && r.date === date)!
    assert.deepEqual([rank('1002', 'mobile', '2026-10-05').rank, rank('1002', 'mobile', '2026-10-05').rank_status], [null, 'not_ranked'])
    assert.deepEqual([rank('1002', 'mobile', '2026-10-06').rank, rank('1002', 'mobile', '2026-10-06').rank_status], [null, 'not_ranked'])
    const limit = rank('1003', 'desktop', '2026-10-05')
    assert.deepEqual([limit.rank, limit.rank_status, limit.rank_original], [null, 'at_tracking_limit', '100'])
    assert.equal(rank('1001', 'desktop', '2026-10-06').rank, 3)
    assert.ok(!rows(db, 'rank_observations').some((r) => r.rank === 100))
    const aioMobile = rows(db, 'ai_answers').find((a) => a.surface === 'ai_overview' && a.device === 'mobile')!
    assert.deepEqual([aioMobile.rank, aioMobile.rank_original], [null, '100'])
  })

  test('keyword arhivat, rank absent și grup: stări distincte', async () => {
    const db = makeDb()
    await run(db)
    const archived = rows(db, 'keywords').find((k) => k.keyword_id === '1009')!
    assert.equal(archived.status, 'archived')
    assert.ok(archived.archived_detected_at)
    assert.ok(rows(db, 'rank_observations').filter((r) => r.keyword_id === '1009').every((r) => r.keyword_status === 'archived' && r.rank !== null))
    const unranked = rows(db, 'keywords').find((k) => k.keyword_id === '1003')!
    assert.equal(unranked.status, 'active', 'rank absent nu înseamnă arhivat')
    assert.deepEqual(rows(db, 'keywords').find((k) => k.keyword_id === '1002')!.group_ids, ['6001', '7001'])
    assert.ok(rows(db, 'rank_observations').every((r) => r.mapping_version === 1 && ['6001', '5002'].includes(String(r.attributed_group_id))))
  })

  test('brand / non-brand: keywords din Brand folder (group_id = -1) marcate is_branded; tipul grupului din mapare', async () => {
    const db = makeDb()
    const { api } = await run(db)
    assert.ok(api.calls.some((u) => u.searchParams.get('group_id') === '-1'))
    assert.equal(rows(db, 'keywords').find((k) => k.keyword_id === '1001')!.is_branded, true)
    assert.equal(rows(db, 'keywords').find((k) => k.keyword_id === '1003')!.is_branded, false)
    const types = Object.fromEntries(rows(db, 'keyword_groups').map((g) => [g.group_id, g.brand_type]))
    assert.deepEqual(types, { '6001': 'nonbranded', '5002': 'branded' })
  })

  test('grup nemapat și multi-brand: în coadă, nimic atribuit vreunui brand', async () => {
    const db = makeDb()
    const { outcome } = await run(db)
    const queue = rows(db, 'seomonitor_mapping_queue').map((q) => `${q.group_id}:${q.reason}`).sort()
    assert.deepEqual(queue, ['7001:multi_brand', '8001:unmapped'])
    assert.equal(outcome.queue.length, 2)
    for (const t of ['rank_observations', 'ai_answers', 'seomonitor_group_visibility_daily', 'keyword_groups']) {
      assert.ok(!rows(db, t).some((r) => ['7001', '8001'].includes(String(r.attributed_group_id ?? r.group_id))), t)
    }
    assert.ok(!rows(db, 'sync_runs').some((r) => r.brand_id === B1B), 'niciun brand implicit')
  })

  test('grup mapat dispărut din SEOmonitor: coadă + run partial (niciodată succeeded)', async () => {
    const db = makeDb([...defaultMappings(), mapping({ group_id: '9999' })])
    const { outcome } = await run(db)
    assert.ok(rows(db, 'seomonitor_mapping_queue').some((q) => q.group_id === '9999' && q.reason === 'mapped_group_missing'))
    assert.equal(outcome.runs[0]!.status, 'partial')
  })

  test('maparea versionată: versiunea curentă la data rulării; o versiune viitoare nu se aplică încă', () => {
    const rowsM = [
      mapping({ group_id: '6001', version: 1, brand_id: B1A }),
      mapping({ group_id: '6001', version: 2, brand_id: B1B, effective_from: '2026-10-01' }),
      mapping({ group_id: '6001', version: 3, mapping_kind: 'multi_brand', brand_id: null, brand_type: null, effective_from: '2026-12-01' }),
    ]
    const current = currentMappings(rowsM, '2026-10-05')
    assert.equal(current.get('102933|6001')!.version, 2)
    const resolved = resolveGroups(flattenGroups('102933', [{ group_id: 6001, name: 'x', type: 'group' }]), current)
    assert.deepEqual([...resolved.byBrand.keys()], [B1B])
  })

  test('cele trei stări AI: technical_error, brand_absent, brand_present; refusal nu se atribuie automat', async () => {
    const db = makeDb()
    await run(db)
    const search = Object.fromEntries(rows(db, 'ai_answers').filter((a) => a.surface === 'ai_search').map((a) => [a.keyword_id, a.status]))
    assert.deepEqual(search, { '1001': 'brand_present', '1002': 'brand_absent', '1003': 'technical_error' })
    assert.ok(!rows(db, 'ai_answers').some((a) => a.status === 'refusal'))
    assert.equal(rows(db, 'ai_answers').find((a) => a.keyword_id === '1002' && a.surface === 'ai_search')!.rank, null)
    assert.equal(aiStatus(undefined), 'technical_error')
    assert.equal(aiStatus(false), 'brand_absent')
    const competitors = rows(db, 'ai_brand_observations').filter((o) => !o.is_own_brand)
    assert.deepEqual(competitors.map((c) => [c.observed_domain, c.status]).sort(), [['altcompetitor.test', 'brand_absent'], ['competitor.test', 'brand_present']])
  })

  test('doar motoarele AI activate (gemini dezactivat nu e apelat); ai_search_llm cu valori documentate', async () => {
    const db = makeDb()
    const { api } = await run(db)
    const llms = new Set(api.calls.map((u) => u.searchParams.get('ai_search_llm') ?? u.searchParams.get('gpt_provider')).filter(Boolean))
    assert.deepEqual([...llms], ['openai'])
  })

  test('conținut AI sanitizat; originalul (cu HTML) separat, doar pentru audit', async () => {
    const db = makeDb()
    await run(db)
    const answer = rows(db, 'ai_answers').find((a) => a.keyword_id === '1001' && a.surface === 'ai_search')!
    assert.doesNotMatch(String(answer.content), /<script|alert/)
    assert.match(String(answer.content), /Brand1A este o opțiune \*\*populară\*\*/)
    const original = rows(db, 'ai_answer_originals').find((o) => o.answer_id === answer.id)!
    assert.match(String(original.raw_content), /<script>/)
    assert.equal(rows(db, 'ai_citations').find((c) => c.url === 'https://www.brand1a.test/produs' && c.engine === 'openai')!.is_own_domain, true)
  })

  test('buget: sub minim nu pornește; epuizat la mijloc → partial, niciodată succeeded', async () => {
    const refused = makeDb(defaultMappings(), 9990)
    const r1 = await run(refused, fakeApi(), { dailyQuota: 10_000, minBudgetToStart: 50 })
    assert.equal(r1.api.calls.length, 0)
    assert.equal(r1.outcome.runs[0]!.status, 'failed')

    const db = makeDb(defaultMappings(), 9980)
    const r2 = await run(db, fakeApi(), { dailyQuota: 10_000, minBudgetToStart: 10 })
    assert.equal(r2.api.calls.length, 20, 'exact bugetul rămas')
    assert.equal(r2.outcome.runs[0]!.status, 'partial')
    assert.ok(r2.outcome.runs[0]!.errors.some((e) => e.code === 'budget_exhausted'))
  })

  test('retry 5xx: 1 minut (cu jitter), fără retry pe 401/403; limita de 10 cereri/secundă respectată', async () => {
    let failed = false
    const api = fakeApi((url) => {
      if (url.pathname.endsWith('/groups') && !failed) { failed = true; return { status: 503 } }
      return undefined
    })
    const db = makeDb()
    const { sleeps, outcome } = await run(db, api)
    assert.ok(sleeps.includes(60_000), `așteptare de 1 minut: ${sleeps.filter((d) => d > 1000)}`)
    assert.ok(sleeps.filter((d) => d < 1000).every((d) => d >= 100), 'pauză între cereri')
    assert.equal(outcome.runs[0]!.status, 'succeeded')
  })

  test('mapare din alt tenant întoarsă de bază: rularea se oprește (verificare explicită)', async () => {
    const db = makeDb([mapping({ group_id: '6001', tenant_id: '10000000-0000-0000-0000-000000000002' })])
    const select = db.select.bind(db)
    db.select = async <T extends Record<string, unknown>>(table: string, query: string) =>
      (table === 'seomonitor_group_mappings' ? (db.tables[table] as T[]) : select<T>(table, query))
    await assert.rejects(collectSeomonitorConnection({ db, fetch: fakeApi().fetch, sleep: noSleep().sleep, now }, connection), /alt tenant/)
  })
})

describe('reguli de valori', () => {
  test('toNumber: 0 rămâne 0, "" și null → NULL, string numeric → număr', () => {
    assert.equal(toNumber(0), 0)
    assert.equal(toNumber('0'), 0)
    assert.equal(toNumber(''), null)
    assert.equal(toNumber(null), null)
    assert.equal(toNumber('18.5059'), 18.5059)
    assert.equal(toNumber('N/A'), null)
  })
  test('parseRank / parseAioRank', () => {
    assert.deepEqual(parseRank(undefined, 100), { rank: null, rank_status: 'not_ranked', rank_original: null })
    assert.deepEqual(parseRank('', 100), { rank: null, rank_status: 'not_ranked', rank_original: '' })
    assert.deepEqual(parseRank(100, 100), { rank: null, rank_status: 'at_tracking_limit', rank_original: '100' })
    assert.deepEqual(parseRank(0, 100), { rank: null, rank_status: 'invalid', rank_original: '0' })
    assert.deepEqual(parseRank(7, 100), { rank: 7, rank_status: 'ranked', rank_original: '7' })
    assert.deepEqual(parseAioRank(100), { rank: null, rank_original: '100' })
    assert.deepEqual(parseAioRank(3), { rank: 3, rank_original: '3' })
  })
  test('sanitizeContent', () => {
    assert.equal(sanitizeContent('a<script>x()</script>b <b>c</b> [l](javascript:alert(1))'), 'ab c [l](#)')
    assert.equal(sanitizeContent('   '), null)
    assert.equal(sanitizeContent(null), null)
  })
})
