import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, parse, type HandlerDeps } from './handler.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const NEW_USER = '30000000-0000-0000-0000-000000000099'
const EXISTING = '30000000-0000-0000-0000-000000000012'
const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key', appBaseUrl: 'https://app.analyzator.ro/' }

type State = {
  users: Record<string, string>
  admins: Set<string>
  members: Set<string>
  brands: Set<string>
  account: { user_id: string; confirmed: boolean } | null
  inTenant: Set<string>
  inviteStatus: number
  grantError?: { status: number; code: string }
  calls: Array<{ url: string; method: string; body?: Record<string, unknown>; headers: Record<string, string> }>
}

let state: State

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    const method = init.method ?? 'GET'
    state.calls.push({ url, method, body, headers })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const id = state.users[(headers.Authorization ?? '').replace(/^Bearer /, '')]
      return id ? ok({ id }) : ok({ msg: 'invalid' }, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile de administrare folosesc service role')
    if (url.startsWith(`${env.supabaseUrl}/auth/v1/invite`)) {
      return state.inviteStatus === 200 ? ok({ id: NEW_USER, email: body?.email }) : ok({ msg: 'refuzat' }, state.inviteStatus)
    }
    const path = url.slice(`${env.supabaseUrl}/rest/v1/`.length)
    if (path.startsWith('memberships?select=role')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      if (path.includes('role=eq.agency_admin')) return ok(state.admins.has(user) ? [{ role: 'agency_admin' }] : [])
      return ok(state.members.has(user) ? [{ role: 'member' }] : [])
    }
    if (path.startsWith('memberships?select=user_id')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      return ok(state.inTenant.has(user) ? [{ user_id: user }] : [])
    }
    if (path.startsWith('brands?')) {
      const ids = /id=in\.\(([^)]*)\)/.exec(path)?.[1]?.split(',') ?? []
      return ok(ids.filter((id) => state.brands.has(id)).map((id) => ({ id })))
    }
    if (path === 'rpc/tenant_people_for') {
      // Filtrul real e în SQL; aici: doar adminii primesc rânduri.
      return ok(state.admins.has(String(body?.p_actor_user_id)) ? [{ tenant_id: T1, user_id: STRATEGIST, email: 'strategist.t1@test.local', full_name: null, last_sign_in_at: null, extra: 'x' }] : [])
    }
    if (path === 'rpc/find_user_for_invite') return ok(state.account ? [state.account] : [])
    if (path === 'rpc/grant_invited_access') {
      if (state.grantError) return ok({ code: state.grantError.code, message: 'x' }, state.grantError.status)
      return ok('70000000-0000-0000-0000-000000000001')
    }
    throw new Error(`apel neașteptat: ${method} ${url}`)
  }
}

const deps = (): HandlerDeps => ({ env, fetch: fakeFetch() })
const request = (body: unknown, jwt = 'jwt-admin') =>
  new Request('http://fn.test/users', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const valid = (over: Record<string, unknown> = {}) => ({ action: 'invite', tenant_id: T1, email: ' Ana.Noua@Stada.example ', full_name: ' Ana   Nouă ', role: 'client_viewer', brand_ids: [B1, B1], ...over })

beforeEach(() => {
  state = {
    users: { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST },
    admins: new Set([ADMIN]),
    members: new Set([ADMIN, STRATEGIST]),
    brands: new Set([B1]),
    account: null,
    inTenant: new Set(),
    inviteStatus: 200,
    calls: [],
  }
})

describe('users: autentificare și autorizare', () => {
  test('fără sesiune: 401, fără niciun apel cu service role', async () => {
    const res = await handle(new Request('http://fn.test', { method: 'POST', body: '{}' }), deps())
    assert.equal(res.status, 401)
    assert.equal(state.calls.length, 0)
  })

  test('strategist: 403, nicio invitație trimisă', async () => {
    const res = await handle(request(valid(), 'jwt-strategist'), deps())
    assert.equal(res.status, 403)
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/invite') || c.url.includes('rpc/')))
  })

  test('fără niciun rol în tenant: 404, nu confirmă existența clientului', async () => {
    state.members.delete(ADMIN)
    state.admins.delete(ADMIN)
    const res = await handle(request(valid()), deps())
    assert.equal(res.status, 404)
  })

  test('brand din alt client: 422 înainte de orice email', async () => {
    const res = await handle(request(valid({ brand_ids: [B1, B2] })), deps())
    assert.equal(res.status, 422)
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/invite')))
  })

  test('OPTIONS și metode greșite', async () => {
    assert.equal((await handle(new Request('http://fn.test', { method: 'OPTIONS' }), deps())).status, 204)
    assert.equal((await handle(new Request('http://fn.test', { method: 'GET' }), deps())).status, 405)
  })
})

describe('users: identitățile', () => {
  test('actorul autentificat (nu un id din corp) ajunge în tenant_people_for; răspunsul are doar câmpurile din contract', async () => {
    const res = await handle(request({ action: 'identities', p_actor_user_id: STRATEGIST }), deps())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { people: [{ tenant_id: T1, user_id: STRATEGIST, email: 'strategist.t1@test.local', full_name: null, last_sign_in_at: null }] })
    const call = state.calls.find((c) => c.url.endsWith('rpc/tenant_people_for'))!
    assert.deepEqual(call.body, { p_actor_user_id: ADMIN })
  })

  test('strategist: listă goală, fără eroare care să confirme ceva', async () => {
    const res = await handle(request({ action: 'identities' }, 'jwt-strategist'), deps())
    assert.deepEqual(await res.json(), { people: [] })
  })

  test('acțiune necunoscută: 400', async () => {
    assert.equal((await handle(request({ action: 'get_service_key' }), deps())).status, 400)
    assert.equal((await handle(request({ tenant_id: T1 }), deps())).status, 400)
  })
})

