// Funcția server pentru conectarea OAuth (Google Ads, TikTok Ads). Independentă de runtime (doar fetch și Web Crypto).
//
// POST { action: "start", provider, tenant_id, account_label? }  (JWT utilizator, doar agency_admin al clientului)
//   → { authorize_url }: browserul merge la furnizor. Se păstrează doar hash-ul `state` (10 minute, o singură folosire).
// GET  /oauth/callback/<provider>?code|auth_code=…&state=…        (fără JWT: vine de la furnizor)
//   → schimbă codul pe token, îl scrie în Vault (set_source_token, cu utilizatorul care a pornit conectarea)
//     și redirecționează înapoi în aplicație, la Administrare → Surse, cu rezultatul. Tokenul nu apare în răspuns.

import { ALLOWED_HEADERS } from '../_shared/cors.ts'

export type OAuthProvider = 'google_ads' | 'tiktok_ads'

export type HandlerEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  allowedOrigin?: string
  /** Adresa aplicației (fără `/` final), pentru întoarcerea după conectare. */
  appBaseUrl: string
  /** Baza publică a funcțiilor (implicit supabaseUrl): redirect_uri = <bază>/functions/v1/oauth/callback/<provider>. */
  redirectBase?: string
  google?: { clientId: string; clientSecret: string }
  tiktok?: { appId: string; secret: string }
}

export type HandlerDeps = {
  env: HandlerEnv
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => Date
  /** Octeți aleatori (Web Crypto); injectabil în teste. */
  randomBytes?: (n: number) => Uint8Array
}

export const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'
export const TIKTOK_AUTHORIZE = 'https://business-api.tiktok.com/portal/auth'
export const TIKTOK_TOKEN = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/'
export const STATE_TTL_MS = 10 * 60_000

const ACCOUNT_PROVIDER: Record<OAuthProvider, string> = { google_ads: 'google_ads_account', tiktok_ads: 'tiktok_account' }
const LABEL: Record<OAuthProvider, string> = { google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Eroare în callback: se întoarce în aplicație cu un cod, nu cu detalii de la furnizor. */
class CallbackError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}

function cors(env: HandlerEnv): Record<string, string> {
  if (!env.allowedOrigin) return {}
  return { 'Access-Control-Allow-Origin': env.allowedOrigin, 'Access-Control-Allow-Headers': ALLOWED_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
}

function json(env: HandlerEnv, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256B64url(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

export function redirectUri(env: HandlerEnv, provider: OAuthProvider): string {
  return `${(env.redirectBase ?? env.supabaseUrl).replace(/\/+$/, '')}/functions/v1/oauth/callback/${provider}`
}

/** ID de client Google Ads (MCC): 10 cifre, cu sau fără cratime. */
export function customerId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/-/g, '').trim()
  return /^\d{10}$/.test(digits) ? digits : null
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  const url = new URL(req.url)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) })
  const callback = /\/oauth\/callback\/(google_ads|tiktok_ads)\/?$/.exec(url.pathname)
  if (req.method === 'GET' && callback) return handleCallback(deps, callback[1] as OAuthProvider, url)
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.' })

  try {
    const userId = await authenticate(req, deps)
    let body: { action?: unknown; provider?: unknown; tenant_id?: unknown; account_label?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    if (body.action !== 'start') throw new HttpError(400, 'Acțiune necunoscută.')
    if (body.provider !== 'google_ads' && body.provider !== 'tiktok_ads') throw new HttpError(400, 'Furnizor necunoscut.')
    if (typeof body.tenant_id !== 'string' || !UUID.test(body.tenant_id)) throw new HttpError(400, 'tenant_id invalid.')
    return json(env, 200, await start(deps, userId, body.provider, body.tenant_id, body.account_label))
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    console.error('oauth: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.' })
  }
}

// --- Autentificare și REST cu service role -------------------------------------------------------

async function authenticate(req: Request, { env, fetch }: HandlerDeps): Promise<string> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(auth)) throw new HttpError(401, 'Autentificare necesară.')
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: auth } })
  if (!res.ok) throw new HttpError(401, 'Sesiune invalidă sau expirată.')
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new HttpError(401, 'Sesiune invalidă.')
  return user.id
}

async function rest<T>(deps: HandlerDeps, path: string, init: RequestInit = {}): Promise<T> {
  const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: deps.env.serviceRoleKey, Authorization: `Bearer ${deps.env.serviceRoleKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers as Record<string, string> | undefined) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST ${path.split('?')[0]}: HTTP ${res.status}`)
  return (text ? JSON.parse(text) : null) as T
}

