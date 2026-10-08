import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type HandlerDeps } from './handler.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const CLIENT = '30000000-0000-0000-0000-000000000004'
const ADMIN_T2 = '30000000-0000-0000-0000-000000000011'
const NEW_USER = '30000000-0000-0000-0000-000000000099'
const T1 = '10000000-0000-0000-0000-000000000001'
const B1A = '20000000-0000-0000-0000-000000000011'
const B1B = '20000000-0000-0000-0000-000000000012'
const B2A = '20000000-0000-0000-0000-000000000021'
const MEMBERSHIP = '60000000-0000-0000-0000-000000000001'
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key' }

type State = {
  users: Record<string, string> // jwt → user id
  roles: Record<string, string> // `${tenant}:${user}` → rol (membri activi)
  tenantBrands: Set<string> // branduri active din T1
  authInvite: { status: number; body: Record<string, unknown> }
  existingMemberships: Set<string> // utilizatori cu membership oriunde (pentru compensare)
  rpcError?: { status: number; code: string }
  calls: Array<{ url: string; method: string; body?: unknown; headers: Record<string, string> }>
}

let state: State

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const method = init.method ?? 'GET'
    state.calls.push({ url, method, body, headers })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const jwt = (headers.Authorization ?? '').replace(/^Bearer /, '')
      const id = state.users[jwt]
      return id ? ok({ id }) : ok({ msg: 'invalid' }, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile privilegiate folosesc service role')
    if (url.startsWith(`${env.supabaseUrl}/auth/v1/invite`)) return ok(state.authInvite.body, state.authInvite.status)
    if (url.startsWith(`${env.supabaseUrl}/auth/v1/admin/users/`)) return new Response('{}', { status: 200 })

    const path = url.slice(`${env.supabaseUrl}/rest/v1/`.length)
    if (path.startsWith('memberships?')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      const tenant = /tenant_id=eq\.([0-9a-f-]+)/.exec(path)?.[1]
      if (!tenant) return ok(state.existingMemberships.has(user) ? [{ id: 'm' }] : [])
      const role = state.roles[`${tenant}:${user}`]
      if (path.includes('role=eq.agency_admin')) return ok(role === 'agency_admin' ? [{ role }] : [])
      return ok(role ? [{ role }] : [])
    }
    if (path.startsWith('brands?')) {
      assert.match(path, new RegExp(`tenant_id=eq\\.${T1}`), 'brandurile se caută cu tenant_id explicit')
      const ids = /id=in\.\(([^)]*)\)/.exec(path)?.[1]?.split(',') ?? []
      return ok(ids.filter((i) => state.tenantBrands.has(i)).map((id) => ({ id })))
    }
    if (path.startsWith('rpc/') && state.rpcError) {
      return ok({ code: state.rpcError.code, message: 'x' }, state.rpcError.status)
    }
    if (path === 'rpc/invite_user_grant') return ok(MEMBERSHIP)
    if (path === 'rpc/list_tenant_people') {
      return ok([{ user_id: ADMIN, email: 'admin.t1@test.local', full_name: 'Ana', invited_at: null, last_sign_in_at: null }])
    }
    throw new Error(`neașteptat: ${method} ${url}`)
  }
}

async function call(body: unknown, jwt: string | null = 'jwt-admin') {
  const req = new Request('http://fn.test/invite-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })
  const res = await handle(req, { env, fetch: fakeFetch() })
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text }
}

const valid = { action: 'invite', email: 'Nou@Exemplu.RO ', tenant_id: T1, role: 'strategist', brand_ids: [B1A] }
const authCalls = () => state.calls.filter((c) => c.url.includes('/auth/v1/invite'))
const rpcCalls = (name: string) => state.calls.filter((c) => c.url.endsWith(`/rest/v1/rpc/${name}`))
const deletes = () => state.calls.filter((c) => c.method === 'DELETE')

beforeEach(() => {
  state = {
    users: { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST, 'jwt-client': CLIENT, 'jwt-admin-t2': ADMIN_T2 },
    roles: {
      [`${T1}:${ADMIN}`]: 'agency_admin',
      [`${T1}:${STRATEGIST}`]: 'strategist',
      [`${T1}:${CLIENT}`]: 'client_viewer',
      [`10000000-0000-0000-0000-000000000002:${ADMIN_T2}`]: 'agency_admin',
    },
    tenantBrands: new Set([B1A, B1B]),
    authInvite: { status: 200, body: { id: NEW_USER, email: 'nou@exemplu.ro' } },
    existingMemberships: new Set(),
    calls: [],
  }
})

