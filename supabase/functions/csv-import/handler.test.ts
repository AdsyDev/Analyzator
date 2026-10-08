// Autorizarea importului CSV: rol (agency_admin / account) + brand_access, la fiecare acțiune. Date sintetice.
import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { handle, type HandlerDeps } from './handler.ts'
import { MemImportDb } from '../_shared/csv-import/test-db.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const B1A = '20000000-0000-0000-0000-000000000011'
const B1B = '20000000-0000-0000-0000-000000000012'
const B2A = '20000000-0000-0000-0000-000000000021'
const U = {
  admin: '30000000-0000-0000-0000-000000000001',
  strategist: '30000000-0000-0000-0000-000000000002',
  account: '30000000-0000-0000-0000-000000000003',
  client: '30000000-0000-0000-0000-000000000004',
  admin2: '30000000-0000-0000-0000-000000000011',
}
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key' }
const NOW = new Date('2026-10-08T07:00:00Z')
const CSV = 'date,campaign_id,spend\n2026-10-05,C1,10\n'
const b64 = (s: string) => Buffer.from(s).toString('base64')

type State = {
  sessions: Record<string, string> // jwt → user id
  /** brandurile pe care RLS le arată fiecărui utilizator: user → brand → tenant */
  visible: Record<string, Record<string, string>>
  roles: Record<string, Record<string, string[]>> // user → tenant → roluri active
  calls: string[]
}
let state: State
let db: MemImportDb

function fakeFetch(): HandlerDeps['fetch'] {
  return async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>
    state.calls.push(`${init.method ?? 'GET'} ${url.replace(env.supabaseUrl, '')}`)
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
    if (url === `${env.supabaseUrl}/auth/v1/user`) {
      const id = state.sessions[(headers.Authorization ?? '').replace(/^Bearer /, '')]
      return id ? ok({ id }) : ok({}, 401)
    }
    // Citirile cu JWT de utilizator: apikey = anon, nu service role.
    assert.equal(headers.apikey, 'anon-key')
    assert.notEqual(headers.Authorization, 'Bearer service-key')
    const user = state.sessions[(headers.Authorization ?? '').replace(/^Bearer /, '')]!
    const path = url.slice(`${env.supabaseUrl}/rest/v1/`.length)
    if (path.startsWith('brands?')) {
      const id = /id=eq\.([0-9a-f-]+)/.exec(path)![1]!
      const tenant = state.visible[user]?.[id]
      return ok(tenant ? [{ id, tenant_id: tenant }] : [])
    }
    if (path.startsWith('memberships?')) {
      const tenant = /tenant_id=eq\.([0-9a-f-]+)/.exec(path)![1]!
      assert.match(path, new RegExp(`user_id=eq\\.${user}`), 'doar propriul membership')
      assert.match(path, /revoked_at=is\.null/)
      return ok((state.roles[user]?.[tenant] ?? []).map((role) => ({ role })))
    }
    throw new Error(`neașteptat: ${url}`)
  }
}

