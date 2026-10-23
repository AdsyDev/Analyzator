import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, parse, parseAccount, type HandlerDeps } from './handler.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const NEW_USER = '30000000-0000-0000-0000-000000000099'
const EXISTING = '30000000-0000-0000-0000-000000000012'
const TEMP_USER = '30000000-0000-0000-0000-000000000098'
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
  /** Conturile cu marcajul `must_change_password` (parolă temporară). */
  temporary: Set<string>
  createResponse: { status: number; error_code?: string }
  passwordResponse: { status: number; error_code?: string }
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
      if (!id) return ok({ msg: 'invalid' }, 401)
      if (method === 'PUT') {
        const r = state.passwordResponse
        return r.status === 200 ? ok({ id }) : ok({ code: r.status, error_code: r.error_code, msg: 'refuzat' }, r.status)
      }
      return ok({ id, app_metadata: { provider: 'email', ...(state.temporary.has(id) ? { must_change_password: true } : {}) } })
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile de administrare folosesc service role')
    if (url === `${env.supabaseUrl}/auth/v1/admin/users` && method === 'POST') {
      const r = state.createResponse
      return r.status === 200 ? ok({ id: NEW_USER, email: body?.email }) : ok({ code: r.status, error_code: r.error_code, msg: 'refuzat' }, r.status)
    }
    if (url.startsWith(`${env.supabaseUrl}/auth/v1/admin/users/`)) {
      const id = url.slice(`${env.supabaseUrl}/auth/v1/admin/users/`.length)
      if (method === 'PUT') {
        if ((body?.app_metadata as Record<string, unknown> | undefined)?.must_change_password === null) state.temporary.delete(id)
        return ok({ id })
      }
      if (method === 'DELETE') return ok({})
    }
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
    users: { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST, 'jwt-temp': TEMP_USER },
    admins: new Set([ADMIN]),
    members: new Set([ADMIN, STRATEGIST]),
    brands: new Set([B1]),
    account: null,
    inTenant: new Set(),
    inviteStatus: 200,
    temporary: new Set([TEMP_USER]),
    createResponse: { status: 200 },
    passwordResponse: { status: 200 },
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
    assert.deepEqual(await res.json(), { people: [{ tenant_id: T1, user_id: STRATEGIST, email: 'strategist.t1@test.local', full_name: null, last_sign_in_at: null, temporary_password: false }] })
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

const TEMP_PASSWORD = 'Temporar#2026'
const account = (over: Record<string, unknown> = {}) => ({ ...valid(), action: 'create', password: TEMP_PASSWORD, ...over })
const created = () => state.calls.filter((c) => c.url === `${env.supabaseUrl}/auth/v1/admin/users` && c.method === 'POST')

