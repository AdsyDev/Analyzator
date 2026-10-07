// Funcția server pentru credențialele surselor. Independentă de runtime (doar fetch), testabilă în Node.
//
// POST { action: "set_token", connection_id, token }  → scrie tokenul în Vault (doar agency_admin)
// POST { action: "validate", connection_id }           → un singur apel la furnizor; consumă din bugetul zilnic
//
// Tokenul nu apare niciodată în răspuns sau în loguri.

export type HandlerEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  allowedOrigin?: string
}

export type HandlerDeps = {
  env: HandlerEnv
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => Date
}

export const CLARITY_ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'
export const DAILY_LIMIT: Record<string, number> = { clarity: 10 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Connection = {
  id: string
  tenant_id: string
  brand_id: string | null
  provider: string
  status: string
  credential_status: string
}

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function corsHeaders(env: HandlerEnv): Record<string, string> {
  if (!env.allowedOrigin) return {}
  return {
    'Access-Control-Allow-Origin': env.allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(env: HandlerEnv, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  })
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) })
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.' })

  try {
    const userId = await authenticate(req, deps)

    let body: { action?: unknown; connection_id?: unknown; token?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    if (typeof body.connection_id !== 'string' || !UUID.test(body.connection_id)) {
      throw new HttpError(400, 'connection_id invalid.')
    }

    if (body.action === 'set_token') {
      if (typeof body.token !== 'string') throw new HttpError(400, 'Lipsește tokenul.')
      return json(env, 200, await setToken(deps, userId, body.connection_id, body.token))
    }
    if (body.action === 'validate') {
      return json(env, 200, await validate(deps, userId, body.connection_id))
    }
    throw new HttpError(400, 'Acțiune necunoscută.')
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    console.error('source-credentials: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.' })
  }
}

// --- Autentificare și autorizare --------------------------------------------------------------

async function authenticate(req: Request, { env, fetch }: HandlerDeps): Promise<string> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(auth)) throw new HttpError(401, 'Autentificare necesară.')
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: env.anonKey, Authorization: auth },
  })
  if (!res.ok) throw new HttpError(401, 'Sesiune invalidă sau expirată.')
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new HttpError(401, 'Sesiune invalidă.')
  return user.id
}

