import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, INSPECT_DAILY_LIMIT, type HandlerDeps } from './handler.ts'
import { PgError, type PgSession, type PgTarget } from './inspect.ts'

const ADMIN = '30000000-0000-0000-0000-000000000001'
const STRATEGIST = '30000000-0000-0000-0000-000000000002'
const OUTSIDER = '30000000-0000-0000-0000-000000000003'
const T1 = '10000000-0000-0000-0000-000000000001'
const CONN = '50000000-0000-0000-0000-000000000041'
const PASSWORD = 'PAROLA-SECRETA-RO'
const DSN = `postgresql://analyzator_ro:${PASSWORD}@airbyte-db.exemplu.ro:5432/airbyte?sslmode=require`
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key' }

type State = {
  users: Record<string, string>
  admins: Set<string>
  members: Set<string>
  connection: Record<string, unknown> | null
  callsToday: number
  token: string
  dns: string[] | Error
  connectError: PgError | null
  targets: PgTarget[]
  calls: Array<{ url: string; method: string; body?: unknown }>
}

let state: State

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    const method = init.method ?? 'GET'
    state.calls.push({ url, method, body })
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const id = state.users[(headers.Authorization ?? '').replace(/^Bearer /, '')]
      return id ? ok({ id }) : ok({ msg: 'invalid' }, 401)
    }
    assert.equal(headers.Authorization, 'Bearer service-key', 'apelurile REST folosesc service role')
    const path = url.slice(`${env.supabaseUrl}/rest/v1/`.length)
    if (path.startsWith('source_connections?')) return ok(state.connection ? [state.connection] : [])
    if (path.startsWith('memberships?')) {
      assert.match(path, new RegExp(`tenant_id=eq\\.${T1}`), 'rolul se verifică în tenantul conexiunii')
      const user = /user_id=eq\.([0-9a-f-]+)/.exec(path)?.[1] ?? ''
      if (path.includes('role=eq.agency_admin')) return ok(state.admins.has(user) ? [{ role: 'agency_admin' }] : [])
      return ok(state.members.has(user) ? [{ role: 'member' }] : [])
    }
    if (path.startsWith('provider_api_calls?')) return ok(state.callsToday ? [{ calls: state.callsToday }] : [])
    if (path === 'rpc/get_source_token') return ok(state.token)
    if (path === 'rpc/record_source_validation') return ok(body.p_ok ? 'valid' : 'invalid')
    if (path === 'provider_api_calls' || path === 'audit_events') return new Response(null, { status: 201 })
    throw new Error(`neașteptat: ${method} ${url}`)
  }
}

const session: PgSession = {
  async query<T>(text: string): Promise<T[]> {
    if (text.includes('information_schema.columns')) {
      return [
        ['account_id', 'character varying'], ['account_name', 'character varying'], ['date_start', 'date'], ['spend', 'numeric'], ['impressions', 'bigint'],
      ].map(([column, data_type]) => ({ schema: 'meta', table: 'ads_insights', column, data_type })) as T[]
    }
    return [{ account_id: '1234567890', name: 'Aflamin RO', rows: '55', first_date: '2026-09-01', last_date: '2026-10-25', last_synced_at: '2026-10-26T03:00:00Z' }] as T[]
  },
}

function deps(): HandlerDeps {
  return {
    env,
    fetch: fakeFetch(),
    now: () => new Date('2026-10-26T10:00:00Z'),
    resolve: async () => {
      if (state.dns instanceof Error) throw state.dns
      return state.dns
    },
    connect: async <T,>(target: PgTarget, run: (s: PgSession) => Promise<T>) => {
      state.targets.push(target)
      if (state.connectError) throw state.connectError
      return run(session)
    },
  }
}

async function call(body: unknown, jwt: string | null = 'jwt-admin') {
  const req = new Request('http://fn.test/airbyte', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })
  const res = await handle(req, deps())
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text }
}

const inspectCall = (jwt?: string) => call({ action: 'inspect', connection_id: CONN }, jwt)
const restCalls = (path: string) => state.calls.filter((c) => c.url.includes(`/rest/v1/${path}`))