async function isAgencyAdmin(deps: HandlerDeps, userId: string, tenantId: string): Promise<boolean> {
  const rows = await rest<unknown[]>(
    deps,
    `memberships?select=role,tenants!inner(status)&tenant_id=eq.${tenantId}&user_id=eq.${userId}&role=eq.agency_admin&revoked_at=is.null&tenants.status=eq.active`,
  )
  return rows.length > 0
}

// --- Pornirea conectării -------------------------------------------------------------------------

async function start(deps: HandlerDeps, userId: string, provider: OAuthProvider, tenantId: string, label: unknown) {
  const { env } = deps
  if (!(await isAgencyAdmin(deps, userId, tenantId))) throw new HttpError(403, 'Doar agency_admin al clientului poate conecta conturi.')
  if (provider === 'google_ads' && !env.google) throw new HttpError(503, 'Conectarea Google Ads nu e configurată pe server (lipsesc GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).')
  if (provider === 'tiktok_ads' && !env.tiktok) throw new HttpError(503, 'Conectarea TikTok nu e configurată pe server (lipsesc TIKTOK_APP_ID / TIKTOK_APP_SECRET).')
  let accountLabel: string | null = null
  if (provider === 'google_ads') {
    accountLabel = customerId(label)
    if (!accountLabel) throw new HttpError(400, 'ID-ul contului de manager Google Ads (MCC) are 10 cifre, de ex. 123-456-7890.')
  }

  const random = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)))
  const state = b64url(random(32))
  const verifier = provider === 'google_ads' ? b64url(random(48)) : null
  const now = deps.now()
  await rest(deps, 'oauth_states', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      state_hash: await sha256Hex(state), tenant_id: tenantId, provider, actor_user_id: userId, code_verifier: verifier, account_label: accountLabel,
      created_at: now.toISOString(), expires_at: new Date(now.getTime() + STATE_TTL_MS).toISOString(),
    }),
  })

  const redirect = redirectUri(env, provider)
  let authorize: URL
  if (provider === 'google_ads') {
    authorize = new URL(GOOGLE_AUTHORIZE)
    authorize.search = new URLSearchParams({
      client_id: env.google!.clientId, redirect_uri: redirect, response_type: 'code', scope: GOOGLE_ADS_SCOPE,
      // offline + consent: Google dă un refresh token și la o reconectare.
      access_type: 'offline', prompt: 'consent', state, code_challenge: await sha256B64url(verifier!), code_challenge_method: 'S256',
    }).toString()
  } else {
    authorize = new URL(TIKTOK_AUTHORIZE)
    authorize.search = new URLSearchParams({ app_id: env.tiktok!.appId, state, redirect_uri: redirect }).toString()
  }
  return { authorize_url: authorize.toString() }
}

// --- Întoarcerea de la furnizor --------------------------------------------------------------------

type StateRow = { id: string; tenant_id: string; provider: OAuthProvider; actor_user_id: string; code_verifier: string | null; account_label: string | null }