async function call(body: unknown, jwt: string | null = 'jwt-account') {
  const req = new Request('http://fn.test/csv-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  })
  const res = await handle(req, { env, fetch: fakeFetch(), now: () => NOW, db })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

const previewBody = (over: Record<string, unknown> = {}) => ({
  action: 'preview', brand_id: B1A, source: 'tiktok_ads', file_name: 'x.csv', content_base64: b64(CSV),
  declared: { currency: 'RON', timezone: 'Europe/Bucharest' }, ...over,
})

beforeEach(() => {
  db = new MemImportDb()
  state = {
    sessions: { 'jwt-admin': U.admin, 'jwt-strategist': U.strategist, 'jwt-account': U.account, 'jwt-client': U.client, 'jwt-admin2': U.admin2 },
    visible: {
      [U.admin]: { [B1A]: T1, [B1B]: T1 },
      [U.strategist]: { [B1A]: T1 },
      [U.account]: { [B1B]: T1 }, // account T1 are acces doar la 1B
      [U.client]: { [B1A]: T1 },
      [U.admin2]: { [B2A]: '10000000-0000-0000-0000-000000000002' },
    },
    roles: {
      [U.admin]: { [T1]: ['agency_admin'] },
      [U.strategist]: { [T1]: ['strategist'] },
      [U.account]: { [T1]: ['account'] },
      [U.client]: { [T1]: ['client_viewer'] },
      [U.admin2]: { '10000000-0000-0000-0000-000000000002': ['agency_admin'] },
    },
    calls: [],
  }
})

describe('autentificare', () => {
  test('fără JWT: 401; JWT respins: 401; cheia service role ca Bearer: 401; GET: 405', async () => {
    assert.equal((await call(previewBody(), null)).status, 401)
    assert.equal((await call(previewBody(), 'jwt-necunoscut')).status, 401)
    assert.equal((await call(previewBody(), 'service-key')).status, 401)
    const get = await handle(new Request('http://fn.test/x'), { env, fetch: fakeFetch(), now: () => NOW, db })
    assert.equal(get.status, 405)
    assert.equal(db.log.length, 0, 'nicio scriere')
  })
})

describe('preview: rol și brand_access', () => {
  test('account cu acces la 1B poate importa în 1B', async () => {
    const r = await call(previewBody({ brand_id: B1B }))
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'validated')
    assert.equal(r.body.rows_accepted, 1)
    const batch = db.rows('import_batches')[0]!
    assert.deepEqual([batch.tenant_id, batch.brand_id, batch.uploaded_by], [T1, B1B, U.account])
  })

  test('account fără brand_access la 1A: 404 (nu confirmă existența brandului), nimic scris', async () => {
    const r = await call(previewBody({ brand_id: B1A }))
    assert.equal(r.status, 404)
    assert.equal(db.rows('import_batches').length, 0)
  })

  test('agency_admin importă pe orice brand din tenant', async () => {
    assert.equal((await call(previewBody({ brand_id: B1A }), 'jwt-admin')).status, 200)
    assert.equal((await call(previewBody({ brand_id: B1B, content_base64: b64(CSV.replace('C1', 'C2')) }), 'jwt-admin')).status, 200)
  })

  test('strategist și client_viewer cu acces la brand: 403 (rol nepermis)', async () => {
    for (const jwt of ['jwt-strategist', 'jwt-client']) {
      const r = await call(previewBody({ brand_id: B1A }), jwt)
      assert.equal(r.status, 403, jwt)
      assert.equal(r.body.code, 'role_not_allowed')
    }
    assert.equal(db.rows('import_batches').length, 0)
  })

  test('admin din alt tenant pe brand din T1: 404', async () => {
    assert.equal((await call(previewBody({ brand_id: B1A }), 'jwt-admin2')).status, 404)
  })

  test('membership revocat (nu apare în citirea cu revoked_at null): 403', async () => {
    state.roles[U.account] = { [T1]: [] }
    assert.equal((await call(previewBody({ brand_id: B1B }))).status, 403)
  })

  test('tenant_id nu vine de la client: ignorat, se ia din brandul vizibil', async () => {
    const r = await call(previewBody({ brand_id: B1B, tenant_id: '10000000-0000-0000-0000-000000000002' }))
    assert.equal(r.status, 200)
    assert.equal(db.rows('import_batches')[0]!.tenant_id, T1)
  })

  test('brand_id cu injecție de filtre: 400, fără apel către PostgREST', async () => {
    const r = await call(previewBody({ brand_id: `${B1B}&tenant_id=neq.x` }))
    assert.equal(r.status, 400)
    assert.ok(!state.calls.some((c) => c.includes('/rest/v1/')))
  })

  test('declarații lipsă: moneda → 422', async () => {
    const r = await call(previewBody({ brand_id: B1B, declared: { timezone: 'Europe/Bucharest' } }))
    assert.equal(r.status, 422)
    assert.equal(r.body.code, 'currency_required')
  })

  test('base64 invalid / fișier lipsă / sursă necunoscută', async () => {
    assert.equal((await call(previewBody({ brand_id: B1B, content_base64: '***' }))).status, 400)
    assert.equal((await call(previewBody({ brand_id: B1B, content_base64: '' }))).status, 422)
    assert.equal((await call(previewBody({ brand_id: B1B, source: 'snapchat' }))).status, 400)
  })
})

describe('confirm și report', () => {
  async function previewAs(jwt: string, brand = B1B) {
    const r = await call(previewBody({ brand_id: brand }), jwt)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.batch_id as string
  }

  test('confirmare: scrie în paid_daily; confirmă alt utilizator autorizat (agency_admin)', async () => {
    const id = await previewAs('jwt-account')
    const r = await call({ action: 'confirm', batch_id: id }, 'jwt-admin')
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.deepEqual(r.body.written, { paid_daily: 1 })
    const b = db.rows('import_batches')[0]!
    assert.deepEqual([b.status, b.uploaded_by, b.confirmed_by], ['imported', U.account, U.admin])
    assert.equal((await call({ action: 'confirm', batch_id: id }, 'jwt-admin')).status, 409)
  })

  test('accesul revocat între previzualizare și confirmare: 404, nimic scris', async () => {
    const id = await previewAs('jwt-account')
    state.visible[U.account] = {}
    const r = await call({ action: 'confirm', batch_id: id })
    assert.equal(r.status, 404)
    assert.equal(db.rows('paid_daily').length, 0)
    assert.equal(db.rows('import_batches')[0]!.status, 'validated')
  })

  test('rol retras între previzualizare și confirmare: 403', async () => {
    const id = await previewAs('jwt-account')
    state.roles[U.account] = { [T1]: ['strategist'] }
    assert.equal((await call({ action: 'confirm', batch_id: id })).status, 403)
    assert.equal(db.rows('paid_daily').length, 0)
  })

  test('lotul altui brand/tenant: 404 pentru utilizatorul fără acces; ID-ul de lot nu dă acces', async () => {
    const id = await previewAs('jwt-admin', B1A)
    assert.equal((await call({ action: 'confirm', batch_id: id }, 'jwt-account')).status, 404)
    assert.equal((await call({ action: 'report', batch_id: id }, 'jwt-account')).status, 404)
    assert.equal((await call({ action: 'confirm', batch_id: id }, 'jwt-admin2')).status, 404)
    assert.equal((await call({ action: 'confirm', batch_id: id }, 'jwt-client')).status, 403)
    assert.equal(db.rows('paid_daily').length, 0)
  })

  test('batch_id inexistent sau invalid', async () => {
    assert.equal((await call({ action: 'confirm', batch_id: '99999999-9999-4999-8999-999999999999' })).status, 404)
    assert.equal((await call({ action: 'confirm', batch_id: 'x' })).status, 400)
    assert.equal((await call({ action: 'confirm' })).status, 400)
  })

  test('raport: rânduri respinse cu motiv', async () => {
    const csv = 'date,campaign_id,spend\n2026-10-05,C1,10\n2026-10-05,C1,11\n'
    const p = await call(previewBody({ brand_id: B1B, content_base64: b64(csv) }))
    const r = await call({ action: 'report', batch_id: p.body.batch_id })
    assert.equal(r.status, 200)
    assert.equal(r.body.rows_rejected, 1)
    assert.match((r.body.rejected as Array<{ reason: string }>)[0]!.reason, /duplicat/)
  })

  test('tokenul/cheia service role nu apar în niciun răspuns', async () => {
    const id = await previewAs('jwt-account')
    const bodies = [await call({ action: 'report', batch_id: id }), await call({ action: 'confirm', batch_id: id })]
    for (const b of bodies) assert.doesNotMatch(JSON.stringify(b.body), /service-key|anon-key|jwt-/)
  })
})

describe('șablon', () => {
  test('șablonul se descarcă după autentificare; conține doar antetul', async () => {
    const r = await call({ action: 'template', source: 'meta_ads' }, 'jwt-client')
    assert.equal(r.status, 200)
    assert.equal(String(r.body.content).trim().split('\n').length, 1)
    assert.equal(r.body.file_name, 'meta_ads-sablon.csv')
    assert.equal((await call({ action: 'template', source: 'nu_exista' })).status, 400)
    assert.equal((await call({ action: 'template', source: 'meta_ads' }, null)).status, 401)
  })
  test('acțiune necunoscută: 400', async () => {
    assert.equal((await call({ action: 'drop' })).status, 400)
  })
})
