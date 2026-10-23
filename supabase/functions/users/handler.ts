// Funcția server pentru persoanele cu acces (E-4, excepția E10). Independentă de runtime (doar fetch), testabilă în Node.
//
// POST { action: "identities" } → 200 { people: [{ tenant_id, user_id, email, full_name, last_sign_in_at }] }
//   doar tenanții în care apelantul e agency_admin activ (filtrul e în `tenant_people_for`).
// POST { action: "invite", tenant_id, email, full_name?, role, brand_ids }
//   → 200 { status: "invited" | "access_granted" | "resent", user_id }
//
// Invitația: doar agency_admin activ al tenantului (verificat aici și din nou în `grant_invited_access`). Contul nou sau
// neactivat primește invitația Supabase pe email; un cont activ primește doar accesul; o persoană deja în listă,
// care nu și-a activat contul, primește invitația din nou ("resent"). Cheia de service nu părăsește funcția, iar
// răspunsul nu conține date despre alte conturi decât id-ul persoanei adăugate.

import { ALLOWED_HEADERS } from '../_shared/cors.ts'

export type HandlerEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  allowedOrigin?: string
  /** Adresa aplicației; linkul din invitație duce la `<appBaseUrl>/login`. Fără ea, GoTrue folosește Site URL. */
  appBaseUrl?: string
}

export type HandlerDeps = {
  env: HandlerEnv
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

export const ROLES = ['agency_admin', 'strategist', 'account', 'client_viewer'] as const
export const MAX_BRANDS = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Verificare de formă, nu de livrabilitate: GoTrue validează din nou adresa.
const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]{2,}$/
const CONTROL = /[\u0000-\u001f\u007f]/

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
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) } })
}

type Invite = { tenantId: string; email: string; fullName: string | null; role: (typeof ROLES)[number]; brandIds: string[] }

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) })
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.' })

  try {
    const actorId = await authenticate(req, deps)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    const action = (body as { action?: unknown } | null)?.action
    if (action === 'identities') return json(env, 200, await identities(deps, actorId))
    if (action === 'invite') return json(env, 200, await invitePerson(deps, actorId, parse(body)))
    throw new HttpError(400, 'Acțiune necunoscută.')
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    console.error('users: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.' })
  }
}

type Identity = { tenant_id: string; user_id: string; email: string | null; full_name: string | null; last_sign_in_at: string | null }

/**
 * Numele și emailurile persoanelor din tenanții în care actorul e agency_admin activ. Filtrul pe rol și tenant e în
 * `tenant_people_for` (SQL); un actor fără rol de agency_admin primește o listă goală, nu o eroare.
 */
async function identities(deps: HandlerDeps, actorId: string): Promise<{ people: Identity[] }> {
  const rows = await rest<Identity[]>(deps, 'rpc/tenant_people_for', { method: 'POST', body: JSON.stringify({ p_actor_user_id: actorId }) })
  return {
    people: rows.map((r) => ({ tenant_id: r.tenant_id, user_id: r.user_id, email: r.email, full_name: r.full_name, last_sign_in_at: r.last_sign_in_at })),
  }
}

export function parse(body: unknown): Invite {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.tenant_id !== 'string' || !UUID.test(b.tenant_id)) throw new HttpError(400, 'tenant_id invalid.')
  if (typeof b.email !== 'string') throw new HttpError(422, 'Completează adresa de email.')
  const email = b.email.trim().toLowerCase()
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(422, 'Adresa de email nu este validă.')
  let fullName: string | null = null
  if (b.full_name !== undefined && b.full_name !== null) {
    if (typeof b.full_name !== 'string') throw new HttpError(422, 'Numele nu este valid.')
    const n = b.full_name.trim().replace(/\s+/g, ' ')
    if (n.length > 120 || CONTROL.test(n)) throw new HttpError(422, 'Numele trebuie să aibă cel mult 120 de caractere.')
    fullName = n === '' ? null : n
  }
  if (typeof b.role !== 'string' || !(ROLES as readonly string[]).includes(b.role)) throw new HttpError(422, 'Rol necunoscut.')
  if (!Array.isArray(b.brand_ids) || b.brand_ids.length > MAX_BRANDS || !b.brand_ids.every((x) => typeof x === 'string' && UUID.test(x))) {
    throw new HttpError(422, 'Lista de branduri nu este validă.')
  }
  const brandIds = [...new Set((b.brand_ids as string[]).map((x) => x.toLowerCase()))]
  return { tenantId: b.tenant_id.toLowerCase(), email, fullName, role: b.role as Invite['role'], brandIds }
}

// --- Autentificare și apeluri cu service role --------------------------------------------------------------------

async function authenticate(req: Request, { env, fetch }: HandlerDeps): Promise<string> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(auth)) throw new HttpError(401, 'Autentificare necesară.')
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: auth } })
  if (!res.ok) throw new HttpError(401, 'Sesiune invalidă sau expirată.')
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new HttpError(401, 'Sesiune invalidă.')
  return user.id
}

