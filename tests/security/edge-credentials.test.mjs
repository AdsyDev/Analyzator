// Atacuri prin HTTP real pe Edge Function source-credentials (Supabase local, `supabase functions serve`).
// Obiective: tokenul în clar nu poate fi obținut; bugetul altui brand nu poate fi consumat.
// Vezi docs/security-tests.md (secțiunea D).
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { API_URL, ANON_KEY, SERVICE_ROLE_KEY, U, T1, B1A, CLARITY_1A, CLARITY_2A, signJwt, userToken, req, asService } from './helpers.mjs'

const FN = '/functions/v1/source-credentials'
const TOKEN_1A = `edge-secret-1a-${Date.now()}`
const TOKEN_2A = `edge-secret-2a-${Date.now()}`
const today = new Date().toISOString().slice(0, 10)

const fn = (body, { token, headers = {} } = {}) =>
  req(FN, { method: 'POST', body, token, headers })

async function tokenOf(connectionId) {
  const res = await asService('rpc/get_source_token', { method: 'POST', body: { p_connection_id: connectionId } })
  return res.status === 200 ? res.json : null
}

async function callsToday(connectionId) {
  const res = await asService(`provider_api_calls?select=calls&source_connection_id=eq.${connectionId}&call_date_utc=eq.${today}`)
  return res.json.reduce((s, r) => s + r.calls, 0)
}

function assertNoSecret(res) {
  const text = JSON.stringify(res.json ?? '')
  assert.doesNotMatch(text, /edge-secret-/, 'tokenul a apărut în răspuns')
}

before(async () => {
  const ready = await fn({}, { token: ANON_KEY })
  assert.notEqual(ready.status, 404, 'Edge Function nu e servită: rulează `supabase functions serve source-credentials`')
  for (const [conn, actor, tok] of [[CLARITY_1A, U.admin1, TOKEN_1A], [CLARITY_2A, U.admin2, TOKEN_2A]]) {
    const r = await asService('rpc/set_source_token', {
      method: 'POST', body: { p_actor_user_id: actor, p_connection_id: conn, p_token: tok },
    })
    assert.equal(r.status, 200)
  }
})

describe('D1. Fără identitate validă de utilizator', () => {
  const cases = [
    ['fără Authorization', undefined],
    ['cheia anon ca Bearer', ANON_KEY],
    ['cheia service role ca Bearer', SERVICE_ROLE_KEY],
    ['JWT semnat cu alt secret (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 }, 'alt-secret-cu-cel-putin-32-de-caractere!!')],
    ['JWT alg none (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 }, '', { alg: 'none', typ: 'JWT' })],
    ['JWT expirat (admin T1)', userToken(U.admin1, { iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 })],
  ]
  for (const [label, token] of cases) {
    test(`${label}: 401, fără efecte`, async () => {
      const before = await callsToday(CLARITY_1A)
      for (const body of [
        { action: 'validate', connection_id: CLARITY_1A },
        { action: 'set_token', connection_id: CLARITY_1A, token: 'atac' },
      ]) {
        const res = await fn(body, { token })
        assert.equal(res.status, 401, `${body.action}: ${res.status}`)
        assertNoSecret(res)
      }
      assert.equal(await callsToday(CLARITY_1A), before)
      assert.equal(await tokenOf(CLARITY_1A), TOKEN_1A)
    })
  }
})

describe('D2. agency_admin din alt tenant (T2) pe conexiunea din T1', () => {
  test('set_token: 404, tokenul T1 neschimbat', async () => {
    const res = await fn({ action: 'set_token', connection_id: CLARITY_1A, token: 'preluat-de-t2' }, { token: userToken(U.admin2) })
    assert.equal(res.status, 404)
    assert.equal(await tokenOf(CLARITY_1A), TOKEN_1A)
  })
  test('validate: 404, nu consumă bugetul brandului 1A, nu întoarce tokenul', async () => {
    const before = await callsToday(CLARITY_1A)
    const res = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token: userToken(U.admin2) })
    assert.equal(res.status, 404)
    assertNoSecret(res)
    assert.equal(await callsToday(CLARITY_1A), before)
  })
  test('claims injectate în JWT (tenant_id, rol) nu schimbă nimic', async () => {
    const token = userToken(U.admin2, { tenant_id: T1, app_metadata: { role: 'agency_admin', tenant_id: T1 } })
    const res = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token })
    assert.equal(res.status, 404)
  })
})

