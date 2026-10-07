import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type HandlerDeps } from './handler.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const CONN = '50000000-0000-0000-0000-000000000031'
const SECRET = 'CLARITY-SECRET-TOKEN'
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key' }

type State = {
  users: Record<string, string> // jwt → user id
  admins: Set<string>
  members: Set<string>
  connection: Record<string, unknown> | null
  callsToday: number
  clarityStatus: number | Error
  calls: Array<{ url: string; method: string; body?: unknown; headers: Record<string, string> }>
  rpcError?: { status: number; code: string }
}

let state: State

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const method = init.method ?? 'GET'
    state.calls.push({ url, method, body, headers })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

    if (url.startsWith('https://www.clarity.ms/')) {
      if (state.clarityStatus instanceof Error) throw state.clarityStatus
      return new Response('[]', { status: state.clarityStatus })
    }
    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const jwt = (headers.Authorization ?? '').replace(/^Bearer /, '')
      const id = state.users[jwt]
      return id ? ok({ id }) : ok({ msg: 'invalid' }, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile REST folosesc service role')
    const path = url.slice(`${env.supabaseUrl}/rest/v1/`.length)
    if (path.startsWith('source_connections?')) return ok(state.connection ? [state.connection] : [])
    if (path.startsWith('memberships?')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      if (path.includes('role=eq.agency_admin')) return ok(state.admins.has(user) ? [{ role: 'agency_admin' }] : [])
      return ok(state.members.has(user) ? [{ role: 'member' }] : [])
    }
    if (path.startsWith('provider_api_calls?')) return ok(state.callsToday ? [{ calls: state.callsToday }] : [])
    if (path.startsWith('rpc/') && state.rpcError) {
      return ok({ code: state.rpcError.code, message: 'x' }, state.rpcError.status)
    }
    if (path === 'rpc/set_source_token') return ok('unverified')
    if (path === 'rpc/get_source_token') return ok(SECRET)
    if (path === 'rpc/record_source_validation') return ok(body.p_ok ? 'valid' : 'invalid')
    if (path === 'provider_api_calls' || path === 'audit_events') return new Response(null, { status: 201 })
    throw new Error(`neașteptat: ${method} ${url}`)
  }
}

async function call(body: unknown, jwt: string | null = 'jwt-admin') {
  const req = new Request('http://fn.test/source-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })
  const res = await handle(req, { env, fetch: fakeFetch(), now: () => new Date('2026-10-07T10:00:00Z') })
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text }
}

const clarityCalls = () => state.calls.filter((c) => c.url.startsWith('https://www.clarity.ms/'))
const restCalls = (path: string) => state.calls.filter((c) => c.url.includes(`/rest/v1/${path}`))

beforeEach(() => {
  state = {
    users: { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST },
    admins: new Set([ADMIN]),
    members: new Set([ADMIN, STRATEGIST]),
    connection: { id: CONN, tenant_id: T1, brand_id: B1, provider: 'clarity', status: 'active', credential_status: 'unverified' },
    callsToday: 0,
    clarityStatus: 200,
    calls: [],
  }
})

describe('autentificare și validarea cererii', () => {
  test('fără JWT: 401', async () => {
    const r = await call({ action: 'validate', connection_id: CONN }, null)
    assert.equal(r.status, 401)
  })
  test('JWT respins de Auth (inclusiv cheia service role sau anon ca Bearer): 401', async () => {
    const r = await call({ action: 'validate', connection_id: CONN }, 'service-key')
    assert.equal(r.status, 401)
    assert.equal(restCalls('').length, 0)
  })
  test('connection_id invalid: 400, fără query', async () => {
    const r = await call({ action: 'validate', connection_id: `${CONN}&tenant_id=neq.x` })
    assert.equal(r.status, 400)
    assert.equal(restCalls('').length, 0)
  })
  test('acțiune necunoscută: 400', async () => {
    assert.equal((await call({ action: 'delete', connection_id: CONN })).status, 400)
  })
  test('GET: 405', async () => {
    const res = await handle(new Request('http://fn.test/x'), { env, fetch: fakeFetch(), now: () => new Date() })
    assert.equal(res.status, 405)
  })
})

describe('set_token', () => {
  test('admin: tokenul ajunge la RPC cu actorul, răspunsul nu conține tokenul', async () => {
    const r = await call({ action: 'set_token', connection_id: CONN, token: SECRET })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { connection_id: CONN, credential_status: 'unverified' })
    assert.doesNotMatch(r.text, /CLARITY-SECRET/)
    const rpc = restCalls('rpc/set_source_token')[0]!
    assert.deepEqual(rpc.body, { p_actor_user_id: ADMIN, p_connection_id: CONN, p_token: SECRET })
    assert.equal(clarityCalls().length, 0, 'setarea nu consumă bugetul')
  })
  test('strategist: 403, RPC-ul nu e apelat', async () => {
    const r = await call({ action: 'set_token', connection_id: CONN, token: SECRET }, 'jwt-strategist')
    assert.equal(r.status, 403)
    assert.equal(restCalls('rpc/').length, 0)
  })
  test('utilizator fără niciun rol în tenantul conexiunii: 404 (nu confirmă existența)', async () => {
    state.users['jwt-alt-tenant'] = '30000000-0000-0000-0000-000000000011'
    const r = await call({ action: 'set_token', connection_id: CONN, token: SECRET }, 'jwt-alt-tenant')
    assert.equal(r.status, 404)
    assert.equal(restCalls('rpc/').length, 0)
  })
  test('conexiune inexistentă: 404', async () => {
    state.connection = null
    assert.equal((await call({ action: 'set_token', connection_id: CONN, token: SECRET })).status, 404)
  })
  test('refuzul din corpul funcției SQL (42501) devine 403', async () => {
    state.rpcError = { status: 403, code: '42501' }
    assert.equal((await call({ action: 'set_token', connection_id: CONN, token: SECRET })).status, 403)
  })
  test('token gol respins de SQL (22023): 422', async () => {
    state.rpcError = { status: 400, code: '22023' }
    assert.equal((await call({ action: 'set_token', connection_id: CONN, token: ' ' })).status, 422)
  })
})