describe('autentificare și autorizare', () => {
  test('fără JWT: 401', async () => {
    assert.equal((await call(valid, null)).status, 401)
  })
  test('cheia service role folosită ca Bearer: 401, fără efecte', async () => {
    const r = await call(valid, 'service-key')
    assert.equal(r.status, 401)
    assert.equal(authCalls().length, 0)
  })
  test('tenant_id invalid (filtre PostgREST): 400, fără query', async () => {
    const r = await call({ ...valid, tenant_id: `${T1}&role=neq.x` })
    assert.equal(r.status, 400)
    assert.equal(state.calls.filter((c) => c.url.includes('/rest/')).length, 0)
  })
  for (const [name, jwt] of [['strategist', 'jwt-strategist'], ['client_viewer', 'jwt-client']] as const) {
    test(`${name}: 403, nu se trimite invitația`, async () => {
      const r = await call(valid, jwt)
      assert.equal(r.status, 403)
      assert.equal(authCalls().length, 0)
      assert.equal(rpcCalls('invite_user_grant').length, 0)
    })
  }
  test('admin al altui tenant (fără rol în T1): 404, nu se trimite invitația', async () => {
    const r = await call(valid, 'jwt-admin-t2')
    assert.equal(r.status, 404)
    assert.equal(authCalls().length, 0)
    assert.equal(rpcCalls('invite_user_grant').length, 0)
  })
  test('admin T2 nu poate lista persoanele din T1', async () => {
    const r = await call({ action: 'people', tenant_id: T1 }, 'jwt-admin-t2')
    assert.equal(r.status, 404)
    assert.equal(rpcCalls('list_tenant_people').length, 0)
  })
  test('strategist nu poate lista persoanele: 403', async () => {
    assert.equal((await call({ action: 'people', tenant_id: T1 }, 'jwt-strategist')).status, 403)
  })
  test('autorizarea precede validarea: un non-admin cu e-mail invalid primește tot 403', async () => {
    assert.equal((await call({ ...valid, email: 'x' }, 'jwt-strategist')).status, 403)
  })
  test('acțiune necunoscută: 400; GET: 405', async () => {
    assert.equal((await call({ action: 'delete', tenant_id: T1 })).status, 400)
    const res = await handle(new Request('http://fn.test/x'), { env, fetch: fakeFetch() })
    assert.equal(res.status, 405)
  })
})

describe('validare (422, nimic trimis)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['e-mail invalid', { email: 'nu-e-email' }],
    ['e-mail lipsă', { email: undefined }],
    ['e-mail cu două adrese', { email: 'a@b.ro, c@d.ro' }],
    ['rol invalid', { role: 'superadmin' }],
    ['strategist fără brand', { brand_ids: [] }],
    ['account fără brand', { role: 'account', brand_ids: undefined }],
    ['client_viewer fără brand', { role: 'client_viewer', brand_ids: [] }],
    ['agency_admin cu branduri', { role: 'agency_admin', brand_ids: [B1A] }],
    ['brand_ids nu e listă', { brand_ids: B1A }],
    ['brand_ids cu valoare ne-UUID', { brand_ids: [`${B1A}),tenant_id.neq.(x`] }],
    ['brand din alt tenant', { brand_ids: [B2A] }],
    ['un brand bun și unul din alt tenant', { brand_ids: [B1A, B2A] }],
    ['brand inexistent', { brand_ids: ['20000000-0000-0000-0000-0000000000ff'] }],
  ]
  for (const [name, patch] of cases) {
    test(name, async () => {
      const r = await call({ ...valid, ...patch })
      assert.equal(r.status, 422, r.text)
      assert.equal(authCalls().length, 0, 'nu se trimite e-mail')
      assert.equal(rpcCalls('invite_user_grant').length, 0)
    })
  }
})