describe('D3. Roluri fără drept în același tenant', () => {
  for (const [label, user] of [['strategist T1', U.strat1], ['account T1', U.account1], ['client T1', U.client1]]) {
    test(`${label}: 403 la set_token și validate, fără efecte`, async () => {
      const before = await callsToday(CLARITY_1A)
      const set = await fn({ action: 'set_token', connection_id: CLARITY_1A, token: 'atac' }, { token: userToken(user) })
      const val = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token: userToken(user) })
      assert.equal(set.status, 403)
      assert.equal(val.status, 403)
      assertNoSecret(set)
      assertNoSecret(val)
      assert.equal(await callsToday(CLARITY_1A), before)
      assert.equal(await tokenOf(CLARITY_1A), TOKEN_1A)
    })
  }

  test('admin T1 cu membership revocat: refuzat', async () => {
    await asService(`memberships?user_id=eq.${U.admin1}`, { method: 'PATCH', body: { revoked_at: new Date().toISOString() } })
    try {
      const res = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token: userToken(U.admin1) })
      assert.ok([403, 404].includes(res.status), `status ${res.status}`)
    } finally {
      await asService(`memberships?user_id=eq.${U.admin1}`, { method: 'PATCH', body: { revoked_at: null } })
    }
  })
})

describe('D4. Intrări malițioase', () => {
  test('connection_id cu filtre PostgREST: 400', async () => {
    for (const id of [`${CLARITY_1A}&tenant_id=neq.x`, `${CLARITY_1A},${CLARITY_2A}`, 'not.is.null', '']) {
      const res = await fn({ action: 'validate', connection_id: id }, { token: userToken(U.admin1) })
      assert.equal(res.status, 400, `"${id}": ${res.status}`)
    }
  })
  test('token prea lung: 422, tokenul existent neschimbat', async () => {
    const res = await fn({ action: 'set_token', connection_id: CLARITY_1A, token: 'x'.repeat(9000) }, { token: userToken(U.admin1) })
    assert.equal(res.status, 422)
    assert.equal(await tokenOf(CLARITY_1A), TOKEN_1A)
  })
  test('acțiune necunoscută (de ex. get_token): 400, nu există cale de citire', async () => {
    for (const action of ['get_token', 'read', 'export', 'status']) {
      const res = await fn({ action, connection_id: CLARITY_1A }, { token: userToken(U.admin1) })
      assert.equal(res.status, 400, action)
      assertNoSecret(res)
    }
  })
  test('GET/PUT/DELETE: 405; CORS fără originea străină reflectată și fără credentials', async () => {
    // Local, gateway-ul (Kong) adaugă Access-Control-Allow-Origin: * pe toate răspunsurile funcțiilor;
    // handler-ul nu setează CORS când ANALYZATOR_APP_ORIGIN lipsește. Cu autentificare prin Bearer
    // (fără cookie-uri), * fără Allow-Credentials nu permite unei pagini străine să acționeze ca utilizator.
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await req(FN, { method, token: userToken(U.admin1), headers: { Origin: 'https://evil.example' } })
      assert.equal(res.status, 405, method)
      assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://evil.example')
      assert.equal(res.headers.get('access-control-allow-credentials'), null)
    }
  })
})

describe('D5. Bugetul de apeluri', () => {
  test('admin T1, validare proprie: răspunsul nu conține tokenul; un apel contorizat pe 1A, nimic pe 2A', async () => {
    const before1A = await callsToday(CLARITY_1A)
    const before2A = await callsToday(CLARITY_2A)
    const res = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token: userToken(U.admin1) })
    assert.equal(res.status, 200)
    assertNoSecret(res)
    assert.equal(res.json.outcome, 'invalid', 'tokenul de test e fals: Clarity îl refuză')
    assert.equal(await callsToday(CLARITY_1A), before1A + 1)
    assert.equal(await callsToday(CLARITY_2A), before2A)
  })

  test('la 10/10: validarea nu apelează Clarity și nu mai contorizează', async () => {
    const used = await callsToday(CLARITY_1A)
    if (used < 10) {
      const r = await asService('provider_api_calls', {
        method: 'POST',
        body: { tenant_id: T1, brand_id: B1A, source_connection_id: CLARITY_1A, call_date_utc: today, purpose: 'collect', calls: 10 - used },
      })
      assert.equal(r.status, 201)
    }
    const res = await fn({ action: 'validate', connection_id: CLARITY_1A }, { token: userToken(U.admin1) })
    assert.equal(res.json.outcome, 'budget_exhausted')
    assert.equal(await callsToday(CLARITY_1A), 10)
  })

  test('bugetul 2A e independent: admin T2 poate valida 2A chiar dacă 1A e la 10/10', async () => {
    const before = await callsToday(CLARITY_2A)
    const res = await fn({ action: 'validate', connection_id: CLARITY_2A }, { token: userToken(U.admin2) })
    assert.equal(res.status, 200)
    assert.notEqual(res.json.outcome, 'budget_exhausted')
    assert.equal(await callsToday(CLARITY_2A), before + 1)
  })
})
