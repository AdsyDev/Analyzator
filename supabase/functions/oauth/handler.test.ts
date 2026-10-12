import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { customerId, handle, redirectUri, type HandlerDeps, type HandlerEnv } from './handler.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const OTHER = '30000000-0000-0000-0000-000000000002'
const T1 = '10000000-0000-0000-0000-000000000001'
const CONN = '50000000-0000-0000-0000-0000000000f1'
const REFRESH = 'GOOGLE-REFRESH-SECRET'
const TT_TOKEN = 'TIKTOK-ACCESS-SECRET'
const env: HandlerEnv = {
  supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key', appBaseUrl: 'https://app.analyzator.ro',
  redirectBase: 'https://ref.supabase.co', google: { clientId: 'gid', clientSecret: 'gsecret' }, tiktok: { appId: 'ttid', secret: 'ttsecret' },
}

type Row = Record<string, unknown>
let s: { states: Row[]; admins: Set<string>; connections: Row[]; tokens: Row[]; validations: Row[]; calls: Array<{ url: string; init: RequestInit }>; google: { status: number; body: unknown }; tiktok: { status: number; body: unknown } }
let now = new Date('2026-10-12T10:00:00Z')
const sha = (v: string) => createHash('sha256').update(v).digest('hex')

function fetchFake(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    s.calls.push({ url, init })
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body
    const ok = (d: unknown, status = 200) => new Response(d === null ? null : JSON.stringify(d), { status })
    if (url === 'https://oauth2.googleapis.com/token') return ok(s.google.body, s.google.status)
    if (url.startsWith('https://business-api.tiktok.com/')) return ok(s.tiktok.body, s.tiktok.status)
    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const jwt = (headers.Authorization ?? '').replace(/^Bearer /, '')
      return jwt === 'jwt-admin' ? ok({ id: ADMIN }) : jwt === 'jwt-other' ? ok({ id: OTHER }) : ok({ msg: 'x' }, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key')
    const path = decodeURIComponent(url.slice(`${env.supabaseUrl}/rest/v1/`.length))
    const method = init.method ?? 'GET'
    if (path.startsWith('memberships?')) {
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)![1]!
      return ok(s.admins.has(user) && path.includes(`tenant_id=eq.${T1}`) ? [{ role: 'agency_admin' }] : [])
    }
    if (path === 'oauth_states' && method === 'POST') {
      s.states.push({ ...body, used_at: null })
      return ok(null, 201)
    }
    if (path.startsWith('oauth_states?') && method === 'PATCH') {
      const hash = /state_hash=eq\.([0-9a-f]+)/.exec(path)![1]
      const provider = /provider=eq\.(\w+)/.exec(path)![1]
      const at = /expires_at=gt\.([^&]+)/.exec(path)![1]!
      const hit = s.states.filter((r) => r.state_hash === hash && r.provider === provider && r.used_at === null && String(r.expires_at) > at)
      for (const r of hit) r.used_at = body.used_at
      return ok(hit.map((r) => ({ id: 'st', ...r })))
    }
    if (path.startsWith('source_connections?select=id,tenant_id&tenant_id')) return ok(s.connections.filter((c) => path.includes(`provider=eq.${c.provider}`)))
    if (path.startsWith('source_connections?id=eq.') && method === 'PATCH') {
      const c = s.connections.find((x) => path.includes(String(x.id)))!
      Object.assign(c, body)
      return ok(null, 204)
    }
    if (path === 'source_connections?select=id,tenant_id' && method === 'POST') {
      const c = { id: CONN, ...body }
      s.connections.push(c)
      return ok([{ id: CONN, tenant_id: body.tenant_id }], 201)
    }
    if (path === 'rpc/set_source_token') {
      s.tokens.push(body)
      return ok('unverified')
    }
    if (path === 'rpc/record_source_validation') {
      s.validations.push(body)
      return ok('valid')
    }
    throw new Error(`neașteptat ${method} ${path}`)
  }
}

let seed = 0
const deps = (): HandlerDeps => ({ env, fetch: fetchFake(), now: () => now, randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 7 + ++seed) % 256) })

async function startCall(body: Row, jwt: string | null = 'jwt-admin') {
  const res = await handle(new Request('https://ref.supabase.co/functions/v1/oauth', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }), deps())
  return { status: res.status, body: (await res.json()) as Row }
}