describe('users: validare', () => {
  test('normalizează emailul și numele, elimină brandurile duplicate', () => {
    const p = parse(valid())
    assert.equal(p.email, 'ana.noua@stada.example')
    assert.equal(p.fullName, 'Ana Nouă')
    assert.deepEqual(p.brandIds, [B1])
  })

  test('refuză email invalid, rol necunoscut, nume prea lung, branduri care nu sunt uuid', async () => {
    for (const bad of [{ email: 'nu-e-email' }, { email: 'a@b' }, { role: 'superuser' }, { full_name: 'x'.repeat(121) }, { brand_ids: ['b-1'] }, { brand_ids: 'b' }]) {
      const res = await handle(request(valid(bad)), deps())
      assert.equal(res.status, 422, JSON.stringify(bad))
    }
    assert.equal((await handle(request(valid({ tenant_id: 'T1' })), deps())).status, 400)
  })
})

describe('users: invitația', () => {
  test('cont nou: trimite invitația cu linkul spre /login și acordă accesul cu actorul real', async () => {
    const res = await handle(request(valid()), deps())
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'invited', user_id: NEW_USER })
    const invite = state.calls.find((c) => c.url.includes('/auth/v1/invite'))!
    assert.equal(invite.url, `${env.supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent('https://app.analyzator.ro/login')}`)
    assert.deepEqual(invite.body, { email: 'ana.noua@stada.example', data: { full_name: 'Ana Nouă' } })
    const grant = state.calls.find((c) => c.url.endsWith('rpc/grant_invited_access'))!
    assert.deepEqual(grant.body, { p_actor_user_id: ADMIN, p_tenant_id: T1, p_user_id: NEW_USER, p_role: 'client_viewer', p_brand_ids: [B1] })
  })

  test('cont activ existent: doar accesul, fără email', async () => {
    state.account = { user_id: EXISTING, confirmed: true }
    const res = await handle(request(valid({ role: 'strategist' })), deps())
    assert.deepEqual(await res.json(), { status: 'access_granted', user_id: EXISTING })
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/invite')))
  })

  test('cont neactivat: invitația se retrimite', async () => {
    state.account = { user_id: NEW_USER, confirmed: false }
    const res = await handle(request(valid()), deps())
    assert.deepEqual(await res.json(), { status: 'invited', user_id: NEW_USER })
  })

  test('persoana activă e deja în lista clientului: 409, fără email și fără scriere', async () => {
    state.account = { user_id: EXISTING, confirmed: true }
    state.inTenant.add(EXISTING)
    const res = await handle(request(valid()), deps())
    assert.equal(res.status, 409)
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/invite') || c.url.endsWith('rpc/grant_invited_access')))
  })

  test('persoana din listă care nu și-a activat contul: invitația se retrimite, accesul rămâne neschimbat', async () => {
    state.account = { user_id: NEW_USER, confirmed: false }
    state.inTenant.add(NEW_USER)
    const res = await handle(request(valid({ role: 'agency_admin' })), deps())
    assert.deepEqual(await res.json(), { status: 'resent', user_id: NEW_USER })
    assert.ok(state.calls.some((c) => c.url.includes('/auth/v1/invite')))
    assert.ok(!state.calls.some((c) => c.url.endsWith('rpc/grant_invited_access')), 'retrimiterea nu schimbă rolul')
  })

  test('limita de emailuri la GoTrue: 429 cu mesaj clar', async () => {
    state.inviteStatus = 429
    const res = await handle(request(valid()), deps())
    assert.equal(res.status, 429)
  })

  test('refuzul din SQL (rol pierdut între timp) devine 403; detaliile bazei de date nu ajung în răspuns', async () => {
    state.grantError = { status: 403, code: '42501' }
    const res = await handle(request(valid()), deps())
    assert.equal(res.status, 403)
    const text = JSON.stringify(await res.json())
    assert.ok(!text.includes('service-key') && !text.includes('42501'))
  })
})