describe('validate', () => {
  test('200 de la Clarity: un singur apel, contorizat înainte, status valid, audit', async () => {
    state.callsToday = 3
    const r = await call({ action: 'validate', connection_id: CONN })
    assert.equal(r.status, 200)
    assert.equal(r.body.outcome, 'valid')
    assert.equal(r.body.credential_status, 'valid')
    assert.equal(r.body.calls_today, 4)
    assert.equal(r.body.daily_limit, 10)
    assert.equal(clarityCalls().length, 1)
    assert.equal(new URL(clarityCalls()[0]!.url).searchParams.get('numOfDays'), '1')
    assert.equal(clarityCalls()[0]!.headers.Authorization, `Bearer ${SECRET}`)
    const order = state.calls.map((c) => c.url)
    const counted = order.findIndex((u) => u.endsWith('/rest/v1/provider_api_calls'))
    const called = order.findIndex((u) => u.startsWith('https://www.clarity.ms/'))
    assert.ok(counted >= 0 && counted < called, 'apelul e contorizat înainte de a fi făcut')
    assert.deepEqual(restCalls('provider_api_calls')[1]!.body, {
      tenant_id: T1, brand_id: B1, source_connection_id: CONN, call_date_utc: '2026-10-07',
      purpose: 'validate', calls: 1, actor_user_id: ADMIN,
    })
    const audit = restCalls('audit_events')[0]!.body as Record<string, unknown>
    assert.equal(audit.action, 'credential_validated')
    assert.equal(audit.actor_user_id, ADMIN)
    assert.doesNotMatch(r.text, /CLARITY-SECRET/)
    assert.doesNotMatch(JSON.stringify(audit), /CLARITY-SECRET/)
  })

  for (const status of [401, 403]) {
    test(`${status} de la Clarity: invalid, fără retry`, async () => {
      state.clarityStatus = status
      const r = await call({ action: 'validate', connection_id: CONN })
      assert.equal(r.body.outcome, 'invalid')
      assert.equal(r.body.credential_status, 'invalid')
      assert.equal(clarityCalls().length, 1)
      assert.deepEqual(restCalls('rpc/record_source_validation')[0]!.body, {
        p_connection_id: CONN, p_ok: false, p_error: `HTTP ${status}`,
      })
    })
  }

  test('429 de la Clarity: starea tokenului nu se schimbă', async () => {
    state.clarityStatus = 429
    const r = await call({ action: 'validate', connection_id: CONN })
    assert.equal(r.body.outcome, 'rate_limited')
    assert.equal(r.body.credential_status, 'unverified')
    assert.equal(restCalls('rpc/record_source_validation').length, 0)
  })

  test('5xx sau rețea: starea nu se schimbă, apelul rămâne contorizat', async () => {
    state.clarityStatus = new Error('ECONNRESET')
    const r = await call({ action: 'validate', connection_id: CONN })
    assert.equal(r.body.outcome, 'provider_error')
    assert.equal(r.body.calls_today, 1)
    assert.equal(restCalls('rpc/record_source_validation').length, 0)
  })

  test('buget consumat (10/10): nu citește tokenul, nu apelează Clarity', async () => {
    state.callsToday = 10
    const r = await call({ action: 'validate', connection_id: CONN })
    assert.equal(r.status, 200)
    assert.equal(r.body.outcome, 'budget_exhausted')
    assert.equal(clarityCalls().length, 0)
    assert.equal(restCalls('rpc/get_source_token').length, 0)
  })

  test('strategist: 403, nu consumă bugetul', async () => {
    const r = await call({ action: 'validate', connection_id: CONN }, 'jwt-strategist')
    assert.equal(r.status, 403)
    assert.equal(clarityCalls().length, 0)
  })

  test('conexiune fără token: 409', async () => {
    state.connection = { ...state.connection, credential_status: 'missing' }
    assert.equal((await call({ action: 'validate', connection_id: CONN })).status, 409)
    assert.equal(clarityCalls().length, 0)
  })

  test('furnizor fără validare: 422', async () => {
    state.connection = { ...state.connection, provider: 'ga4' }
    assert.equal((await call({ action: 'validate', connection_id: CONN })).status, 422)
  })
})