describe('invite', () => {
  test('strategist cu un brand: invitație, apoi RPC atomic cu actorul și datele normalizate', async () => {
    const r = await call(valid)
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.body, {
      tenant_id: T1, user_id: NEW_USER, membership_id: MEMBERSHIP, email: 'nou@exemplu.ro', role: 'strategist', brand_ids: [B1A],
    })
    assert.deepEqual(authCalls()[0]!.body, { email: 'nou@exemplu.ro' })
    assert.deepEqual(rpcCalls('invite_user_grant')[0]!.body, {
      p_actor_user_id: ADMIN, p_tenant_id: T1, p_invited_user_id: NEW_USER, p_role: 'strategist', p_brand_ids: [B1A],
    })
    const order = state.calls.map((c) => c.url)
    assert.ok(
      order.findIndex((u) => u.includes('/auth/v1/invite')) < order.findIndex((u) => u.endsWith('rpc/invite_user_grant')),
    )
    assert.equal(deletes().length, 0)
  })
  test('brand_ids duplicate se deduplică; agency_admin fără branduri e acceptat', async () => {
    const r = await call({ ...valid, brand_ids: [B1A, B1A.toUpperCase(), B1B] })
    assert.deepEqual((r.body.brand_ids as string[]).sort(), [B1A, B1B])
    const a = await call({ ...valid, role: 'agency_admin', brand_ids: [] })
    assert.equal(a.status, 200)
  })
  test('redirect_to din configurare ajunge la Auth', async () => {
    const res = await handle(
      new Request('http://fn.test/x', {
        method: 'POST',
        headers: { Authorization: 'Bearer jwt-admin' },
        body: JSON.stringify(valid),
      }),
      { env: { ...env, inviteRedirectTo: 'https://app.test/login' }, fetch: fakeFetch() },
    )
    assert.equal(res.status, 200)
    assert.match(authCalls()[0]!.url, /redirect_to=https%3A%2F%2Fapp\.test%2Flogin/)
  })
  test('e-mail deja înregistrat (Auth 422 email_exists): 409, fără membership', async () => {
    state.authInvite = { status: 422, body: { error_code: 'email_exists', msg: 'x' } }
    const r = await call(valid)
    assert.equal(r.status, 409)
    assert.equal(rpcCalls('invite_user_grant').length, 0)
    assert.equal(deletes().length, 0)
  })
  test('limita de e-mailuri (429) și eroare Auth (500): 429 / 502, fără membership', async () => {
    state.authInvite = { status: 429, body: { error_code: 'over_email_send_rate_limit' } }
    assert.equal((await call(valid)).status, 429)
    state.authInvite = { status: 500, body: {} }
    assert.equal((await call(valid)).status, 502)
    assert.equal(rpcCalls('invite_user_grant').length, 0)
  })
  test('eșec SQL: utilizatorul creat de invitație se șterge, fără rol rămas', async () => {
    state.rpcError = { status: 400, code: '23503' }
    const r = await call(valid)
    assert.equal(r.status, 422)
    assert.equal(deletes().length, 1)
    assert.ok(deletes()[0]!.url.endsWith(`/auth/v1/admin/users/${NEW_USER}`))
  })
  test('eșec SQL 42501 și 23505: 403 / 409, cu compensare', async () => {
    state.rpcError = { status: 403, code: '42501' }
    assert.equal((await call(valid)).status, 403)
    state.rpcError = { status: 409, code: '23505' }
    assert.equal((await call(valid)).status, 409)
    assert.equal(deletes().length, 2)
  })
  test('eșec SQL neașteptat: 500 generic, fără e-mail în răspuns', async () => {
    state.rpcError = { status: 500, code: 'XX000' }
    const r = await call(valid)
    assert.equal(r.status, 500)
    assert.doesNotMatch(r.text, /exemplu/)
  })
  test('eșec SQL pentru un utilizator care are deja membership în alt tenant: contul NU se șterge', async () => {
    state.rpcError = { status: 400, code: '23503' }
    state.existingMemberships.add(NEW_USER)
    await call(valid)
    assert.equal(deletes().length, 0)
  })
})

describe('people', () => {
  test('admin: lista cu nume și email', async () => {
    const r = await call({ action: 'people', tenant_id: T1 })
    assert.equal(r.status, 200)
    assert.deepEqual(rpcCalls('list_tenant_people')[0]!.body, { p_actor_user_id: ADMIN, p_tenant_id: T1 })
    assert.equal((r.body.people as unknown[]).length, 1)
  })
})