describe('users: contul creat direct (E-5)', () => {
  test('cont nou: activ, fără email, cu marcajul de schimbare; accesul cu auditul user_created; parola nu apare în răspuns', async () => {
    const res = await handle(request(account()), deps())
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.deepEqual(JSON.parse(text), { status: 'created', user_id: NEW_USER })
    assert.ok(!text.includes(TEMP_PASSWORD))
    assert.deepEqual(created().map((c) => c.body), [
      { email: 'ana.noua@stada.example', password: TEMP_PASSWORD, email_confirm: true, user_metadata: { full_name: 'Ana Nouă' }, app_metadata: { must_change_password: true } },
    ])
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/invite')), 'fără email de invitație')
    const grant = state.calls.find((c) => c.url.endsWith('rpc/grant_invited_access'))!
    assert.deepEqual(grant.body, { p_actor_user_id: ADMIN, p_tenant_id: T1, p_user_id: NEW_USER, p_role: 'client_viewer', p_brand_ids: [B1], p_audit_action: 'user_created' })
  })

  test('orice cont existent (activ sau invitat): 409, fără creare și fără schimbarea parolei', async () => {
    for (const confirmed of [true, false]) {
      state.calls = []
      state.account = { user_id: EXISTING, confirmed }
      const res = await handle(request(account()), deps())
      assert.equal(res.status, 409, `confirmed=${confirmed}`)
      assert.equal(created().length, 0)
      assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/admin/users/') || c.url.endsWith('rpc/grant_invited_access')))
    }
  })

  test('strategist (403), adminul altui client (404), brand străin (422), parolă scurtă (422): niciun cont creat', async () => {
    assert.equal((await handle(request(account(), 'jwt-strategist'), deps())).status, 403)
    assert.equal((await handle(request(account({ brand_ids: [B1, B2] })), deps())).status, 422)
    const short = await handle(request(account({ password: 'scurta1' })), deps())
    assert.equal(short.status, 422)
    assert.equal(((await short.json()) as { code?: string }).code, 'weak_password')
    state.members.delete(ADMIN)
    state.admins.delete(ADMIN)
    assert.equal((await handle(request(account()), deps())).status, 404)
    assert.equal(created().length, 0)
  })

  test('validarea parolei: fără normalizare, cel mult 72 de octeți, fără caractere de control', () => {
    assert.equal(parseAccount(account({ password: '  cu spații  ' })).password, '  cu spații  ')
    assert.throws(() => parseAccount(account({ password: 'ă'.repeat(37) })))
    assert.throws(() => parseAccount(account({ password: 'parola\nlunga' })))
    assert.throws(() => parseAccount(account({ password: 12345678 })))
  })

  test('GoTrue: adresa apărută între timp (409), parolă refuzată de politică (422 weak_password)', async () => {
    state.createResponse = { status: 422, error_code: 'email_exists' }
    assert.equal((await handle(request(account()), deps())).status, 409)
    state.createResponse = { status: 422, error_code: 'weak_password' }
    const weak = await handle(request(account()), deps())
    assert.equal(weak.status, 422)
    assert.equal(((await weak.json()) as { code?: string }).code, 'weak_password')
    assert.ok(!state.calls.some((c) => c.url.endsWith('rpc/grant_invited_access')))
  })

  test('accesul refuzat în SQL după creare: contul creat se șterge, eroarea rămâne', async () => {
    state.grantError = { status: 403, code: '42501' }
    const res = await handle(request(account()), deps())
    assert.equal(res.status, 403)
    assert.ok(state.calls.some((c) => c.method === 'DELETE' && c.url === `${env.supabaseUrl}/auth/v1/admin/users/${NEW_USER}`))
  })
})

describe('users: schimbarea parolei temporare', () => {
  const change = (password: unknown, jwt = 'jwt-temp') => handle(request({ action: 'change_temporary_password', password }, jwt), deps())

  test('cu marcaj: parola se schimbă cu sesiunea persoanei, apoi marcajul se șterge cu service role', async () => {
    const res = await change('ParolaMea#Noua1')
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { status: 'password_changed' })
    const put = state.calls.findIndex((c) => c.method === 'PUT' && c.url === `${env.supabaseUrl}/auth/v1/user`)
    const clear = state.calls.findIndex((c) => c.method === 'PUT' && c.url === `${env.supabaseUrl}/auth/v1/admin/users/${TEMP_USER}`)
    assert.ok(put >= 0 && clear > put, 'întâi parola, apoi marcajul')
    assert.equal(state.calls[put]!.headers.Authorization, 'Bearer jwt-temp', 'schimbarea folosește sesiunea persoanei, nu service role')
    assert.deepEqual(state.calls[put]!.body, { password: 'ParolaMea#Noua1' })
    assert.deepEqual(state.calls[clear]!.body, { app_metadata: { must_change_password: null } })
    assert.ok(!state.temporary.has(TEMP_USER))
  })

  test('fără marcaj: 409 not_temporary, nicio schimbare (nu ocolește „Am uitat parola”)', async () => {
    const res = await change('ParolaMea#Noua1', 'jwt-admin')
    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { code?: string }).code, 'not_temporary')
    assert.ok(!state.calls.some((c) => c.method === 'PUT'))
  })

  test('aceeași parolă ca cea temporară: 422 same_password, marcajul rămâne', async () => {
    state.passwordResponse = { status: 422, error_code: 'same_password' }
    const res = await change(TEMP_PASSWORD)
    assert.equal(res.status, 422)
    assert.equal(((await res.json()) as { code?: string }).code, 'same_password')
    assert.ok(state.temporary.has(TEMP_USER))
    assert.ok(!state.calls.some((c) => c.url.includes('/auth/v1/admin/users/')))
  })

  test('parolă prea scurtă: 422 înainte de GoTrue; sesiune refuzată de GoTrue: 401 session_expired, marcajul rămâne', async () => {
    assert.equal((await change('scurta')).status, 422)
    assert.ok(!state.calls.some((c) => c.method === 'PUT'))
    state.passwordResponse = { status: 403 }
    const res = await change('ParolaMea#Noua1')
    assert.equal(res.status, 401)
    assert.equal(((await res.json()) as { code?: string }).code, 'session_expired')
    assert.ok(state.temporary.has(TEMP_USER))
  })
})