function serviceHeaders(env: HandlerEnv): Record<string, string> {
  return { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, 'Content-Type': 'application/json' }
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
    if (code === '42501') throw new HttpError(403, 'Doar administratorii agenției pot invita persoane.')
    if (code === '23505') throw new HttpError(409, 'Persoana este deja în lista acestui client. Restabilește-i accesul din tabel.')
    if (code === '22023') throw new HttpError(422, 'Unul dintre brandurile alese nu există, e arhivat sau aparține altui client.')
    throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

/** Verificare explicită: apelantul e agency_admin activ în tenantul cerut (tenant activ). */
async function assertAgencyAdmin(deps: HandlerDeps, actorId: string, tenantId: string): Promise<void> {
  const rows = await rest<Array<{ role: string }>>(
    deps,
    `memberships?select=role,tenants!inner(status)&tenant_id=eq.${tenantId}&user_id=eq.${actorId}` +
      `&revoked_at=is.null&role=eq.agency_admin&tenants.status=eq.active`,
  )
  if (rows.length === 1) return
  // Fără niciun rol în tenant: 404, ca la RLS (nu confirmăm existența altui client).
  const member = await rest<Array<{ role: string }>>(deps, `memberships?select=role&tenant_id=eq.${tenantId}&user_id=eq.${actorId}&revoked_at=is.null`)
  if (member.length === 0) throw new HttpError(404, 'Client inexistent.')
  throw new HttpError(403, 'Doar administratorii agenției pot invita persoane.')
}

async function assertBrands(deps: HandlerDeps, tenantId: string, brandIds: string[]): Promise<void> {
  if (brandIds.length === 0) return
  const rows = await rest<Array<{ id: string }>>(deps, `brands?select=id&tenant_id=eq.${tenantId}&status=eq.active&id=in.(${brandIds.join(',')})`)
  if (rows.length !== brandIds.length) throw new HttpError(422, 'Unul dintre brandurile alese nu există, e arhivat sau aparține altui client.')
}

/** Trimite invitația GoTrue (creează contul dacă nu există; o retrimite unui cont neactivat). */
async function sendInvite(deps: HandlerDeps, invite: Invite): Promise<string> {
  const { env } = deps
  const redirect = env.appBaseUrl ? `?redirect_to=${encodeURIComponent(`${env.appBaseUrl.replace(/\/+$/, '')}/login`)}` : ''
  const res = await deps.fetch(`${env.supabaseUrl}/auth/v1/invite${redirect}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ email: invite.email, data: invite.fullName ? { full_name: invite.fullName } : {} }),
  })
  if (res.status === 429) throw new HttpError(429, 'S-au trimis prea multe emailuri într-un timp scurt. Reîncearcă mai târziu.')
  if (res.status === 422 || res.status === 400) {
    // Contul a devenit activ între căutare și invitație, sau adresa e refuzată de serverul de autentificare.
    throw new HttpError(409, 'Invitația nu a putut fi trimisă pentru această adresă. Reîncearcă; dacă persoana are deja cont, va primi doar accesul.')
  }
  if (!res.ok) throw new Error(`invite: ${res.status}`)
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new Error('invite: răspuns fără id')
  return user.id
}

// --- Acțiunea ----------------------------------------------------------------------------------------------------

async function invitePerson(deps: HandlerDeps, actorId: string, invite: Invite) {
  await assertAgencyAdmin(deps, actorId, invite.tenantId)
  await assertBrands(deps, invite.tenantId, invite.brandIds)

  const found = await rest<Array<{ user_id: string; confirmed: boolean }>>(deps, 'rpc/find_user_for_invite', {
    method: 'POST',
    body: JSON.stringify({ p_email: invite.email }),
  })
  const existing = found[0] ?? null
  if (existing) {
    // Verificat înainte de email: o persoană deja în listă nu primește din nou acces. Dacă nu și-a activat încă
    // contul (linkul expiră), invitația se retrimite, fără să schimbe rolul sau brandurile din listă.
    const rows = await rest<Array<{ user_id: string }>>(deps, `memberships?select=user_id&tenant_id=eq.${invite.tenantId}&user_id=eq.${existing.user_id}`)
    if (rows.length > 0) {
      if (existing.confirmed) throw new HttpError(409, 'Persoana este deja în lista acestui client. Restabilește-i accesul din tabel.')
      await sendInvite(deps, invite)
      return { status: 'resent', user_id: existing.user_id }
    }
  }

  const invited = !existing || !existing.confirmed
  const userId = invited ? await sendInvite(deps, invite) : existing.user_id

  // Rolul celui care invită se verifică din nou în funcția SQL, atomic cu scrierea.
  await rest<string>(deps, 'rpc/grant_invited_access', {
    method: 'POST',
    body: JSON.stringify({ p_actor_user_id: actorId, p_tenant_id: invite.tenantId, p_user_id: userId, p_role: invite.role, p_brand_ids: invite.brandIds }),
  })
  return { status: invited ? 'invited' : 'access_granted', user_id: userId }
}