beforeEach(() => {
  state = {
    users: { 'jwt-admin': ADMIN, 'jwt-strategist': STRATEGIST, 'jwt-outsider': OUTSIDER },
    admins: new Set([ADMIN]),
    members: new Set([ADMIN, STRATEGIST]),
    connection: { id: CONN, tenant_id: T1, brand_id: null, provider: 'airbyte_postgres', status: 'active', credential_status: 'unverified' },
    callsToday: 0,
    token: DSN,
    dns: ['81.196.20.10'],
    connectError: null,
    targets: [],
    calls: [],
  }
})

describe('autentificare, autorizare și validarea cererii', () => {
  test('fără JWT: 401, fără query', async () => {
    const r = await call({ action: 'inspect', connection_id: CONN }, null)
    assert.equal(r.status, 401)
    assert.equal(restCalls('').length, 0)
  })
  test('connection_id invalid: 400', async () => {
    assert.equal((await call({ action: 'inspect', connection_id: `${CONN}&tenant_id=neq.x` })).status, 400)
    assert.equal(restCalls('').length, 0)
  })
  test('acțiune necunoscută: 400; GET: 405', async () => {
    assert.equal((await call({ action: 'query', connection_id: CONN })).status, 400)
    assert.equal((await handle(new Request('http://fn.test/airbyte'), deps())).status, 405)
  })
  test('membru fără rol de agency_admin: 403, fără conexiune la Postgres', async () => {
    const r = await inspectCall('jwt-strategist')
    assert.equal(r.status, 403)
    assert.equal(state.targets.length, 0)
    assert.equal(restCalls('rpc/get_source_token').length, 0)
  })
  test('utilizator din alt tenant: 404 (nu confirmăm existența conexiunii)', async () => {
    const r = await inspectCall('jwt-outsider')
    assert.equal(r.status, 404)
    assert.equal(restCalls('rpc/get_source_token').length, 0)
  })
  test('altă conexiune decât cheia Airbyte a clientului: 422', async () => {
    state.connection = { ...state.connection, provider: 'meta_account' }
    assert.equal((await inspectCall()).status, 422)
    state.connection = { ...state.connection, provider: 'airbyte_postgres', brand_id: '20000000-0000-0000-0000-000000000011' }
    assert.equal((await inspectCall()).status, 422)
    assert.equal(state.targets.length, 0)
  })
  test('fără connection string salvat: 409', async () => {
    state.connection = { ...state.connection, credential_status: 'missing' }
    assert.equal((await inspectCall()).status, 409)
  })
})