function back(env: HandlerEnv, provider: OAuthProvider, result: 'ok' | 'error', reason?: string): Response {
  const to = new URL(`${env.appBaseUrl.replace(/\/+$/, '')}/admin/sources`)
  to.searchParams.set('oauth', provider)
  to.searchParams.set('result', result)
  if (reason) to.searchParams.set('reason', reason)
  return new Response(null, { status: 303, headers: { Location: to.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

async function handleCallback(deps: HandlerDeps, provider: OAuthProvider, url: URL): Promise<Response> {
  const { env } = deps
  try {
    const state = url.searchParams.get('state')
    if (!state || state.length > 200) throw new CallbackError('state_invalid')
    // Revendicare atomică: doar o întoarcere folosește un state, și doar înainte de expirare.
    const nowIso = deps.now().toISOString()
    const claimed = await rest<StateRow[]>(
      deps,
      `oauth_states?state_hash=eq.${await sha256Hex(state)}&provider=eq.${provider}&used_at=is.null&expires_at=gt.${encodeURIComponent(nowIso)}&select=id,tenant_id,provider,actor_user_id,code_verifier,account_label`,
      { method: 'PATCH', body: JSON.stringify({ used_at: nowIso }) },
    )
    const row = claimed[0]
    if (!row) throw new CallbackError('state_invalid')
    if (url.searchParams.get('error')) throw new CallbackError('denied')
    // Accesul se reverifică la întoarcere: un admin revocat între timp nu mai poate conecta.
    if (!(await isAgencyAdmin(deps, row.actor_user_id, row.tenant_id))) throw new CallbackError('forbidden')

    const token = provider === 'google_ads' ? await exchangeGoogle(deps, url, row) : await exchangeTikTok(deps, url)
    const connectionId = await ensureConnection(deps, row, provider, token.label)
    await rest(deps, 'rpc/set_source_token', { method: 'POST', body: JSON.stringify({ p_actor_user_id: row.actor_user_id, p_connection_id: connectionId, p_token: token.secret }) })
    // Schimbul reușit al codului dovedește că tokenul e valid.
    await rest(deps, 'rpc/record_source_validation', { method: 'POST', body: JSON.stringify({ p_connection_id: connectionId, p_ok: true }) })
    return back(env, provider, 'ok')
  } catch (err) {
    if (err instanceof CallbackError) return back(env, provider, 'error', err.reason)
    console.error('oauth: callback eșuat', (err as Error).name)
    return back(env, provider, 'error', 'internal')
  }
}

async function exchangeGoogle(deps: HandlerDeps, url: URL, row: StateRow): Promise<{ secret: string; label: string }> {
  const code = url.searchParams.get('code')
  if (!code || !row.code_verifier || !row.account_label || !deps.env.google) throw new CallbackError('code_missing')
  const res = await deps.fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: deps.env.google.clientId, client_secret: deps.env.google.clientSecret, redirect_uri: redirectUri(deps.env, 'google_ads'),
      grant_type: 'authorization_code', code_verifier: row.code_verifier,
    }).toString(),
  })
  if (!res.ok) throw new CallbackError('exchange_failed')
  const t = (await res.json()) as { refresh_token?: unknown; scope?: unknown }
  if (typeof t.refresh_token !== 'string' || t.refresh_token === '') throw new CallbackError('no_refresh_token')
  if (typeof t.scope === 'string' && !t.scope.split(' ').includes(GOOGLE_ADS_SCOPE)) throw new CallbackError('scope_missing')
  return { secret: JSON.stringify({ refresh_token: t.refresh_token, scope: GOOGLE_ADS_SCOPE, login_customer_id: row.account_label }), label: row.account_label }
}

async function exchangeTikTok(deps: HandlerDeps, url: URL): Promise<{ secret: string; label: string }> {
  const code = url.searchParams.get('auth_code') ?? url.searchParams.get('code')
  if (!code || !deps.env.tiktok) throw new CallbackError('code_missing')
  const res = await deps.fetch(TIKTOK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: deps.env.tiktok.appId, secret: deps.env.tiktok.secret, auth_code: code }),
  })
  if (!res.ok) throw new CallbackError('exchange_failed')
  const body = (await res.json()) as { code?: unknown; data?: Record<string, unknown> }
  const d = body.data ?? {}
  if (body.code !== 0 || typeof d.access_token !== 'string') throw new CallbackError('exchange_failed')
  // Se păstrează doar câmpurile de token, expirare și advertiserii autorizați.
  const kept = Object.fromEntries(Object.entries(d).filter(([k]) => /token|expire|advertiser_ids|scope/.test(k)))
  const count = Array.isArray(d.advertiser_ids) ? d.advertiser_ids.length : 0
  return { secret: JSON.stringify({ ...kept, obtained_at: deps.now().toISOString() }), label: `TikTok Business (${count} conturi)` }
}

async function ensureConnection(deps: HandlerDeps, row: StateRow, provider: OAuthProvider, label: string): Promise<string> {
  const accountProvider = ACCOUNT_PROVIDER[provider]
  const existing = await rest<Array<{ id: string; tenant_id: string }>>(
    deps,
    `source_connections?select=id,tenant_id&tenant_id=eq.${row.tenant_id}&provider=eq.${accountProvider}&brand_id=is.null&status=eq.active&order=created_at.asc&limit=1`,
  )
  if (existing[0]) {
    if (existing[0].tenant_id !== row.tenant_id) throw new Error('conexiune din alt tenant')
    await rest(deps, `source_connections?id=eq.${existing[0].id}&tenant_id=eq.${row.tenant_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ external_account_id: label }) })
    return existing[0].id
  }
  const created = await rest<Array<{ id: string; tenant_id: string }>>(deps, 'source_connections?select=id,tenant_id', {
    method: 'POST',
    body: JSON.stringify({ tenant_id: row.tenant_id, brand_id: null, provider: accountProvider, external_account_id: label, display_name: LABEL[provider] }),
  })
  if (!created[0] || created[0].tenant_id !== row.tenant_id) throw new Error('conexiunea nu a putut fi creată')
  return created[0].id
}
