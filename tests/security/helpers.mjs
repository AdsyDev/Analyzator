// Utilitare comune pentru testele de securitate pe Supabase local.
import { createHmac } from 'node:crypto'

export const API_URL = process.env.API_URL
export const ANON_KEY = process.env.ANON_KEY
export const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY
export const JWT_SECRET = process.env.JWT_SECRET

if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !JWT_SECRET) {
  throw new Error('Lipsesc variabilele din `supabase status -o env` (rulează prin npm run test:security).')
}
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) {
  throw new Error(`Testele de securitate rulează doar pe Supabase local, nu pe ${API_URL}.`)
}

export const T1 = '10000000-0000-0000-0000-000000000001'
export const T2 = '10000000-0000-0000-0000-000000000002'
export const B1A = '20000000-0000-0000-0000-000000000011'
export const B1B = '20000000-0000-0000-0000-000000000012'
export const B2A = '20000000-0000-0000-0000-000000000021'
export const B2B = '20000000-0000-0000-0000-000000000022'
export const U = {
  admin1: '30000000-0000-0000-0000-000000000001',
  strat1: '30000000-0000-0000-0000-000000000002',
  account1: '30000000-0000-0000-0000-000000000003',
  client1: '30000000-0000-0000-0000-000000000004',
  clientNone: '30000000-0000-0000-0000-000000000005',
  admin2: '30000000-0000-0000-0000-000000000011',
  strat2: '30000000-0000-0000-0000-000000000012',
}
export const TABLES = [
  'tenants', 'brands', 'memberships', 'brand_access', 'competitor_sets', 'competitor_set_members',
  'source_connections', 'sync_runs', 'import_batches', 'audit_events', 'provider_api_calls',
  'web_daily', 'web_key_events', 'web_active_users_interval', 'search_daily', 'search_queries', 'source_reconciliations',
]
export const CLARITY_1A = '50000000-0000-0000-0000-000000000031'
export const CLARITY_2A = '50000000-0000-0000-0000-000000000032'

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

export function signJwt(payload, secret = JWT_SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const unsigned = `${b64(header)}.${b64(payload)}`
  const sig = header.alg === 'none' ? '' : createHmac('sha256', secret).update(unsigned).digest('base64url')
  return `${unsigned}.${sig}`
}

export function userToken(sub, extra = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signJwt({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, ...extra })
}

export async function req(path, { token, method = 'GET', body, headers = {} } = {}) {
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

export const rest = (path, opts) => req(`/rest/v1/${path}`, opts)
export const asService = (path, opts = {}) =>
  rest(path, { ...opts, token: SERVICE_ROLE_KEY, headers: { apikey: SERVICE_ROLE_KEY, ...opts.headers } })

export const ids = (rows) => rows.map((r) => r.id).sort()
export const representation = { Prefer: 'return=representation' }