async function callback(provider: string, params: Record<string, string>) {
  const u = new URL(`https://ref.supabase.co/functions/v1/oauth/callback/${provider}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  const res = await handle(new Request(u, { method: 'GET' }), deps())
  return { status: res.status, location: new URL(res.headers.get('location') ?? 'https://x/'), text: await res.text() }
}

beforeEach(() => {
  now = new Date('2026-10-12T10:00:00Z')
  s = { states: [], admins: new Set([ADMIN]), connections: [], tokens: [], validations: [], calls: [], google: { status: 200, body: { access_token: 'a', refresh_token: REFRESH, scope: 'https://www.googleapis.com/auth/adwords', expires_in: 3599 } }, tiktok: { status: 200, body: { code: 0, message: 'OK', data: { access_token: TT_TOKEN, refresh_token: 'TT-REFRESH', advertiser_ids: ['7001', '7002'], scope: [1, 2] } } } }
})

describe('utilitare', () => {
  test('ID-ul MCC: 10 cifre, cu sau fără cratime', () => {
    assert.equal(customerId('123-456-7890'), '1234567890')
    assert.equal(customerId('12345'), null)
  })
  test('redirect_uri e fix per furnizor', () => {
    assert.equal(redirectUri(env, 'google_ads'), 'https://ref.supabase.co/functions/v1/oauth/callback/google_ads')
  })
})

describe('start', () => {
  test('Google: URL de autorizare cu offline, consent, PKCE S256; se păstrează doar hash-ul state-ului', async () => {
    const r = await startCall({ action: 'start', provider: 'google_ads', tenant_id: T1, account_label: '123-456-7890' })
    assert.equal(r.status, 200)
    const u = new URL(String(r.body.authorize_url))
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/adwords')
    assert.equal(u.searchParams.get('access_type'), 'offline')
    assert.equal(u.searchParams.get('prompt'), 'consent')
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(u.searchParams.get('redirect_uri'), 'https://ref.supabase.co/functions/v1/oauth/callback/google_ads')
    const state = u.searchParams.get('state')!
    assert.equal(s.states.length, 1)
    assert.equal(s.states[0]!.state_hash, sha(state))
    assert.ok(!JSON.stringify(s.states).includes(state), 'state-ul în clar nu se stochează')
    assert.equal(s.states[0]!.account_label, '1234567890')
    assert.equal(Date.parse(String(s.states[0]!.expires_at)) - now.getTime(), 10 * 60_000)
    const verifier = String(s.states[0]!.code_verifier)
    assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'))
    assert.ok(!r.body.authorize_url!.toString().includes('gsecret'), 'secretul clientului nu pleacă în browser')
  })

  test('TikTok: portal/auth cu app_id și state', async () => {
    const r = await startCall({ action: 'start', provider: 'tiktok_ads', tenant_id: T1 })
    const u = new URL(String(r.body.authorize_url))
    assert.equal(u.origin + u.pathname, 'https://business-api.tiktok.com/portal/auth')
    assert.equal(u.searchParams.get('app_id'), 'ttid')
    assert.ok(!String(r.body.authorize_url).includes('ttsecret'))
  })

  test('refuzuri: fără sesiune, fără rol, MCC invalid, furnizor neconfigurat', async () => {
    assert.equal((await startCall({ action: 'start', provider: 'tiktok_ads', tenant_id: T1 }, null)).status, 401)
    assert.equal((await startCall({ action: 'start', provider: 'tiktok_ads', tenant_id: T1 }, 'jwt-other')).status, 403)
    assert.equal((await startCall({ action: 'start', provider: 'google_ads', tenant_id: T1, account_label: 'abc' })).status, 400)
    assert.equal((await startCall({ action: 'start', provider: 'facebook', tenant_id: T1 })).status, 400)
    const saved = env.tiktok
    env.tiktok = undefined
    try {
      const r = await startCall({ action: 'start', provider: 'tiktok_ads', tenant_id: T1 })
      assert.equal(r.status, 503)
      assert.match(String(r.body.error), /TIKTOK_APP_ID/)
    } finally {
      env.tiktok = saved
    }
    assert.equal(s.states.length, 0)
  })
})

async function startedState(provider: 'google_ads' | 'tiktok_ads'): Promise<string> {
  const r = await startCall({ action: 'start', provider, tenant_id: T1, ...(provider === 'google_ads' ? { account_label: '1234567890' } : {}) })
  return new URL(String(r.body.authorize_url)).searchParams.get('state')!
}

describe('callback', () => {
  test('Google: codul se schimbă cu PKCE, refresh token-ul ajunge în Vault, întoarcere ok fără token în URL', async () => {
    const state = await startedState('google_ads')
    const r = await callback('google_ads', { code: 'auth-code', state })
    assert.equal(r.status, 303)
    assert.equal(r.location.origin + r.location.pathname, 'https://app.analyzator.ro/admin/sources')
    assert.equal(r.location.searchParams.get('result'), 'ok')
    const exchange = s.calls.find((c) => c.url === 'https://oauth2.googleapis.com/token')!
    const form = new URLSearchParams(String(exchange.init.body))
    assert.equal(form.get('grant_type'), 'authorization_code')
    assert.equal(form.get('code_verifier'), s.states[0]!.code_verifier)
    assert.equal(form.get('redirect_uri'), 'https://ref.supabase.co/functions/v1/oauth/callback/google_ads')
    assert.equal(s.connections[0]!.provider, 'google_ads_account')
    assert.equal(s.connections[0]!.brand_id, null)
    assert.equal(s.connections[0]!.external_account_id, '1234567890')
    assert.equal(s.tokens[0]!.p_actor_user_id, ADMIN)
    assert.deepEqual(JSON.parse(String(s.tokens[0]!.p_token)), { refresh_token: REFRESH, scope: 'https://www.googleapis.com/auth/adwords', login_customer_id: '1234567890' })
    assert.deepEqual(s.validations, [{ p_connection_id: CONN, p_ok: true }])
    assert.ok(!r.location.toString().includes(REFRESH) && !r.text.includes(REFRESH))
  })

  test('state folosit o singură dată: a doua întoarcere e refuzată, fără schimb de cod', async () => {
    const state = await startedState('google_ads')
    await callback('google_ads', { code: 'c', state })
    const before = s.calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length
    const r = await callback('google_ads', { code: 'c', state })
    assert.equal(r.location.searchParams.get('reason'), 'state_invalid')
    assert.equal(s.calls.filter((c) => c.url.includes('oauth2.googleapis.com')).length, before)
  })

  test('state expirat, falsificat sau al altui furnizor: refuzat', async () => {
    const state = await startedState('google_ads')
    assert.equal((await callback('tiktok_ads', { auth_code: 'c', state })).location.searchParams.get('reason'), 'state_invalid')
    assert.equal((await callback('google_ads', { code: 'c', state: 'inventat' })).location.searchParams.get('reason'), 'state_invalid')
    now = new Date(now.getTime() + 11 * 60_000)
    assert.equal((await callback('google_ads', { code: 'c', state })).location.searchParams.get('reason'), 'state_invalid')
    assert.equal(s.tokens.length, 0)
  })

  test('utilizatorul refuză la furnizor, sau și-a pierdut rolul între timp: fără token', async () => {
    const st1 = await startedState('google_ads')
    assert.equal((await callback('google_ads', { error: 'access_denied', state: st1 })).location.searchParams.get('reason'), 'denied')
    const st2 = await startedState('google_ads')
    s.admins.delete(ADMIN)
    assert.equal((await callback('google_ads', { code: 'c', state: st2 })).location.searchParams.get('reason'), 'forbidden')
    assert.equal(s.tokens.length, 0)
  })

  test('Google fără refresh token: eroare clară, nimic salvat', async () => {
    s.google.body = { access_token: 'a', scope: 'https://www.googleapis.com/auth/adwords' }
    const state = await startedState('google_ads')
    assert.equal((await callback('google_ads', { code: 'c', state })).location.searchParams.get('reason'), 'no_refresh_token')
    assert.equal(s.tokens.length, 0)
  })

  test('TikTok: auth_code → token; se păstrează doar câmpurile de token și advertiserii', async () => {
    s.tiktok.body = { code: 0, data: { access_token: TT_TOKEN, refresh_token: 'TT-REFRESH', advertiser_ids: ['7001'], scope: [1], other: 'nu' } }
    const state = await startedState('tiktok_ads')
    const r = await callback('tiktok_ads', { auth_code: 'tt-code', state })
    assert.equal(r.location.searchParams.get('result'), 'ok')
    const sent = JSON.parse(String(s.calls.find((c) => c.url.includes('oauth2/access_token'))!.init.body))
    assert.deepEqual(sent, { app_id: 'ttid', secret: 'ttsecret', auth_code: 'tt-code' })
    const stored = JSON.parse(String(s.tokens[0]!.p_token))
    assert.equal(stored.access_token, TT_TOKEN)
    assert.deepEqual(stored.advertiser_ids, ['7001'])
    assert.equal(stored.other, undefined)
    assert.equal(s.connections[0]!.provider, 'tiktok_account')
  })

  test('TikTok cu cod de eroare în corp: exchange_failed', async () => {
    s.tiktok.body = { code: 40105, message: 'invalid auth code', data: {} }
    const state = await startedState('tiktok_ads')
    assert.equal((await callback('tiktok_ads', { auth_code: 'x', state })).location.searchParams.get('reason'), 'exchange_failed')
  })

  test('reconectarea folosește conexiunea existentă a clientului', async () => {
    s.connections.push({ id: CONN, tenant_id: T1, brand_id: null, provider: 'google_ads_account', external_account_id: '1111111111', status: 'active' })
    const state = await startedState('google_ads')
    await callback('google_ads', { code: 'c', state })
    assert.equal(s.connections.length, 1)
    assert.equal(s.connections[0]!.external_account_id, '1234567890')
    assert.equal(s.tokens[0]!.p_connection_id, CONN)
  })
})
