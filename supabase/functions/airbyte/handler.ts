// Funcția server pentru destinația Postgres Airbyte (E-6). Independentă de runtime: fetch pentru Supabase, iar
// rezolvarea DNS și conexiunea Postgres vin injectate (index.ts în Deno, dubluri în teste).
//
// POST { action: "inspect", connection_id } → ce tabele Meta / Google Ads / TikTok vede utilizatorul read-only,
//   conturile din ele, perioada și metricile (doar agency_admin al clientului; consumă din limita zilnică)
//
// Connection string-ul stă în Vault (cheia clientului `airbyte_postgres`) și nu apare în răspuns sau în loguri.

import { ALLOWED_HEADERS } from '../_shared/cors.ts'
import { checkResolved, parseCredential } from './dsn.ts'
import { inspect, PgError, PLATFORM_LABEL, type Inspection, type PgErrorKind, type PgSession, type PgTarget } from './inspect.ts'

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
  /** Adresele A și AAAA ale numelui; `[]` dacă numele nu există. */
  resolve: (host: string) => Promise<string[]>
  connect: <T>(target: PgTarget, run: (session: PgSession) => Promise<T>) => Promise<T>
}

/** Cheia clientului (brand_id NULL) cu connection string-ul destinației. */
export const TENANT_PROVIDER = 'airbyte_postgres'
/** Inspecții permise pe zi (UTC) per cheie; fiecare deschide o conexiune la serverul clientului. */
export const INSPECT_DAILY_LIMIT = 30
/** Cât poate dura citirea tabelelor; peste, tabelele rămase apar ca sărite. */
export const INSPECT_BUDGET_MS = 45_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Connection = {
  id: string
  tenant_id: string
  brand_id: string | null
  provider: string
  status: string
  credential_status: string
}

export type InspectOutcome =
  | 'ok'
  | 'budget_exhausted'
  | 'invalid_dsn'
  | 'tls_required'
  | 'host_not_allowed'
  | 'dns_failed'
  | 'auth_failed'
  | 'database_not_found'
  | 'tls_failed'
  | 'unreachable'
  | 'timeout'
  | 'permission_denied'
  | 'not_read_only'
  | 'database_error'

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
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
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
    let body: { action?: unknown; connection_id?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    if (typeof body.connection_id !== 'string' || !UUID.test(body.connection_id)) throw new HttpError(400, 'connection_id invalid.')
    if (body.action === 'inspect') return json(env, 200, await inspectConnection(deps, userId, body.connection_id))
    throw new HttpError(400, 'Acțiune necunoscută.')
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    console.error('airbyte: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.' })
  }
}

