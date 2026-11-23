import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { planableCompetitors, rankDomains } from './competitors.ts'
import { handle, type HandlerDeps } from './handler.ts'

// Răspunsurile Planable sunt construite după specificația OpenAPI publică (citită 23 nov. 2026), neconfirmate pe date reale.
const PLN = 'https://api.planable.io/api/v1'
const TOKEN = 'pln_SECRET_TOKEN'
const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

type Route = (url: string) => Response | Promise<Response> | null

function planableFetch(routes: Record<string, Response | (() => Response) | Error>, seen: string[] = []): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    seen.push(url)
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`)
    const key = url.slice(PLN.length)
    const r = routes[key]
    if (r instanceof Error) throw r
    if (typeof r === 'function') return r()
    // Un Response nou la fiecare cerere: anularea corpului unei clone (tee) ar aștepta și cealaltă ramură.
    if (r) return new Response(await r.clone().text(), { status: r.status })
    throw new Error(`neașteptat: ${url}`)
  }
}

const PAGES = '/pages?workspaceId=ws-1&offset=0&limit=50'
const pagesBody = (data: unknown[], hasMore = false) => ok({ data, pagination: { offset: 0, limit: 50, hasMore } })
const comp = (handle: string, displayName: string, platform: string) => ({
  trackedCompetitorId: `t-${handle}`, scrapedPageId: null, handle, displayName, platform, profileImageUrl: null, syncStatus: 'synced', lastSyncedAt: null,
})

describe('planableCompetitors', () => {
  test('unește același profil urmărit de două pagini; ignoră rețelele fără analiză de competitori', async () => {
    const seen: string[] = []
    const r = await planableCompetitors(TOKEN, 'ws-1', planableFetch({
      [PAGES]: pagesBody([
        { id: 'p-ig', name: 'Urinal RO', platform: 'instagram', workspaceId: 'ws-1', isConnected: true },
        { id: 'p-fb', name: 'Urinal', platform: 'Facebook', workspaceId: 'ws-1', isConnected: true },
        { id: 'p-x', name: 'Urinal X', platform: 'twitter', workspaceId: 'ws-1', isConnected: true },
      ]),
      '/pages/p-ig/competitors': ok({ data: [comp('cystenal', 'Cystenal', 'instagram'), comp('Afrodor', 'Afrodor', 'instagram')] }),
      '/pages/p-fb/competitors': ok({ data: [comp('cystenal.ro', 'Cystenal România', 'facebook'), comp('', 'Fără handle', 'facebook')] }),
    }, seen))
    assert.ok(r.ok)
    assert.equal(r.requests, 3)
    assert.equal(r.pages_checked, 2)
    assert.ok(!seen.some((u) => u.includes('p-x')), 'Twitter nu are competitori în Planable: nu se cere')
    assert.deepEqual(r.competitors.map((c) => `${c.platform}:${c.handle}:${c.name}`), ['instagram:Afrodor:Afrodor', 'instagram:cystenal:Cystenal', 'facebook:cystenal.ro:Cystenal România'])
    assert.deepEqual(r.competitors[1]?.tracked_from, ['Urinal RO'])
  })

  test('același profil pe două pagini de pe aceeași rețea apare o dată, cu ambele pagini', async () => {
    const r = await planableCompetitors(TOKEN, 'ws-1', planableFetch({
      [PAGES]: pagesBody([
        { id: 'a', name: 'Pagina A', platform: 'instagram' },
        { id: 'b', name: 'Pagina B', platform: 'instagram' },
      ]),
      '/pages/a/competitors': ok({ data: [comp('cystenal', 'Cystenal', 'instagram')] }),
      '/pages/b/competitors': ok({ data: [comp('CYSTENAL', 'Cystenal', 'instagram')] }),
    }))
    assert.ok(r.ok)
    assert.equal(r.competitors.length, 1)
    assert.deepEqual(r.competitors[0]?.tracked_from, ['Pagina A', 'Pagina B'])
  })

  test('paginează lista de pagini până la hasMore = false', async () => {
    const r = await planableCompetitors(TOKEN, 'ws-1', planableFetch({
      [PAGES]: pagesBody([{ id: 'a', name: 'A', platform: 'tiktok' }], true),
      '/pages?workspaceId=ws-1&offset=50&limit=50': pagesBody([{ id: 'b', name: 'B', platform: 'linkedin' }]),
      '/pages/a/competitors': ok({ data: [] }),
      '/pages/b/competitors': ok({ data: [comp('x', 'X', 'linkedin')] }),
    }))
    assert.ok(r.ok)
    assert.equal(r.requests, 4)
    assert.equal(r.competitors.length, 1)
  })

  test('400 pe o pagină (rețea fără analiză) se sare; 403 devine o notă, fără date inventate', async () => {
    const r = await planableCompetitors(TOKEN, 'ws-1', planableFetch({
      [PAGES]: pagesBody([{ id: 'a', name: 'A', platform: 'youtube' }, { id: 'b', name: 'B', platform: 'facebook' }]),
      '/pages/a/competitors': ok({ error: { code: 'VALIDATION_ERROR' } }, 400),
      '/pages/b/competitors': ok({ error: { code: 'FORBIDDEN' } }, 403),
    }))
    assert.ok(r.ok)
    assert.equal(r.competitors.length, 0)
    assert.equal(r.pages_checked, 0)
    assert.deepEqual(r.notes, ['B (facebook): tokenul nu are acces la pagină sau add-on-ul Analytics e inactiv.'])
  })

  test('401 oprește tot: token refuzat', async () => {
    const r = await planableCompetitors(TOKEN, 'ws-1', planableFetch({
      [PAGES]: pagesBody([{ id: 'a', name: 'A', platform: 'instagram' }]),
      '/pages/a/competitors': ok({}, 401),
    }))
    assert.ok(!r.ok)
    assert.equal(r.reason, 'invalid')
    assert.equal(r.requests, 2)
    assert.ok(!r.message.includes(TOKEN))
  })

  test('429 și eroare de rețea au motivele lor', async () => {
    const limited = await planableCompetitors(TOKEN, 'ws-1', planableFetch({ [PAGES]: ok({}, 429) }))
    assert.ok(!limited.ok && limited.reason === 'rate_limited')
    const down = await planableCompetitors(TOKEN, 'ws-1', planableFetch({ [PAGES]: new Error('ECONNRESET') }))
    assert.ok(!down.ok && down.reason === 'provider_error' && down.status === null)
  })

  test('workspace inaccesibil (403 pe /pages) și formă schimbată sunt erori de furnizor', async () => {
    const forbidden = await planableCompetitors(TOKEN, 'ws-1', planableFetch({ [PAGES]: ok({}, 403) }))
    assert.ok(!forbidden.ok && forbidden.reason === 'provider_error' && forbidden.status === 403)
    const shape = await planableCompetitors(TOKEN, 'ws-1', planableFetch({ [PAGES]: ok({ pages: [] }) }))
    assert.ok(!shape.ok && /s-a schimbat/.test(shape.message))
  })
})

describe('rankDomains', () => {
  test('ordonează după cuvintele cheie distincte, fără domeniul brandului', () => {
    const rows = [
      { observed_domain: 'cystenal.ro', keyword_id: '1' },
      { observed_domain: 'cystenal.ro', keyword_id: '1' },
      { observed_domain: 'cystenal.ro', keyword_id: '2' },
      { observed_domain: 'afrodor.ro', keyword_id: '3' },
      { observed_domain: 'www.urinal.ro', keyword_id: '4' },
      { observed_domain: '', keyword_id: '5' },
    ]
    assert.deepEqual(rankDomains(rows, 'urinal.ro'), [{ domain: 'cystenal.ro', keywords: 2 }, { domain: 'afrodor.ro', keywords: 1 }])
    assert.equal(rankDomains(rows, null, 1).length, 1)
  })
})

// --- Handler: acțiunea competitor_suggestions ----------------------------------------------------------

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const KEY = '50000000-0000-0000-0000-000000000041'
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key' }

type State = {
  brand: Record<string, unknown> | null
  admins: Set<string>
  members: Set<string>
  seoConnected: boolean
  observations: Array<{ observed_domain: string; keyword_id: string }>
  workspace: string | null
  key: { id: string; credential_status: string } | null
  discoverToday: number
  planable: Route
  calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>
}
let state: State

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    const method = init.method ?? 'GET'
    state.calls.push({ url, method, body })
    if (url.startsWith(PLN)) {
      assert.equal(headers.Authorization, `Bearer ${TOKEN}`)
      const r = await state.planable(url.slice(PLN.length))
      if (!r) throw new Error(`neașteptat: ${url}`)
      return r
    }
    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const id = { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST }[(headers.Authorization ?? '').replace(/^Bearer /, '')]
      return id ? ok({ id }) : ok({}, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile REST folosesc service role')
    const path = decodeURIComponent(url.slice(`${env.supabaseUrl}/rest/v1/`.length))
    if (path.startsWith('brands?')) return ok(state.brand ? [state.brand] : [])
    if (path.startsWith('memberships?')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      if (path.includes('role=eq.agency_admin')) return ok(state.admins.has(user) ? [{ role: 'agency_admin' }] : [])
      return ok(state.members.has(user) ? [{ role: 'member' }] : [])
    }
    if (path.startsWith('source_connections?')) {
      assert.match(path, new RegExp(`tenant_id=eq\\.${T1}`), 'conexiunile se caută explicit în tenantul brandului')
      if (path.includes('provider=eq.seomonitor')) return ok(state.seoConnected ? [{ id: 'seo' }] : [])
      if (path.includes('provider=eq.planable&')) return ok(state.workspace ? [{ id: 'pln-brand', external_account_id: state.workspace }] : [])
      if (path.includes('provider=eq.planable_account')) return ok(state.key ? [state.key] : [])
    }
    if (path.startsWith('ai_brand_observations?')) {
      assert.match(path, new RegExp(`tenant_id=eq\\.${T1}&brand_id=eq\\.${B1}`), 'observațiile se filtrează pe tenant și brand')
      assert.match(path, /is_own_brand=is\.false/)
      return ok(state.observations)
    }
    if (path.startsWith('provider_api_calls?')) return ok(state.discoverToday ? [{ calls: state.discoverToday }] : [])
    if (path === 'rpc/get_source_token') return ok(TOKEN)
    if (path === 'rpc/record_source_validation') return ok(body?.p_ok ? 'valid' : 'invalid')
    if (path === 'provider_api_calls' || path === 'audit_events') return new Response(null, { status: 201 })
    throw new Error(`neașteptat: ${method} ${url}`)
  }
}

async function call(body: unknown, jwt = 'jwt-admin') {
  const req = new Request('http://fn.test/source-credentials', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) })
  const res = await handle(req, { env, fetch: fakeFetch(), now: () => new Date('2026-11-23T10:00:00Z') })
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, any>, text }
}
const rest = (p: string) => state.calls.filter((c) => c.url.includes(`/rest/v1/${p}`))

beforeEach(() => {
  state = {
    brand: { id: B1, tenant_id: T1, domain: 'urinal.ro', status: 'active' },
    admins: new Set([ADMIN]),
    members: new Set([ADMIN, STRATEGIST]),
    seoConnected: true,
    observations: [{ observed_domain: 'cystenal.ro', keyword_id: '1' }, { observed_domain: 'urinal.ro', keyword_id: '1' }],
    workspace: 'ws-1',
    key: { id: KEY, credential_status: 'valid' },
    discoverToday: 0,
    planable: (path) => {
      if (path === PAGES) return pagesBody([{ id: 'a', name: 'Urinal', platform: 'instagram' }])
      if (path === '/pages/a/competitors') return ok({ data: [comp('cystenal', 'Cystenal', 'instagram')] })
      return null
    },
    calls: [],
  }
})

describe('competitor_suggestions', () => {
  test('ambele surse: domenii din SEOmonitor, profiluri din Planable; contorizare, audit, fără token în răspuns', async () => {
    const r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.seomonitor, { outcome: 'ok', message: null, since: '2026-07-26', domains: [{ domain: 'cystenal.ro', keywords: 1 }] })
    assert.equal(r.body.planable.outcome, 'ok')
    assert.deepEqual(r.body.planable.competitors, [{ platform: 'instagram', handle: 'cystenal', name: 'Cystenal', tracked_from: ['Urinal'] }])
    assert.ok(!r.text.includes(TOKEN))
    const counted = rest('provider_api_calls').filter((c) => c.method === 'POST').map((c) => [c.body?.purpose, c.body?.calls, c.body?.source_connection_id])
    assert.deepEqual(counted, [['discover', 1, KEY], ['discover', 1, KEY]], '2 cereri Planable: 1 înainte, 1 după')
    const audit = rest('audit_events').map((c) => c.body)
    assert.equal(audit.length, 1)
    assert.equal(audit[0]?.action, 'competitors_suggested')
    assert.equal(audit[0]?.brand_id, B1)
    assert.ok(!JSON.stringify(audit).includes(TOKEN))
  })

  test('nu scrie nimic în setul de competitori', async () => {
    await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(state.calls.filter((c) => c.url.includes('competitor_set')).length, 0)
  })

  test('fără workspace, fără token sau fără SEOmonitor: „neconectată”, fără apel la furnizor', async () => {
    state.workspace = null
    state.seoConnected = false
    let r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.body.planable.outcome, 'not_connected')
    assert.equal(r.body.seomonitor.outcome, 'not_connected')
    assert.equal(rest('ai_brand_observations').length, 0)
    state.workspace = 'ws-1'
    state.key = { id: KEY, credential_status: 'missing' }
    r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.body.planable.outcome, 'not_connected')
    assert.equal(state.calls.filter((c) => c.url.startsWith(PLN)).length, 0)
  })

  test('listă goală e „ok” cu mesaj, nu „neconectată”', async () => {
    state.observations = []
    state.planable = (path) => (path === PAGES ? pagesBody([{ id: 'a', name: 'Urinal', platform: 'instagram' }]) : path === '/pages/a/competitors' ? ok({ data: [] }) : null)
    const r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.body.seomonitor.outcome, 'ok')
    assert.match(r.body.seomonitor.message, /nu a raportat/)
    assert.equal(r.body.planable.outcome, 'ok')
    assert.match(r.body.planable.message, /nu urmăresc niciun competitor/)
  })

  test('buget zilnic atins: fără apel la Planable; SEOmonitor merge în continuare', async () => {
    state.discoverToday = 30
    const r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.body.planable.outcome, 'budget_exhausted')
    assert.equal(state.calls.filter((c) => c.url.startsWith(PLN)).length, 0)
    assert.equal(r.body.seomonitor.outcome, 'ok')
  })

  test('token refuzat: cheia se marchează invalidă', async () => {
    state.planable = () => ok({}, 401)
    const r = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(r.body.planable.outcome, 'invalid')
    assert.deepEqual(rest('rpc/record_source_validation').map((c) => c.body?.p_ok), [false])
  })

  test('strategist: 403; brand străin sau inexistent: 404 cu același mesaj; brand_id invalid: 400', async () => {
    assert.equal((await call({ action: 'competitor_suggestions', brand_id: B1 }, 'jwt-strategist')).status, 403)
    state.members.delete(ADMIN)
    state.admins.delete(ADMIN)
    const foreign = await call({ action: 'competitor_suggestions', brand_id: B1 })
    state.brand = null
    const missing = await call({ action: 'competitor_suggestions', brand_id: B1 })
    assert.equal(foreign.status, 404)
    assert.equal(missing.status, 404)
    assert.equal(foreign.body.error, missing.body.error)
    assert.equal((await call({ action: 'competitor_suggestions', brand_id: 'eq.1&x' })).status, 400)
    assert.equal(state.calls.filter((c) => c.url.startsWith(PLN)).length, 0)
  })
})
