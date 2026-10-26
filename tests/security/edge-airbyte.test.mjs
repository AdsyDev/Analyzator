// Atacuri prin HTTP real pe Edge Function airbyte (E-6; Supabase local, `supabase functions serve`).
// Obiective: connection string-ul nu iese din funcție; doar agency_admin al clientului inspectează; funcția nu se
// conectează la adrese interne (SSRF), nici fără TLS. Vezi docs/security-tests.md (secțiunea I).
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { ANON_KEY, SERVICE_ROLE_KEY, U, T1, signJwt, userToken, req, asService } from './helpers.mjs'

const FN = '/functions/v1/airbyte'
const CONN = '50000000-0000-0000-0000-0000000000a1'
const PASSWORD = `airbyte-secret-${Date.now()}`
const today = new Date().toISOString().slice(0, 10)

const fn = (body, { token } = {}) => req(FN, { method: 'POST', body, token })
const inspect = (token) => fn({ action: 'inspect', connection_id: CONN }, { token })

async function setDsn(dsn) {
  const r = await asService('rpc/set_source_token', { method: 'POST', body: { p_actor_user_id: U.admin1, p_connection_id: CONN, p_token: dsn } })
  assert.equal(r.status, 200, JSON.stringify(r.json))
}

async function inspections() {
  const res = await asService(`provider_api_calls?select=calls&source_connection_id=eq.${CONN}&call_date_utc=eq.${today}`)
  return res.json.reduce((s, r) => s + r.calls, 0)
}

async function credentialStatus() {
  const res = await asService(`source_connections?select=credential_status&id=eq.${CONN}`)
  return res.json[0]?.credential_status
}

function assertNoSecret(res) {
  assert.doesNotMatch(JSON.stringify(res.json ?? ''), /airbyte-secret-/, 'parola a apărut în răspuns')
}

before(async () => {
  const ready = await fn({}, { token: ANON_KEY })
  assert.notEqual(ready.status, 404, 'Edge Function nu e servită: rulează `supabase functions serve`')
  const conn = await asService('source_connections', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: { id: CONN, tenant_id: T1, brand_id: null, provider: 'airbyte_postgres', external_account_id: 'airbyte-security-test', display_name: 'Airbyte (test)' },
  })
  assert.ok(conn.status === 201 || conn.status === 409, JSON.stringify(conn.json))
  await setDsn(`postgresql://analyzator_ro:${PASSWORD}@localhost:54322/postgres?sslmode=require`)
})

describe('I1. Fără identitate validă de utilizator', () => {
  const exp = Math.floor(Date.now() / 1000) + 600
  const cases = [
    ['fără Authorization', undefined],
    ['cheia anon ca Bearer', ANON_KEY],
    ['cheia service role ca Bearer', SERVICE_ROLE_KEY],
    ['JWT semnat cu alt secret (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp }, 'alt-secret-cu-cel-putin-32-de-caractere!!')],
    ['JWT alg none (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp }, '', { alg: 'none', typ: 'JWT' })],
  ]
  for (const [label, token] of cases) {
    test(`${label}: 401, fără inspecție`, async () => {
      const before = await inspections()
      const res = await inspect(token)
      assert.equal(res.status, 401)
      assertNoSecret(res)
      assert.equal(await inspections(), before)
    })
  }
})

describe('I2. Roluri și tenanturi', () => {
  test('agency_admin din alt tenant (T2): 404, nu consumă limita, nu atinge credențiala', async () => {
    const before = await inspections()
    const res = await inspect(userToken(U.admin2))
    assert.equal(res.status, 404)
    assertNoSecret(res)
    assert.equal(await inspections(), before)
  })
  test('strateg în același tenant (fără agency_admin): 403', async () => {
    const res = await inspect(userToken(U.strat1))
    assert.equal(res.status, 403)
    assertNoSecret(res)
  })
  test('connection_id cu filtru PostgREST injectat: 400', async () => {
    const res = await fn({ action: 'inspect', connection_id: `${CONN}&tenant_id=neq.x` }, { token: userToken(U.admin1) })
    assert.equal(res.status, 400)
  })
})

describe('I3. SSRF și TLS: funcția nu se conectează la adrese interne și nici fără criptare', () => {
  const cases = [
    ['localhost (baza Supabase locală)', `postgresql://analyzator_ro:${PASSWORD}@localhost:54322/postgres?sslmode=require`, 'host_not_allowed'],
    ['serviciul intern din rețeaua Docker (`db`)', `postgresql://postgres:${PASSWORD}@db:5432/postgres?sslmode=require`, 'invalid_dsn'],
    ['IP privat', `postgresql://postgres:${PASSWORD}@172.17.0.1:5432/postgres?sslmode=require`, 'host_not_allowed'],
    ['metadata cloud (link-local)', `postgresql://postgres:${PASSWORD}@169.254.169.254:5432/postgres?sslmode=require`, 'host_not_allowed'],
    ['IPv6 loopback', `postgresql://postgres:${PASSWORD}@[::1]:5432/postgres?sslmode=require`, 'host_not_allowed'],
    ['nume .internal', `postgresql://postgres:${PASSWORD}@kong.internal:8000/postgres?sslmode=require`, 'host_not_allowed'],
    ['fără TLS (sslmode=disable)', `postgresql://postgres:${PASSWORD}@airbyte-db.exemplu.ro:5432/postgres?sslmode=disable`, 'tls_required'],
  ]
  for (const [label, dsn, outcome] of cases) {
    test(`${label}: ${outcome}, fără conexiune, credențiala marcată invalidă`, async () => {
      await setDsn(dsn)
      const before = await inspections()
      const res = await inspect(userToken(U.admin1))
      assert.equal(res.status, 200, JSON.stringify(res.json))
      assert.equal(res.json.outcome, outcome)
      assert.deepEqual(res.json.accounts, [])
      assertNoSecret(res)
      assert.equal(await inspections(), before, 'o adresă refuzată nu consumă din limită (nu s-a deschis nicio conexiune)')
      assert.equal(await credentialStatus(), 'invalid')
    })
  }
})
