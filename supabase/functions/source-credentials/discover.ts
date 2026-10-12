// Descoperirea conturilor pe care le vede cheia unui client (selectorul din pagina site-ului, D-18).
// Independent de runtime: doar fetch și WebCrypto (Deno și Node). Cheia nu iese de aici: rezultatul are doar
// ID-ul, numele și un detaliu al fiecărui cont.

export type DiscoverKind = 'ga4' | 'gsc' | 'planable' | 'meta_ads' | 'seomonitor'

export type DiscoveredAccount = { id: string; name: string; detail: string | null }

export type DiscoverOutcome =
  | { ok: true; accounts: DiscoveredAccount[]; truncated: boolean }
  | { ok: false; reason: 'invalid' | 'api_disabled' | 'rate_limited' | 'provider_error'; status: number | null; message: string }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** Ce cont de client folosește fiecare listare și câte listări sunt permise pe zi (UTC), per cont. */
export const DISCOVER: Record<DiscoverKind, { tenantProvider: string; label: string }> = {
  ga4: { tenantProvider: 'google_service_account', label: 'Google Analytics' },
  gsc: { tenantProvider: 'google_service_account', label: 'Search Console' },
  planable: { tenantProvider: 'planable_account', label: 'Planable' },
  meta_ads: { tenantProvider: 'meta_account', label: 'Meta' },
  seomonitor: { tenantProvider: 'seomonitor', label: 'SEOmonitor' },
}
export const DISCOVER_DAILY_LIMIT = 30

/** Plafon de siguranță: o listare nu cere mai mult de atâtea pagini. */
const MAX_PAGES = 5

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GA4_ACCOUNTS_URL = 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries'
export const GSC_SITES_URL = 'https://www.googleapis.com/webmasters/v3/sites'
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'

export async function discover(kind: DiscoverKind, token: string, fetch: Fetch, now: Date): Promise<DiscoverOutcome> {
  if (kind === 'ga4' || kind === 'gsc') return discoverGoogle(kind, token, fetch, now)
  if (kind === 'planable') return discoverPlanable(token, fetch)
  if (kind === 'meta_ads') return discoverMeta(token, fetch)
  return discoverSeomonitor(token, fetch)
}

// --- Google (service account → token de acces, apoi Admin API / Search Console) ------------------