// --- Autentificare și autorizare (la fel ca source-credentials) -----------------------------------

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
    headers: {
      apikey: deps.env.serviceRoleKey,
      Authorization: `Bearer ${deps.env.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
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
    if (code === 'P0002') throw new HttpError(404, 'Conexiune inexistentă, inactivă sau fără connection string.')
    throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

async function loadConnection(deps: HandlerDeps, connectionId: string): Promise<Connection> {
  const rows = await rest<Connection[]>(deps, `source_connections?select=id,tenant_id,brand_id,provider,status,credential_status&id=eq.${connectionId}`)
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
  const member = await rest<Array<{ role: string }>>(deps, `memberships?select=role&tenant_id=eq.${tenantId}&user_id=eq.${userId}&revoked_at=is.null`)
  if (member.length === 0) throw new HttpError(404, 'Conexiune inexistentă sau inactivă.')
  throw new HttpError(403, 'Doar agency_admin al clientului poate gestiona sursele.')
}

// --- Inspecția ---------------------------------------------------------------------------------

/** Ce înseamnă fiecare eroare a driverului și dacă invalidează credențiala (configurare greșită, nu o pană). */
const PG_OUTCOMES: Record<PgErrorKind, { outcome: InspectOutcome; invalid: boolean; message: (host: string, port: number) => string }> = {
  auth: { outcome: 'auth_failed', invalid: true, message: () => 'Serverul a refuzat utilizatorul sau parola (sau nu permite conexiuni de la Supabase în pg_hba.conf).' },
  database_not_found: { outcome: 'database_not_found', invalid: true, message: () => 'Baza de date din connection string nu există pe server.' },
  tls: {
    outcome: 'tls_failed', invalid: true,
    message: (host) => `Conexiunea TLS a eșuat: serverul nu are TLS activat sau certificatul nu e valid pentru ${host} (emis de o autoritate publică sau de CA-ul atașat).`,
  },
  unreachable: { outcome: 'unreachable', invalid: false, message: (host, port) => `Serverul ${host} nu răspunde pe portul ${port}. Verifică firewall-ul și dacă Postgres ascultă pe adresa publică.` },
  timeout: { outcome: 'timeout', invalid: false, message: () => 'Serverul nu a răspuns la timp. Încearcă din nou peste câteva minute.' },
  permission: { outcome: 'permission_denied', invalid: true, message: () => 'Utilizatorul nu are drept de conectare la baza de date (GRANT CONNECT).' },
  not_read_only: { outcome: 'not_read_only', invalid: true, message: () => 'Sesiunea nu a putut fi pusă în modul read-only (un pooler ignoră parametrii de pornire?). Conexiunea a fost închisă fără nicio citire.' },
  other: { outcome: 'database_error', invalid: false, message: () => 'Serverul Postgres a răspuns cu o eroare neașteptată.' },
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function summaryMessage(result: Inspection): string {
  const tables = result.platforms.reduce((n, p) => n + p.tables.filter((t) => t.role === 'report').length, 0)
  if (tables === 0) {
    return 'Conexiunea funcționează, dar utilizatorul nu vede niciun tabel Meta, Google Ads sau TikTok. Verifică GRANT SELECT pe schemele Airbyte.'
  }
  const labels = result.platforms.map((p) => p.label).join(', ')
  return `Conexiunea funcționează: ${result.accounts.length} ${result.accounts.length === 1 ? 'cont' : 'conturi'} în ${tables} ${tables === 1 ? 'tabel' : 'tabele'} (${labels}).`
}

async function inspectConnection(deps: HandlerDeps, userId: string, connectionId: string) {
  const conn = await loadConnection(deps, connectionId)
  await assertAgencyAdmin(deps, userId, conn.tenant_id)
  if (conn.brand_id !== null || conn.provider !== TENANT_PROVIDER) throw new HttpError(422, 'Conexiunea nu e cheia Airbyte a clientului.')
  if (conn.credential_status === 'missing') throw new HttpError(409, 'Connection string-ul nu e salvat.')

  const day = utcDay(deps.now())
  const used = (await rest<Array<{ calls: number }>>(
    deps,
    `provider_api_calls?select=calls&source_connection_id=eq.${connectionId}&call_date_utc=eq.${day}&purpose=eq.discover`,
  )).reduce((sum, r) => sum + r.calls, 0)

  let credentialStatus = conn.credential_status
  const base = { connection_id: connectionId, daily_limit: INSPECT_DAILY_LIMIT }
  const empty = { platforms: [], accounts: [], truncated: false, inspected_at: null }

  if (used >= INSPECT_DAILY_LIMIT) {
    return {
      ...base, ...empty, outcome: 'budget_exhausted' as InspectOutcome, credential_status: credentialStatus, calls_today: used,
      message: `Limita de ${INSPECT_DAILY_LIMIT} inspecții pe zi e atinsă pentru această conexiune.`,
    }
  }

  const recordValidation = async (ok: boolean, error: string | null) => {
    credentialStatus = await rest<string>(deps, 'rpc/record_source_validation', {
      method: 'POST',
      body: JSON.stringify({ p_connection_id: connectionId, p_ok: ok, p_error: error }),
    })
  }
  const audit = (outcome: InspectOutcome, extra: Record<string, unknown>) =>
    rest(deps, 'audit_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        tenant_id: conn.tenant_id, brand_id: null, actor_user_id: userId, actor_type: 'user', action: 'airbyte_inspected',
        entity_type: 'source_connections', entity_id: connectionId, after: { outcome, credential_status: credentialStatus, ...extra },
      }),
    })
  const fail = async (outcome: InspectOutcome, message: string, invalid: boolean, callsToday: number) => {
    if (invalid) await recordValidation(false, outcome)
    await audit(outcome, {})
    return { ...base, ...empty, outcome, credential_status: credentialStatus, calls_today: callsToday, message }
  }

  const token = await rest<string>(deps, 'rpc/get_source_token', { method: 'POST', body: JSON.stringify({ p_connection_id: connectionId }) })
  const parsed = parseCredential(token)
  if (!parsed.ok) return fail(parsed.reason, parsed.message, true, used)
  const dsn = parsed.dsn

  let addresses: string[]
  try {
    addresses = await deps.resolve(dsn.host)
  } catch {
    return fail('dns_failed', `Numele ${dsn.host} nu a putut fi rezolvat (DNS). Încearcă din nou.`, false, used)
  }
  if (addresses.length === 0) return fail('dns_failed', `Numele ${dsn.host} nu există în DNS.`, true, used)
  const resolvedCheck = checkResolved(addresses)
  if (resolvedCheck) return fail(resolvedCheck.reason, resolvedCheck.message, true, used)

  // Inspecția se contorizează înainte de conexiune: o încercare pornită consumă din limită chiar dacă eșuează.
  await rest(deps, 'provider_api_calls', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ tenant_id: conn.tenant_id, brand_id: null, source_connection_id: connectionId, call_date_utc: day, purpose: 'discover', calls: 1, actor_user_id: userId }),
  })

  const started = deps.now().getTime()
  let result: Inspection
  try {
    result = await deps.connect(
      { ip: addresses[0]!, servername: dsn.host, port: dsn.port, user: dsn.user, password: dsn.password, database: dsn.database, ca: dsn.ca },
      (session) => inspect(session, started + INSPECT_BUDGET_MS, () => deps.now().getTime()),
    )
  } catch (err) {
    const kind: PgErrorKind = err instanceof PgError ? err.kind : 'other'
    const o = PG_OUTCOMES[kind]
    return fail(o.outcome, o.message(dsn.host, dsn.port), o.invalid, used + 1)
  }

  await recordValidation(true, null)
  const tables = result.platforms.flatMap((p) => p.tables)
  await audit('ok', {
    tables: tables.length,
    accounts: result.accounts.length,
    platforms: result.platforms.map((p) => p.platform),
    table_errors: tables.filter((t) => t.error !== null).length,
  })

  return {
    ...base,
    outcome: 'ok' as InspectOutcome,
    credential_status: credentialStatus,
    calls_today: used + 1,
    message: summaryMessage(result),
    inspected_at: deps.now().toISOString(),
    platforms: result.platforms,
    // Forma selectorului de conturi (id = external_account_id al conexiunii site-ului), plus detaliile datelor.
    accounts: result.accounts.map((a) => ({
      ...a,
      id: `${a.platform}:${a.account_id}`,
      name: a.name ?? a.account_id,
      detail: `${PLATFORM_LABEL[a.platform]} · ID ${a.account_id}`,
    })),
    truncated: result.truncated,
  }
}