describe('inspecția', () => {
  test('reușită: conturile în forma selectorului, cheia marcată validă, apelul contorizat și auditat', async () => {
    const r = await inspectCall()
    assert.equal(r.status, 200)
    assert.equal(r.body.outcome, 'ok')
    assert.equal(r.body.credential_status, 'valid')
    assert.equal(r.body.calls_today, 1)
    assert.equal(r.body.daily_limit, INSPECT_DAILY_LIMIT)
    assert.equal(r.body.inspected_at, '2026-10-26T10:00:00.000Z')
    const accounts = r.body.accounts as Array<Record<string, unknown>>
    assert.equal(accounts[0]!.id, 'meta_ads:1234567890')
    assert.equal(accounts[0]!.name, 'Aflamin RO')
    assert.equal(accounts[0]!.detail, 'Meta Ads · ID 1234567890')
    assert.equal(accounts[0]!.last_date, '2026-10-25')
    assert.match(String(r.body.message), /1 cont în 1 tabel \(Meta Ads\)/)

    // Conexiunea merge la IP-ul verificat, cu numele pentru TLS.
    assert.deepEqual(state.targets[0], { ip: '81.196.20.10', servername: 'airbyte-db.exemplu.ro', port: 5432, user: 'analyzator_ro', password: PASSWORD, database: 'airbyte', ca: null })
    const counted = restCalls('provider_api_calls').filter((c) => c.method === 'POST')
    assert.deepEqual(counted.map((c) => (c.body as Record<string, unknown>).purpose), ['discover'])
    const audit = restCalls('audit_events')[0]!.body as Record<string, unknown>
    assert.equal(audit.action, 'airbyte_inspected')
    assert.equal(audit.tenant_id, T1)
  })
  test('connection string-ul și parola nu apar în răspuns sau în audit', async () => {
    const r = await inspectCall()
    assert.equal(r.text.includes(PASSWORD), false)
    for (const c of restCalls('audit_events')) assert.equal(JSON.stringify(c.body).includes(PASSWORD), false)
    state.connectError = new PgError('auth', '28P01')
    const failed = await inspectCall()
    assert.equal(failed.text.includes(PASSWORD), false)
  })
  test('limita zilnică atinsă: fără Vault, fără conexiune', async () => {
    state.callsToday = INSPECT_DAILY_LIMIT
    const r = await inspectCall()
    assert.equal(r.body.outcome, 'budget_exhausted')
    assert.equal(restCalls('rpc/get_source_token').length, 0)
    assert.equal(state.targets.length, 0)
  })
  test('connection string fără TLS: tls_required, cheia invalidă, fără conexiune și fără consum', async () => {
    state.token = DSN.replace('sslmode=require', 'sslmode=disable')
    const r = await inspectCall()
    assert.equal(r.body.outcome, 'tls_required')
    assert.equal(r.body.credential_status, 'invalid')
    assert.equal(state.targets.length, 0)
    assert.equal(restCalls('provider_api_calls').filter((c) => c.method === 'POST').length, 0)
  })
  test('SSRF: numele se rezolvă într-o adresă privată → host_not_allowed, fără conexiune', async () => {
    state.dns = ['81.196.20.10', '10.0.0.5']
    const r = await inspectCall()
    assert.equal(r.body.outcome, 'host_not_allowed')
    assert.equal(state.targets.length, 0)
  })
  test('SSRF: localhost în connection string → host_not_allowed, fără DNS', async () => {
    state.token = 'postgresql://u:p@localhost:5432/postgres'
    let resolved = false
    const d = deps()
    d.resolve = async () => {
      resolved = true
      return []
    }
    const res = await handle(new Request('http://fn.test/airbyte', { method: 'POST', headers: { Authorization: 'Bearer jwt-admin' }, body: JSON.stringify({ action: 'inspect', connection_id: CONN }) }), d)
    assert.equal(((await res.json()) as Record<string, unknown>).outcome, 'host_not_allowed')
    assert.equal(resolved, false)
  })
  test('nume inexistent în DNS: dns_failed; eroare temporară de DNS: starea cheii nu se schimbă', async () => {
    state.dns = []
    assert.equal((await inspectCall()).body.credential_status, 'invalid')
    state.dns = new Error('timeout')
    const r = await inspectCall()
    assert.equal(r.body.outcome, 'dns_failed')
    assert.equal(r.body.credential_status, 'unverified')
  })
  test('erorile driverului: configurare greșită → cheia invalidă; pană → starea rămâne', async () => {
    const cases: Array<[PgError, string, string]> = [
      [new PgError('auth', '28P01'), 'auth_failed', 'invalid'],
      [new PgError('tls', null), 'tls_failed', 'invalid'],
      [new PgError('database_not_found', '3D000'), 'database_not_found', 'invalid'],
      [new PgError('not_read_only', null), 'not_read_only', 'invalid'],
      [new PgError('unreachable', 'ECONNREFUSED'), 'unreachable', 'unverified'],
      [new PgError('timeout', 'CONNECT_TIMEOUT'), 'timeout', 'unverified'],
    ]
    for (const [err, outcome, status] of cases) {
      state.connectError = err
      const r = await inspectCall()
      assert.equal(r.body.outcome, outcome, outcome)
      assert.equal(r.body.credential_status, status, outcome)
      assert.equal(r.body.calls_today, 1, 'încercarea pornită se contorizează')
    }
  })
  test('certificatul autorității (CA) din credențiala JSON ajunge la conexiune', async () => {
    const ca = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----'
    state.token = JSON.stringify({ dsn: DSN, ca_cert: ca })
    await inspectCall()
    assert.equal(state.targets[0]!.ca, ca)
  })
})
