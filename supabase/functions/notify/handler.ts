// Funcția server care trimite notificările din coadă (farmacovigilență). Apelabilă de un utilizator din agenție
// (trimite doar notificările tenanților lui) sau de worker (script cu service role).
//
// POST { action: "dispatch" }  → { state, pending_before, sent, retrying, failed, waiting_for_contacts }
//
// Secretele (RESEND_API_KEY, PV_FROM_EMAIL) sunt doar în mediul funcției. Fără ele, notificările rămân `pending`.

import { restImportDb } from '../_shared/csv-import/rest-db.ts'
import { dispatchPvNotifications, type NotifyEnv } from '../_shared/notifications/queue.ts'

export type HandlerEnv = { supabaseUrl: string; serviceRoleKey: string; anonKey: string; allowedOrigin?: string } & NotifyEnv
export type HandlerDeps = { env: HandlerEnv; fetch: (input: string, init?: RequestInit) => Promise<Response>; now: () => Date; db?: ReturnType<typeof restImportDb> }

const AGENCY = new Set(['agency_admin', 'strategist', 'account'])

function cors(env: HandlerEnv): Record<string, string> {
  if (!env.allowedOrigin) return {}
  return { 'Access-Control-Allow-Origin': env.allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
}
const json = (env: HandlerEnv, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) })
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.' })
  try {
    const auth = req.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+$/i.test(auth)) return json(env, 401, { error: 'Autentificare necesară.' })

    const who = await deps.fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: auth } })
    if (!who.ok) return json(env, 401, { error: 'Sesiune invalidă sau expirată.' })
    const user = (await who.json()) as { id?: unknown }
    if (typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user.id)) return json(env, 401, { error: 'Sesiune invalidă.' })

    let body: { action?: unknown }
    try {
      body = (await req.json()) as { action?: unknown }
    } catch {
      return json(env, 400, { error: 'Corp JSON invalid.' })
    }
    if (body.action !== 'dispatch') return json(env, 400, { error: 'Acțiune necunoscută.' })

    // Tenanții utilizatorului, citiți cu propriul JWT (RLS: doar propriile membership-uri), doar rolurile de agenție.
    const res = await deps.fetch(`${env.supabaseUrl}/rest/v1/memberships?select=tenant_id,role&revoked_at=is.null`, {
      headers: { apikey: env.anonKey, Authorization: auth },
    })
    if (!res.ok) return json(env, 403, { error: 'Acces refuzat.' })
    const memberships = (await res.json()) as Array<{ tenant_id: string; role: string }>
    const tenantIds = [...new Set(memberships.filter((m) => AGENCY.has(m.role)).map((m) => m.tenant_id))]
    if (tenantIds.length === 0) return json(env, 403, { error: 'Doar utilizatorii din agenție pot declanșa trimiterea.' })

    const db = deps.db ?? restImportDb({ url: env.supabaseUrl, serviceRoleKey: env.serviceRoleKey, fetch: deps.fetch })
    const summary = await dispatchPvNotifications({
      db, fetch: deps.fetch, env: { RESEND_API_KEY: env.RESEND_API_KEY, PV_FROM_EMAIL: env.PV_FROM_EMAIL, APP_BASE_URL: env.APP_BASE_URL }, now: deps.now, tenantIds,
    })
    return json(env, 200, summary)
  } catch (err) {
    console.error('notify: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.' })
  }
}