type ServiceAccount = { client_email: string; private_key: string }

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (v.type !== 'service_account' || typeof v.client_email !== 'string' || typeof v.private_key !== 'string') return null
    return { client_email: v.client_email, private_key: v.private_key }
  } catch {
    return null
  }
}

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)))

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const bin = atob(body)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** JWT semnat RS256 pentru fluxul service account (RFC 7523). Adresa tokenului e fixă, nu cea din cheie. */
export async function googleAssertion(sa: ServiceAccount, scope: string, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000)
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({ iss: sa.client_email, scope, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 })}`
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)))
  return `${unsigned}.${b64url(sig)}`
}

async function discoverGoogle(kind: 'ga4' | 'gsc', raw: string, fetch: Fetch, now: Date): Promise<DiscoverOutcome> {
  const sa = parseServiceAccount(raw)
  if (!sa) return { ok: false, reason: 'invalid', status: null, message: 'Cheia salvată nu e un service account Google valid. Încarcă din nou fișierul JSON.' }
  let assertion: string
  try {
    assertion = await googleAssertion(sa, kind === 'ga4' ? GA4_SCOPE : GSC_SCOPE, now)
  } catch {
    return { ok: false, reason: 'invalid', status: null, message: 'Cheia privată din fișierul JSON nu poate fi folosită. Încarcă din nou fișierul descărcat din Google Cloud.' }
  }
  const tokenRes = await safeFetch(fetch, GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  })
  if (!tokenRes) return networkError('Google')
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel()
    if (tokenRes.status === 400 || tokenRes.status === 401) {
      return { ok: false, reason: 'invalid', status: tokenRes.status, message: 'Google a refuzat cheia (cheie ștearsă sau service account dezactivat). Creează o cheie nouă și încarc-o din nou.' }
    }
    return providerError('Google', tokenRes.status)
  }
  const access = ((await tokenRes.json()) as { access_token?: unknown }).access_token
  if (typeof access !== 'string') return providerError('Google', tokenRes.status)
  const auth = { Authorization: `Bearer ${access}`, Accept: 'application/json' }
  return kind === 'ga4' ? listGa4(auth, fetch) : listGsc(auth, fetch)
}

/** Răspunsul de eroare Google: API neactivat în proiect sau acces refuzat. */
async function googleFailure(res: Response, api: string): Promise<DiscoverOutcome> {
  const text = await res.text()
  if (res.status === 403 && /SERVICE_DISABLED|accessNotConfigured|has not been used in project|is disabled/i.test(text)) {
    return { ok: false, reason: 'api_disabled', status: 403, message: `${api} nu e activat în proiectul Google Cloud al cheii. Google Cloud → APIs & Services → Library → activează „${api}”, apoi reîncearcă peste câteva minute.` }
  }
  if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429, message: 'Google a limitat cererile (429). Reîncearcă peste un minut.' }
  return providerError('Google', res.status)
}

async function listGa4(auth: Record<string, string>, fetch: Fetch): Promise<DiscoverOutcome> {
  const accounts: DiscoveredAccount[] = []
  let pageToken: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${GA4_ACCOUNTS_URL}?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const res = await safeFetch(fetch, url, { headers: auth })
    if (!res) return networkError('Google')
    if (!res.ok) return googleFailure(res, 'Google Analytics Admin API')
    const body = (await res.json()) as { accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }>; nextPageToken?: string }
    for (const a of body.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        const id = /^properties\/(\d+)$/.exec(p.property ?? '')?.[1]
        if (id) accounts.push({ id, name: p.displayName?.trim() || id, detail: a.displayName?.trim() || null })
      }
    }
    pageToken = body.nextPageToken || null
    if (!pageToken) return { ok: true, accounts, truncated: false }
  }
  return { ok: true, accounts, truncated: true }
}

async function listGsc(auth: Record<string, string>, fetch: Fetch): Promise<DiscoverOutcome> {
  const res = await safeFetch(fetch, GSC_SITES_URL, { headers: auth })
  if (!res) return networkError('Google')
  if (!res.ok) return googleFailure(res, 'Google Search Console API')
  const body = (await res.json()) as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }
  const accounts = (body.siteEntry ?? [])
    // Un site neverificat nu dă date: nu-l oferim.
    .filter((s) => typeof s.siteUrl === 'string' && s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ id: s.siteUrl as string, name: s.siteUrl as string, detail: s.siteUrl!.startsWith('sc-domain:') ? 'Domain property' : 'URL prefix' }))
  return { ok: true, accounts, truncated: false }
}

// --- Planable, Meta, SEOmonitor (tokenul clientului direct) ----------------------------------------

async function discoverPlanable(token: string, fetch: Fetch): Promise<DiscoverOutcome> {
  const res = await safeFetch(fetch, 'https://api.planable.io/api/v1/workspaces', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!res) return networkError('Planable')
  if (res.status === 401) return refused('Planable', 401, 'Creează un token nou (scope Read) din Company settings → API tokens.')
  if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429, message: 'Planable a limitat cererile (429). Reîncearcă peste un minut.' }
  if (!res.ok) return providerError('Planable', res.status)
  const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; timezone?: unknown }> }
  const accounts = (body.data ?? [])
    .filter((w) => typeof w.id === 'string')
    .map((w) => ({ id: w.id as string, name: typeof w.name === 'string' && w.name.trim() ? w.name.trim() : (w.id as string), detail: typeof w.timezone === 'string' ? w.timezone : null }))
  return { ok: true, accounts, truncated: false }
}

const META_GRAPH = 'https://graph.facebook.com/'

async function discoverMeta(token: string, fetch: Fetch): Promise<DiscoverOutcome> {
  const accounts: DiscoveredAccount[] = []
  let url: string | null = `${META_GRAPH}v26.0/me/adaccounts?fields=account_id,name,currency&limit=200`
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await safeFetch(fetch, url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (!res) return networkError('Meta')
    if ([400, 401, 403].includes(res.status)) return refused('Meta', res.status, 'Generează un token nou pentru system user din Business Settings → System users (permisiunea ads_read).')
    if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429, message: 'Meta a limitat cererile (429). Reîncearcă peste un minut.' }
    if (!res.ok) return providerError('Meta', res.status)
    const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown; currency?: unknown }>; paging?: { next?: unknown } }
    for (const a of body.data ?? []) {
      if (typeof a.id !== 'string' || !/^act_\d+$/.test(a.id)) continue
      accounts.push({ id: a.id, name: typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.id, detail: typeof a.currency === 'string' ? a.currency : null })
    }
    // Pagina următoare doar dacă e tot pe Graph API (tokenul nu pleacă spre altă adresă).
    url = typeof body.paging?.next === 'string' && body.paging.next.startsWith(META_GRAPH) ? body.paging.next : null
  }
  return { ok: true, accounts, truncated: url !== null }
}

async function discoverSeomonitor(token: string, fetch: Fetch): Promise<DiscoverOutcome> {
  const res = await safeFetch(fetch, 'https://apigw.seomonitor.com/v3/dashboard/v3.0/campaigns/tracked?limit=100', { headers: { Authorization: token, Accept: 'application/json' } })
  if (!res) return networkError('SEOmonitor')
  if (res.status === 401 || res.status === 403) return refused('SEOmonitor', res.status, 'Generează un token nou din Account Settings → Edit Profile → API Token.')
  if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429, message: 'SEOmonitor a limitat cererile (429). Reîncearcă peste un minut.' }
  if (!res.ok) return providerError('SEOmonitor', res.status)
  const body = (await res.json()) as unknown
  const rows = Array.isArray(body) ? body : Array.isArray((body as { data?: unknown })?.data) ? ((body as { data: unknown[] }).data) : []
  const accounts: DiscoveredAccount[] = []
  for (const r of rows as Array<{ campaign_info?: { id?: unknown; name?: unknown; domain?: unknown } }>) {
    const info = r.campaign_info
    const id = typeof info?.id === 'number' || typeof info?.id === 'string' ? String(info.id) : null
    if (!id) continue
    const domain = typeof info?.domain === 'string' ? info.domain : null
    accounts.push({ id, name: typeof info?.name === 'string' && info.name.trim() ? info.name.trim() : (domain ?? id), detail: domain })
  }
  return { ok: true, accounts, truncated: rows.length >= 100 }
}

// --- Comun ------------------------------------------------------------------------------------------

async function safeFetch(fetch: Fetch, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, init)
  } catch {
    return null
  }
}

const networkError = (label: string): DiscoverOutcome => ({ ok: false, reason: 'provider_error', status: null, message: `${label} nu a răspuns (eroare de rețea). Reîncearcă.` })
const providerError = (label: string, status: number): DiscoverOutcome => ({ ok: false, reason: 'provider_error', status, message: `${label} nu a răspuns corect (${status}). Reîncearcă mai târziu.` })
const refused = (label: string, status: number, renew: string): DiscoverOutcome => ({ ok: false, reason: 'invalid', status, message: `${label} a refuzat tokenul (${status}). ${renew}` })
