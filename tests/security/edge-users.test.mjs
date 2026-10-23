// Utilizatori (E-4): identitatea persoanelor și invitarea prin HTTP real, pe Supabase local (funcția server `users`).
// Obiective: emailurile nu se citesc în afara tenantului sau fără rol de agency_admin; invitația nu poate fi folosită
// pentru alt client, alt brand sau de alt rol; funcțiile SQL de service nu sunt apelabile din client.
// Vezi docs/security-tests.md (excepția E10 și secțiunea H).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { API_URL, ANON_KEY, SERVICE_ROLE_KEY, U, T1, T2, B1A, B2A, userToken, req, rest, asService } from './helpers.mjs'

const FN = '/functions/v1/users'
const RUN = Date.now()
const NEW_EMAIL = `invitat-${RUN}@test.local`
const ACTIVE_EMAIL = `activ-${RUN}@test.local`
const created = new Set()

const call = (body, token) => req(FN, { method: 'POST', body, token })
const invite = (body, token) => call({ action: 'invite', ...body }, token)
const people = async (token) => {
  const r = await call({ action: 'identities' }, token)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  return r.json.people
}
const admin = (path, init = {}) =>
  fetch(`${API_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  })

async function accountId(email) {
  const r = await asService('rpc/find_user_for_invite', { method: 'POST', body: { p_email: email } })
  assert.equal(r.status, 200)
  return r.json[0]?.user_id ?? null
}

before(async () => {
  // `supabase functions serve` pornește toate funcțiile; prima cerere poate găsi runtime-ul încă pornind.
  let status = 0
  for (let i = 0; i < 45; i++) {
    status = (await call({ action: 'identities' }, ANON_KEY)).status
    if (status === 401) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  assert.equal(status, 401, 'Edge Function users nu e servită: rulează `supabase functions serve`')
  const r = await admin('users', { method: 'POST', body: JSON.stringify({ email: ACTIVE_EMAIL, email_confirm: true, user_metadata: { full_name: 'Cont Activ' } }) })
  assert.equal(r.status, 200)
  created.add((await r.json()).id)
})

after(async () => {
  for (const id of created) {
    await asService(`brand_access?user_id=eq.${id}`, { method: 'DELETE' })
    await asService(`memberships?user_id=eq.${id}`, { method: 'DELETE' })
    await admin(`users/${id}`, { method: 'DELETE' })
  }
})

describe('H1. Numele și emailurile persoanelor', () => {
  test('agency_admin T1 vede emailurile din T1 și nimic din T2', async () => {
    const list = await people(userToken(U.admin1))
    assert.ok(list.length >= 5)
    assert.ok(list.every((p) => p.tenant_id === T1))
    assert.equal(list.find((p) => p.user_id === U.strat1)?.email, 'strategist.t1@test.local')
    assert.ok(!list.some((p) => p.email === 'admin.t2@test.local' || p.email === 'strategist.t2@test.local'))
  })

  test('agency_admin T2 vede doar T2', async () => {
    const list = await people(userToken(U.admin2))
    assert.ok(list.length > 0 && list.every((p) => p.tenant_id === T2))
  })

  test('strategist, account și client_viewer primesc o listă goală', async () => {
    for (const u of [U.strat1, U.account1, U.client1, U.clientNone]) assert.deepEqual(await people(userToken(u)), [], u)
  })

  test('fără sesiune, cu cheia anon sau cu un JWT semnat greșit: 401', async () => {
    assert.equal((await call({ action: 'identities' })).status, 401)
    assert.equal((await call({ action: 'identities' }, ANON_KEY)).status, 401)
    assert.equal((await call({ action: 'identities' }, `${userToken(U.admin1).slice(0, -4)}AAAA`)).status, 401)
  })

  test('funcțiile SQL de service nu sunt apelabile din client, nici de agency_admin', async () => {
    const token = userToken(U.admin1)
    const direct = await rest('rpc/tenant_people_for', { method: 'POST', body: { p_actor_user_id: U.admin2 }, token })
    assert.ok([401, 403, 404].includes(direct.status), `tenant_people_for: ${direct.status}`)
    const find = await rest('rpc/find_user_for_invite', { method: 'POST', body: { p_email: 'admin.t2@test.local' }, token })
    assert.ok([401, 403, 404].includes(find.status), `find_user_for_invite: ${find.status}`)
    const grant = await rest('rpc/grant_invited_access', {
      method: 'POST', token,
      body: { p_actor_user_id: U.admin1, p_tenant_id: T1, p_user_id: U.strat2, p_role: 'agency_admin', p_brand_ids: [] },
    })
    assert.ok([401, 403, 404].includes(grant.status), `grant_invited_access: ${grant.status}`)
    const m = await asService(`memberships?select=user_id&tenant_id=eq.${T1}&user_id=eq.${U.strat2}`)
    assert.deepEqual(m.json, [])
  })
})

describe('H2. Invitarea din aplicație', () => {
  test('fără sesiune sau cu cheia anon: 401', async () => {
    assert.equal((await invite({ tenant_id: T1, email: NEW_EMAIL, role: 'client_viewer', brand_ids: [] })).status, 401)
    assert.equal((await invite({ tenant_id: T1, email: NEW_EMAIL, role: 'client_viewer', brand_ids: [] }, ANON_KEY)).status, 401)
  })

  test('strategist, client și adminul altui tenant nu pot invita; niciun cont nu se creează', async () => {
    const body = { tenant_id: T1, email: NEW_EMAIL, role: 'agency_admin', brand_ids: [] }
    assert.equal((await invite(body, userToken(U.strat1))).status, 403)
    assert.equal((await invite(body, userToken(U.client1))).status, 403)
    assert.equal((await invite(body, userToken(U.admin2))).status, 404)
    assert.equal(await accountId(NEW_EMAIL), null)
  })

  test('un brand din alt tenant e refuzat înainte de email', async () => {
    const r = await invite({ tenant_id: T1, email: NEW_EMAIL, role: 'client_viewer', brand_ids: [B1A, B2A] }, userToken(U.admin1))
    assert.equal(r.status, 422)
    assert.equal(await accountId(NEW_EMAIL), null)
  })

  test('agency_admin T1 invită o persoană nouă: cont, rol, brand, audit cu actorul real', async () => {
    const r = await invite({ tenant_id: T1, email: NEW_EMAIL, full_name: 'Ana Invitată', role: 'client_viewer', brand_ids: [B1A] }, userToken(U.admin1))
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.status, 'invited')
    created.add(r.json.user_id)
    const id = r.json.user_id
    assert.equal(await accountId(NEW_EMAIL), id)

    const m = await asService(`memberships?select=role,revoked_at&tenant_id=eq.${T1}&user_id=eq.${id}`)
    assert.deepEqual(m.json, [{ role: 'client_viewer', revoked_at: null }])
    const ba = await asService(`brand_access?select=brand_id,granted_by&user_id=eq.${id}`)
    assert.deepEqual(ba.json, [{ brand_id: B1A, granted_by: U.admin1 }])
    const audit = await asService(`audit_events?select=actor_user_id,actor_type&action=eq.user_invited&after->>user_id=eq.${id}`)
    assert.deepEqual(audit.json, [{ actor_user_id: U.admin1, actor_type: 'user' }])

    const seen = await people(userToken(U.admin1))
    assert.deepEqual(seen.filter((p) => p.user_id === id).map((p) => [p.email, p.full_name, p.last_sign_in_at]), [[NEW_EMAIL, 'Ana Invitată', null]])
    assert.ok(!(await people(userToken(U.admin2))).some((p) => p.user_id === id), 'persoana invitată în T1 nu apare în T2')
  })

  test('un cont activ primește doar accesul, fără invitație', async () => {
    const r = await invite({ tenant_id: T2, email: ACTIVE_EMAIL, role: 'strategist', brand_ids: [B2A] }, userToken(U.admin2))
    assert.equal(r.status, 200, JSON.stringify(r.json))
    assert.equal(r.json.status, 'access_granted')
    const m = await asService(`memberships?select=tenant_id,role&user_id=eq.${r.json.user_id}`)
    assert.deepEqual(m.json, [{ tenant_id: T2, role: 'strategist' }])
  })

  test('același cont activ invitat din nou în T2: 409, rolul rămâne, fără al doilea rând', async () => {
    const r = await invite({ tenant_id: T2, email: ACTIVE_EMAIL.toUpperCase(), role: 'agency_admin', brand_ids: [] }, userToken(U.admin2))
    assert.equal(r.status, 409)
    const m = await asService(`memberships?select=role&user_id=eq.${await accountId(ACTIVE_EMAIL)}`)
    assert.deepEqual(m.json, [{ role: 'strategist' }])
  })
})
