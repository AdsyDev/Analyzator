// Teste adversariale de izolare prin API-ul real (PostgREST, Storage, GraphQL) pe Supabase local.
// Rulează: npm run test:security (resetează baza locală, apoi pgTAP + acest fișier).
// Vezi docs/security-tests.md (secțiunea B).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

const API_URL = process.env.API_URL
const ANON_KEY = process.env.ANON_KEY
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY
const JWT_SECRET = process.env.JWT_SECRET

if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !JWT_SECRET) {
  throw new Error('Lipsesc variabilele din `supabase status -o env` (rulează prin npm run test:security).')
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) {
  throw new Error(`Testele de securitate rulează doar pe Supabase local, nu pe ${API_URL}.`)
}

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1A = '20000000-0000-0000-0000-000000000011'
const B1B = '20000000-0000-0000-0000-000000000012'
const B2A = '20000000-0000-0000-0000-000000000021'
const B2B = '20000000-0000-0000-0000-000000000022'
const U = {
  admin1: '30000000-0000-0000-0000-000000000001',
  strat1: '30000000-0000-0000-0000-000000000002',
  account1: '30000000-0000-0000-0000-000000000003',
  client1: '30000000-0000-0000-0000-000000000004',
  clientNone: '30000000-0000-0000-0000-000000000005',
  admin2: '30000000-0000-0000-0000-000000000011',
  strat2: '30000000-0000-0000-0000-000000000012',
}
const TABLES = [
  'tenants', 'brands', 'memberships', 'brand_access', 'competitor_sets', 'competitor_set_members',
  'source_connections', 'sync_runs', 'import_batches', 'audit_events',
]

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function signJwt(payload, secret = JWT_SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const unsigned = `${b64(header)}.${b64(payload)}`
  const sig = header.alg === 'none' ? '' : createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${sig}`
}

function userToken(sub, extra = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, ...extra })
}

async function req(path, { token, method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      apikey: ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, json, headers: res.headers }
}

const rest = (path, opts) => req(`/rest/v1/${path}`, opts)
const asService = (path, opts = {}) =>
  rest(path, { ...opts, token: SERVICE_ROLE_KEY, headers: { apikey: SERVICE_ROLE_KEY, ...opts.headers } })

const ids = (rows) => rows.map((r) => r.id).sort()
const representation = { Prefer: 'return=representation' }

// Control pozitiv: fără date în bază, testele negative ar trece din motive greșite.
before(async () => {
  const { status, json } = await asService('brands?select=id')
  assert.equal(status, 200)
  assert.equal(json.length, 4, 'seed-ul de test trebuie să conțină 4 branduri')
})

describe('B1. Citire REST directă cu ID modificat', () => {
  test('strategist T1: fiecare tabel filtrat pe brandul/tenantul altcuiva întoarce []', async () => {
    const token = userToken(U.strat1)
    for (const table of TABLES) {
      const byTenant = await rest(`${table}?select=*&${table === 'tenants' ? 'id' : 'tenant_id'}=eq.${T2}`, { token })
      assert.equal(byTenant.status, 200, `${table} tenant`)
      assert.deepEqual(byTenant.json, [], `${table}: rânduri din T2 vizibile`)
      if (!['tenants', 'memberships'].includes(table)) {
        const col = table === 'brands' ? 'id' : 'brand_id'
        const byBrand = await rest(`${table}?select=*&${col}=in.(${B1B},${B2A},${B2B})`, { token })
        assert.equal(byBrand.status, 200, `${table} brand`)
        assert.deepEqual(byBrand.json, [], `${table}: rânduri din branduri fără acces vizibile`)
      }
    }
  })

  test('strategist T1 vede exact brandul 1A (control pozitiv)', async () => {
    const { json } = await rest('brands?select=id', { token: userToken(U.strat1) })
    assert.deepEqual(ids(json), [B1A])
  })

  test('client fără brand_access: 0 rânduri în toate tabelele de business', async () => {
    const token = userToken(U.clientNone)
    for (const table of TABLES.filter((t) => t !== 'memberships')) {
      const { status, json } = await rest(`${table}?select=*`, { token })
      assert.equal(status, 200)
      assert.deepEqual(json, [], `${table} vizibil pentru client fără acces`)
    }
    const own = await rest('memberships?select=user_id', { token })
    assert.deepEqual(own.json, [{ user_id: U.clientNone }])
  })

  test('count=exact nu dezvăluie numărul de rânduri străine', async () => {
    const { headers } = await rest('brands?select=id', {
      token: userToken(U.strat1),
      headers: { Prefer: 'count=exact' },
    })
    assert.match(headers.get('content-range'), /\/1$/)
  })

  test('filtre or=, not., embedding: nu ocolesc RLS', async () => {
    const token = userToken(U.client1)
    const orFilter = await rest(`brands?select=id&or=(id.eq.${B2A},id.eq.${B1B},tenant_id.eq.${T2})`, { token })
    assert.deepEqual(orFilter.json, [])
    const notFilter = await rest(`brands?select=id&id=not.eq.${B1A}`, { token })
    assert.deepEqual(notFilter.json, [])
    const embedded = await rest('brands?select=id,tenants(id),competitor_sets(id,brand_id),brand_access(user_id)', { token })
    assert.equal(embedded.status, 200)
    assert.deepEqual(ids(embedded.json), [B1A])
    for (const set of embedded.json[0].competitor_sets) assert.equal(set.brand_id, B1A)
    for (const ba of embedded.json[0].brand_access) assert.equal(ba.user_id, U.client1)
    const reverse = await rest('competitor_set_members?select=brand_id,competitor_sets(brand_id),brands(id,tenant_id)', { token })
    for (const row of reverse.json) {
      assert.equal(row.brand_id, B1A)
      assert.equal(row.brands.id, B1A)
    }
  })

  test('admin T2 nu vede nimic din T1, inclusiv auditul', async () => {
    const token = userToken(U.admin2)
    for (const table of TABLES) {
      const col = table === 'tenants' ? 'id' : 'tenant_id'
      const { json } = await rest(`${table}?select=*&${col}=eq.${T1}`, { token })
      assert.deepEqual(json, [], `${table} din T1 vizibil pentru admin T2`)
    }
  })
})

describe('B2. Scriere REST pe date străine', () => {
  test('PATCH pe brand străin: 0 rânduri afectate, valoarea rămâne', async () => {
    const res = await rest(`brands?id=eq.${B2A}`, {
      token: userToken(U.strat1), method: 'PATCH', body: { name: 'Atac' }, headers: representation,
    })
    assert.deepEqual(res.json, [])
    const check = await asService(`brands?id=eq.${B2A}&select=name`)
    assert.equal(check.json[0].name, 'Brand 2A')
  })

  test('PATCH tenant_id (mutarea brandului în alt tenant) e refuzat', async () => {
    const res = await rest(`brands?id=eq.${B1A}`, {
      token: userToken(U.admin1), method: 'PATCH', body: { tenant_id: T2 }, headers: representation,
    })
    assert.ok([401, 403].includes(res.status), `status ${res.status}`)
  })

  test('POST brand în tenant străin e refuzat', async () => {
    const res = await rest('brands', {
      token: userToken(U.admin1), method: 'POST', body: { tenant_id: T2, slug: 'atac', name: 'Atac' },
    })
    assert.ok([401, 403].includes(res.status), `status ${res.status}`)
  })

  test('DELETE pe branduri, tenants, audit: refuzat chiar și pentru admin', async () => {
    const token = userToken(U.admin1)
    for (const path of [`brands?id=eq.${B1A}`, `tenants?id=eq.${T1}`, 'audit_events?id=gt.0']) {
      const res = await rest(path, { token, method: 'DELETE', headers: representation })
      assert.ok([401, 403].includes(res.status), `${path}: status ${res.status}`)
    }
    const check = await asService(`brands?id=eq.${B1A}&select=id`)
    assert.equal(check.json.length, 1)
  })

  test('auto-acordare brand_access și escaladare de rol de către client', async () => {
    const token = userToken(U.client1)
    const grant = await rest('brand_access', {
      token, method: 'POST', body: { tenant_id: T1, brand_id: B1B, user_id: U.client1, granted_by: U.client1 },
    })
    assert.ok([401, 403].includes(grant.status), `grant status ${grant.status}`)
    const escalate = await rest(`memberships?user_id=eq.${U.client1}`, {
      token, method: 'PATCH', body: { role: 'agency_admin' }, headers: representation,
    })
    assert.deepEqual(escalate.json, [])
    const check = await asService(`memberships?user_id=eq.${U.client1}&select=role`)
    assert.equal(check.json[0].role, 'client_viewer')
  })

  test('admin T1 nu poate acorda acces la brand din T2 și nu poate muta membership-uri', async () => {
    const token = userToken(U.admin1)
    const grant = await rest('brand_access', {
      token, method: 'POST', body: { tenant_id: T2, brand_id: B2A, user_id: U.admin1, granted_by: U.admin1 },
    })
    assert.ok([401, 403].includes(grant.status), `status ${grant.status}`)
    const mixed = await rest('brand_access', {
      token, method: 'POST', body: { tenant_id: T1, brand_id: B2A, user_id: U.strat1, granted_by: U.admin1 },
    })
    assert.ok(mixed.status >= 400, 'brand din T2 asociat cu tenant T1')
    const move = await rest(`memberships?user_id=eq.${U.strat1}`, {
      token, method: 'PATCH', body: { tenant_id: T2 }, headers: representation,
    })
    assert.ok([401, 403].includes(move.status), `status ${move.status}`)
  })

  test('tabelele de sincronizare nu acceptă scrieri de la utilizatori', async () => {
    const token = userToken(U.admin1)
    const run = await rest('sync_runs', {
      token, method: 'POST',
      body: { tenant_id: T1, brand_id: B1A, source: 'ga4', period_start: '2026-10-01', period_end: '2026-10-07' },
    })
    assert.ok([401, 403].includes(run.status), `sync_runs status ${run.status}`)
    const batch = await rest('import_batches', {
      token: userToken(U.account1), method: 'POST',
      body: { tenant_id: T1, brand_id: B1B, source: 'meta_ads', file_sha256: 'c'.repeat(64), uploaded_by: U.account1 },
    })
    assert.ok([401, 403].includes(batch.status), `import_batches status ${batch.status}`)
    const audit = await rest('audit_events', {
      token, method: 'POST', body: { tenant_id: T1, actor_type: 'user', action: 'fals', entity_type: 'x' },
    })
    assert.ok([401, 403].includes(audit.status), `audit status ${audit.status}`)
  })
})

describe('B3. RPC și scheme neexpuse', () => {
  test('funcțiile private nu pot fi apelate prin /rpc', async () => {
    const token = userToken(U.strat1)
    for (const fn of ['has_brand_access', 'has_role', 'user_has_brand_role', 'user_can_import', 'can_see_tenant']) {
      const res = await rest(`rpc/${fn}`, { token, method: 'POST', body: { p_brand_id: B2A } })
      assert.equal(res.status, 404, `rpc/${fn}: ${res.status}`)
    }
  })

  test('Accept-Profile / Content-Profile pe scheme neexpuse sunt refuzate', async () => {
    const token = userToken(U.strat1)
    for (const schema of ['private', 'auth', 'tests', 'storage', 'vault']) {
      const read = await rest('memberships?select=*', { token, headers: { 'Accept-Profile': schema } })
      assert.equal(read.status, 406, `Accept-Profile ${schema}: ${read.status}`)
      const call = await rest('rpc/has_brand_access', {
        token, method: 'POST', body: { p_brand_id: B2A }, headers: { 'Content-Profile': schema },
      })
      assert.equal(call.status, 406, `Content-Profile ${schema}: ${call.status}`)
    }
  })

  test('nicio funcție RPC expusă în public', async () => {
    const res = await rest('rpc/graphql', { token: userToken(U.strat1), method: 'POST', body: {} })
    assert.notEqual(res.status, 200)
  })
})

describe('B4. JWT falsificat sau manipulat', () => {
  test('semnătură greșită, alg none, token expirat: 401', async () => {
    const now = Math.floor(Date.now() / 1000)
    const forged = [
      signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }, 'alt-secret-cu-cel-putin-32-de-caractere!!'),
      signJwt({ sub: U.admin1, role: 'service_role', exp: now + 3600 }, 'alt-secret-cu-cel-putin-32-de-caractere!!'),
      signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 3600 }, '', { alg: 'none', typ: 'JWT' }),
      userToken(U.admin1, { iat: now - 7200, exp: now - 3600 }),
    ]
    for (const token of forged) {
      const res = await rest('brands?select=id', { token })
      assert.equal(res.status, 401, `token acceptat: ${token.slice(0, 40)}…`)
    }
  })

  test('claims suplimentare (tenant_id, brand_ids, app_metadata.role) nu acordă acces', async () => {
    const token = userToken(U.clientNone, {
      tenant_id: T2,
      brand_ids: [B1A, B2A],
      app_metadata: { role: 'agency_admin', tenant_id: T1 },
      user_role: 'agency_admin',
    })
    const { json } = await rest('brands?select=id', { token })
    assert.deepEqual(json, [])
  })

  test('sub inexistent: 0 rânduri', async () => {
    const { json } = await rest('brands?select=id', { token: userToken('99999999-9999-9999-9999-999999999999') })
    assert.deepEqual(json, [])
  })

  test('doar cheia anon (fără sesiune): acces refuzat la tabele', async () => {
    const res = await rest('brands?select=id')
    assert.ok([401, 403].includes(res.status), `status ${res.status}`)
  })
})

describe('B5. Revocare cu același JWT (sesiune existentă)', () => {
  const token = userToken(U.strat1)
  after(async () => {
    await asService(`brand_access?user_id=eq.${U.strat1}&brand_id=eq.${B1A}`, {
      method: 'PATCH', body: { revoked_at: null },
    })
    await asService(`memberships?user_id=eq.${U.strat1}`, { method: 'PATCH', body: { revoked_at: null } })
  })

  test('revocarea brand_access se aplică la următorul request', async () => {
    assert.deepEqual(ids((await rest('brands?select=id', { token })).json), [B1A])
    const revoke = await rest(`brand_access?user_id=eq.${U.strat1}&brand_id=eq.${B1A}`, {
      token: userToken(U.admin1), method: 'PATCH', body: { revoked_at: new Date().toISOString() }, headers: representation,
    })
    assert.equal(revoke.json.length, 1, 'admin T1 trebuie să poată revoca')
    assert.deepEqual((await rest('brands?select=id', { token })).json, [])
    assert.deepEqual((await rest('sync_runs?select=id', { token })).json, [])
  })

  test('revocarea membership-ului se aplică la următorul request', async () => {
    await asService(`brand_access?user_id=eq.${U.strat1}&brand_id=eq.${B1A}`, {
      method: 'PATCH', body: { revoked_at: null },
    })
    assert.deepEqual(ids((await rest('brands?select=id', { token })).json), [B1A])
    await asService(`memberships?user_id=eq.${U.strat1}`, {
      method: 'PATCH', body: { revoked_at: new Date().toISOString() },
    })
    assert.deepEqual((await rest('brands?select=id', { token })).json, [])
    assert.deepEqual((await rest('tenants?select=id', { token })).json, [])
  })
})

describe('B6. Storage', () => {
  test('utilizatorul nu vede bucket-uri și nu poate crea unul', async () => {
    const token = userToken(U.admin1)
    const list = await req('/storage/v1/bucket', { token })
    assert.ok(list.status === 200 ? list.json.length === 0 : list.status >= 400, `list ${list.status}`)
    const create = await req('/storage/v1/bucket', {
      token, method: 'POST', body: { id: 'atac', name: 'atac', public: true },
    })
    assert.ok(create.status >= 400, `creare bucket: ${create.status}`)
  })

  test('căi de obiect ghicite nu întorc conținut', async () => {
    const token = userToken(U.strat1)
    const guesses = [
      `/storage/v1/object/authenticated/imports/${T2}/${B2A}/meta-2a.csv`,
      `/storage/v1/object/public/imports/${T2}/${B2A}/meta-2a.csv`,
      `/storage/v1/object/imports/${T2}/${B2A}/meta-2a.csv`,
      `/storage/v1/object/sign/imports/${T2}/${B2A}/meta-2a.csv`,
    ]
    for (const path of guesses) {
      const res = await req(path, { token, method: path.includes('/sign/') ? 'POST' : 'GET', body: path.includes('/sign/') ? { expiresIn: 60 } : undefined })
      assert.ok(res.status >= 400, `${path}: ${res.status}`)
    }
  })
})

describe('B7. GraphQL', () => {
  test('GraphQL nu expune date străine (sau nu e activ)', async () => {
    const res = await req('/graphql/v1', {
      token: userToken(U.strat1), method: 'POST',
      body: { query: '{ brandsCollection { edges { node { id tenant_id } } } }' },
    })
    const edges = res.json?.data?.brandsCollection?.edges
    if (edges) {
      assert.deepEqual(edges.map((e) => e.node.id), [B1A])
    } else {
      assert.ok(res.status >= 400 || res.json?.errors, `răspuns neașteptat: ${res.status}`)
    }
  })
})