function serviceHeaders(env: HandlerEnv): Record<string, string> {
  return {
    apikey: env.serviceRoleKey,
    Authorization: `Bearer ${env.serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

async function rest<T>(deps: HandlerDeps, path: string, init: RequestInit = {}): Promise<T> {
  const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...serviceHeaders(deps.env), ...(init.headers as Record<string, string> | undefined) },
  })
  const text = await res.text()
  if (!res.ok) {
    let code = ''
    try {
      code = (JSON.parse(text) as { code?: string }).code ?? ''
    } catch {
      // ignorat
    }
    if (code === '42501') throw new HttpError(403, 'Acces refuzat.')
    if (code === 'P0002') throw new HttpError(404, 'Conexiune inexistentă, inactivă sau fără token.')
    if (code === '22023') throw new HttpError(422, 'Token gol sau prea lung.')
    throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

async function loadConnection(deps: HandlerDeps, connectionId: string): Promise<Connection> {
  const rows = await rest<Connection[]>(
    deps,
    `source_connections?select=id,tenant_id,brand_id,provider,status,credential_status&id=eq.${connectionId}`,
  )
  const conn = rows[0]
  if (!conn || conn.status !== 'active') throw new HttpError(404, 'Conexiune inexistentă sau inactivă.')
  return conn
}

/** Verificare explicită: utilizatorul e agency_admin activ în tenantul conexiunii. */
async function assertAgencyAdmin(deps: HandlerDeps, userId: string, tenantId: string): Promise<void> {
  const rows = await rest<Array<{ role: string }>>(
    deps,
    `memberships?select=role,tenants!inner(status)&tenant_id=eq.${tenantId}&user_id=eq.${userId}` +
      `&revoked_at=is.null&role=eq.agency_admin&tenants.status=eq.active`,
  )
  if (rows.length === 1) return
  // Fără niciun rol în tenant: 404, ca la RLS (nu confirmăm existența conexiunii altui client).
  const member = await rest<Array<{ role: string }>>(
    deps,
    `memberships?select=role&tenant_id=eq.${tenantId}&user_id=eq.${userId}&revoked_at=is.null`,
  )
  if (member.length === 0) throw new HttpError(404, 'Conexiune inexistentă sau inactivă.')
  throw new HttpError(403, 'Doar agency_admin al clientului poate gestiona sursele.')
}

// --- Acțiuni ---------------------------------------------------------------------------------

async function setToken(deps: HandlerDeps, userId: string, connectionId: string, token: string) {
  const conn = await loadConnection(deps, connectionId)
  await assertAgencyAdmin(deps, userId, conn.tenant_id)
  // Verificarea de rol se repetă în corpul funcției SQL.
  const status = await rest<string>(deps, 'rpc/set_source_token', {
    method: 'POST',
    body: JSON.stringify({ p_actor_user_id: userId, p_connection_id: connectionId, p_token: token }),
  })
  return { connection_id: connectionId, credential_status: status }
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function callsToday(deps: HandlerDeps, connectionId: string, day: string): Promise<number> {
  const rows = await rest<Array<{ calls: number }>>(
    deps,
    `provider_api_calls?select=calls&source_connection_id=eq.${connectionId}&call_date_utc=eq.${day}`,
  )
  return rows.reduce((sum, r) => sum + r.calls, 0)
}

async function validate(deps: HandlerDeps, userId: string, connectionId: string) {
  const conn = await loadConnection(deps, connectionId)
  await assertAgencyAdmin(deps, userId, conn.tenant_id)

  const limit = DAILY_LIMIT[conn.provider]
  if (limit === undefined) throw new HttpError(422, `Validarea nu e disponibilă pentru ${conn.provider}.`)
  if (conn.credential_status === 'missing') throw new HttpError(409, 'Conexiunea nu are token.')

  const day = utcDay(deps.now())
  const used = await callsToday(deps, connectionId, day)
  if (used >= limit) {
    return {
      connection_id: connectionId,
      credential_status: conn.credential_status,
      calls_today: used,
      daily_limit: limit,
      outcome: 'budget_exhausted',
      message: `Bugetul zilnic de ${limit} apeluri e consumat. Testarea nu a fost rulată.`,
    }
  }

  const token = await rest<string>(deps, 'rpc/get_source_token', {
    method: 'POST',
    body: JSON.stringify({ p_connection_id: connectionId }),
  })

  // Apelul se contorizează înainte de a fi făcut: un apel pornit consumă bugetul chiar dacă eșuează.
  await rest(deps, 'provider_api_calls', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: conn.tenant_id,
      brand_id: conn.brand_id,
      source_connection_id: connectionId,
      call_date_utc: day,
      purpose: 'validate',
      calls: 1,
      actor_user_id: userId,
    }),
  })

  let httpStatus: number | null = null
  try {
    const res = await deps.fetch(`${CLARITY_ENDPOINT}?numOfDays=1`, { headers: { Authorization: `Bearer ${token}` } })
    httpStatus = res.status
    await res.body?.cancel()
  } catch {
    httpStatus = null
  }

  let outcome: 'valid' | 'invalid' | 'rate_limited' | 'provider_error'
  let message: string
  let credentialStatus = conn.credential_status
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    outcome = 'valid'
    message = 'Conexiunea funcționează.'
  } else if (httpStatus === 401 || httpStatus === 403) {
    outcome = 'invalid'
    message = `Clarity a refuzat tokenul (${httpStatus}). Generează un token nou din Settings → Data Export.`
  } else if (httpStatus === 429) {
    outcome = 'rate_limited'
    message = 'Clarity a răspuns 429: limita zilnică e atinsă. Starea tokenului nu s-a schimbat.'
  } else {
    outcome = 'provider_error'
    message = `Clarity nu a răspuns corect (${httpStatus ?? 'eroare de rețea'}). Starea tokenului nu s-a schimbat.`
  }

  if (outcome === 'valid' || outcome === 'invalid') {
    credentialStatus = await rest<string>(deps, 'rpc/record_source_validation', {
      method: 'POST',
      body: JSON.stringify({
        p_connection_id: connectionId,
        p_ok: outcome === 'valid',
        p_error: outcome === 'invalid' ? `HTTP ${httpStatus}` : null,
      }),
    })
  }

  await rest(deps, 'audit_events', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      tenant_id: conn.tenant_id,
      brand_id: conn.brand_id,
      actor_user_id: userId,
      actor_type: 'user',
      action: 'credential_validated',
      entity_type: 'source_connections',
      entity_id: connectionId,
      after: { outcome, http_status: httpStatus, credential_status: credentialStatus },
    }),
  })

  return {
    connection_id: connectionId,
    credential_status: credentialStatus,
    calls_today: used + 1,
    daily_limit: limit,
    outcome,
    message,
  }
}
