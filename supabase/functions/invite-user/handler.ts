// Funcția server de invitare. Independentă de runtime (doar fetch), testabilă în Node.
//
// POST { action: "invite", email, tenant_id, role, brand_ids[] } → invită, creează membership și acces (doar agency_admin)
// POST { action: "people", tenant_id }                          → persoanele tenantului cu nume și email (doar agency_admin)
//
// Cheia service role trăiește doar aici. Pașii de business (membership, brand_access, audit) rulează
// atomic în public.invite_user_grant; dacă ea eșuează, utilizatorul tocmai creat de invitație se șterge.

export type HandlerEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  allowedOrigin?: string
  inviteRedirectTo?: string
}

export type HandlerDeps = {
  env: HandlerEnv
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

export const ROLES = ['agency_admin', 'strategist', 'account', 'client_viewer'] as const
export type Role = (typeof ROLES)[number]
const MAX_BRANDS = 50

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i

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

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corp JSON invalid.')
    if (typeof body.tenant_id !== 'string' || !UUID.test(body.tenant_id)) throw new HttpError(400, 'tenant_id invalid.')
    const tenantId = body.tenant_id

    if (body.action === 'invite') return json(env, 200, await invite(deps, userId, tenantId, body))
    if (body.action === 'people') return json(env, 200, await people(deps, userId, tenantId))
    throw new HttpError(400, 'Acțiune necunoscută.')
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    // Fără mesajul erorii: poate conține adrese de e-mail.
    console.error('invite-user: eroare internă', (err as Error).name)
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
    if (code === '22023') throw new HttpError(422, 'Date de invitare invalide (rol, branduri sau parametri).')
    if (code === '23503') throw new HttpError(422, 'Unul sau mai multe branduri nu există sau nu aparțin acestui client.')
    if (code === '23505') throw new HttpError(409, 'Persoana are deja acces la acest client.')
    throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

/** Verificare explicită: utilizatorul e agency_admin activ în tenantul cerut. */
async function assertAgencyAdmin(deps: HandlerDeps, userId: string, tenantId: string): Promise<void> {
  const rows = await rest<Array<{ role: string }>>(
    deps,
    `memberships?select=role,tenants!inner(status)&tenant_id=eq.${tenantId}&user_id=eq.${userId}` +
      `&revoked_at=is.null&role=eq.agency_admin&tenants.status=eq.active`,
  )
  if (rows.length === 1) return
  // Fără niciun rol în tenant: 404, ca să nu confirmăm existența clientului.
  const member = await rest<Array<{ role: string }>>(
    deps,
    `memberships?select=role&tenant_id=eq.${tenantId}&user_id=eq.${userId}&revoked_at=is.null`,
  )
  if (member.length === 0) throw new HttpError(404, 'Client inexistent sau fără acces.')
  throw new HttpError(403, 'Doar agency_admin al clientului poate gestiona utilizatorii.')
}

// --- Validare ---------------------------------------------------------------------------------

type InviteInput = { email: string; role: Role; brandIds: string[] }

function parseInvite(body: Record<string, unknown>): InviteInput {
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (rawEmail.length === 0 || rawEmail.length > 254 || !EMAIL.test(rawEmail)) {
    throw new HttpError(422, 'Adresa de e-mail nu este validă.')
  }
  if (typeof body.role !== 'string' || !(ROLES as readonly string[]).includes(body.role)) {
    throw new HttpError(422, `Rol invalid. Valori permise: ${ROLES.join(', ')}.`)
  }
  const role = body.role as Role
  const rawBrands = body.brand_ids === undefined ? [] : body.brand_ids
  if (!Array.isArray(rawBrands) || rawBrands.length > MAX_BRANDS) {
    throw new HttpError(422, `brand_ids trebuie să fie o listă de cel mult ${MAX_BRANDS} branduri.`)
  }
  if (!rawBrands.every((b): b is string => typeof b === 'string' && UUID.test(b))) {
    throw new HttpError(422, 'brand_ids conține un identificator invalid.')
  }
  const brandIds = [...new Set(rawBrands.map((b) => b.toLowerCase()))]
  if (role === 'agency_admin' && brandIds.length > 0) {
    throw new HttpError(422, 'agency_admin vede toate brandurile clientului; nu se alocă branduri.')
  }
  if (role !== 'agency_admin' && brandIds.length === 0) {
    throw new HttpError(422, 'Acest rol cere cel puțin un brand.')
  }
  return { email: rawEmail, role, brandIds }
}

// --- Acțiuni ---------------------------------------------------------------------------------

async function invite(deps: HandlerDeps, actorId: string, tenantId: string, body: Record<string, unknown>) {
  await assertAgencyAdmin(deps, actorId, tenantId)
  const input = parseInvite(body)

  // Verificare prealabilă, ca să nu trimitem e-mailuri pentru o cerere care va fi respinsă.
  // Verificarea se repetă în corpul funcției SQL.
  if (input.brandIds.length > 0) {
    const found = await rest<Array<{ id: string }>>(
      deps,
      `brands?select=id&tenant_id=eq.${tenantId}&status=eq.active&id=in.(${input.brandIds.join(',')})`,
    )
    if (found.length !== input.brandIds.length) {
      throw new HttpError(422, 'Unul sau mai multe branduri nu există sau nu aparțin acestui client.')
    }
  }

  const invitedId = await inviteByEmail(deps, input.email)

  let membershipId: string
  try {
    membershipId = await rest<string>(deps, 'rpc/invite_user_grant', {
      method: 'POST',
      body: JSON.stringify({
        p_actor_user_id: actorId,
        p_tenant_id: tenantId,
        p_invited_user_id: invitedId,
        p_role: input.role,
        p_brand_ids: input.brandIds,
      }),
    })
  } catch (err) {
    await discardInvitedUser(deps, invitedId)
    throw err
  }

  return {
    tenant_id: tenantId,
    user_id: invitedId,
    membership_id: membershipId,
    email: input.email,
    role: input.role,
    brand_ids: input.brandIds,
  }
}

async function inviteByEmail(deps: HandlerDeps, email: string): Promise<string> {
  const { env } = deps
  const redirect = env.inviteRedirectTo ? `?redirect_to=${encodeURIComponent(env.inviteRedirectTo)}` : ''
  const res = await deps.fetch(`${env.supabaseUrl}/auth/v1/invite${redirect}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify({ email }),
  })
  if (res.ok) {
    const user = (await res.json()) as { id?: unknown }
    if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new Error('Auth invite: răspuns fără id')
    return user.id
  }
  let code = ''
  try {
    code = ((await res.json()) as { error_code?: string }).error_code ?? ''
  } catch {
    // ignorat
  }
  if (code === 'email_exists' || code === 'user_already_exists') {
    throw new HttpError(409, 'Există deja un cont cu această adresă de e-mail.')
  }
  if (res.status === 429 || code === 'over_email_send_rate_limit') {
    throw new HttpError(429, 'Prea multe e-mailuri trimise. Încearcă din nou peste câteva minute.')
  }
  if (res.status === 400 || res.status === 422) throw new HttpError(422, 'Adresa de e-mail nu este acceptată de serviciul de autentificare.')
  throw new HttpError(502, 'Serviciul de autentificare nu a putut trimite invitația.')
}

/**
 * Compensare: șterge utilizatorul creat de invitație dacă pașii SQL au eșuat, ca să nu rămână un cont fără rol.
 * Un utilizator care are deja membership (invitat anterior în alt tenant, încă neconfirmat) nu se șterge.
 */
async function discardInvitedUser(deps: HandlerDeps, invitedId: string): Promise<void> {
  try {
    // Căutare intenționat fără tenant_id: aflăm doar dacă utilizatorul are vreun rol oriunde; nu se returnează datele.
    const roles = await rest<Array<{ id: string }>>(deps, `memberships?select=id&user_id=eq.${invitedId}&limit=1`)
    if (roles.length > 0) return
    const res = await deps.fetch(`${deps.env.supabaseUrl}/auth/v1/admin/users/${invitedId}`, {
      method: 'DELETE',
      headers: serviceHeaders(deps.env),
    })
    if (!res.ok) console.error('invite-user: compensarea a eșuat', res.status)
  } catch (err) {
    console.error('invite-user: compensarea a eșuat', (err as Error).name)
  }
}

async function people(deps: HandlerDeps, actorId: string, tenantId: string) {
  await assertAgencyAdmin(deps, actorId, tenantId)
  const rows = await rest<
    Array<{ user_id: string; email: string | null; full_name: string | null; invited_at: string | null; last_sign_in_at: string | null }>
  >(deps, 'rpc/list_tenant_people', {
    method: 'POST',
    body: JSON.stringify({ p_actor_user_id: actorId, p_tenant_id: tenantId }),
  })
  return { tenant_id: tenantId, people: rows }
}
