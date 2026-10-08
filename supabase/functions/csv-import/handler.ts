// Funcția server pentru importul CSV asistat.
//
// POST { action: "template", source }
// POST { action: "preview", brand_id, source, file_name, content_base64, declared: { currency, timezone, attribution_config?, click_type? } }
// POST { action: "confirm", batch_id }
// POST { action: "report", batch_id, offset? }
//
// Autorizare (la fiecare acțiune, inclusiv confirmarea): JWT-ul utilizatorului citește brandul prin RLS (deci are brand_access
// sau e agency_admin) și propriul membership (rol agency_admin sau account). Scrierile se fac apoi cu service role.
// Rolurile strategist și client_viewer nu pot importa.

import { isSource, templateCsv } from '../_shared/csv-import/contracts.ts'
import { restImportDb } from '../_shared/csv-import/rest-db.ts'
import { assertUuid, batchReport, confirmImport, ImportError, loadBatch, previewImport, type ImportDb } from '../_shared/csv-import/service.ts'

export type HandlerEnv = { supabaseUrl: string; serviceRoleKey: string; anonKey: string; allowedOrigin?: string }
export type HandlerDeps = { env: HandlerEnv; fetch: (input: string, init?: RequestInit) => Promise<Response>; now: () => Date; db?: ImportDb }

const IMPORT_ROLES = new Set(['agency_admin', 'account'])

function cors(env: HandlerEnv): Record<string, string> {
  if (!env.allowedOrigin) return {}
  return {
    'Access-Control-Allow-Origin': env.allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(env: HandlerEnv, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) })
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.', code: 'method_not_allowed' })

  try {
    const authHeader = req.headers.get('authorization') ?? ''
    if (!/^Bearer\s+\S+$/i.test(authHeader)) throw new ImportError(401, 'unauthenticated', 'Autentificare necesară.')
    const userId = await authenticate(deps, authHeader)

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      throw new ImportError(400, 'invalid_json', 'Corp JSON invalid.')
    }
    const db = deps.db ?? restImportDb({ url: env.supabaseUrl, serviceRoleKey: env.serviceRoleKey, fetch: deps.fetch })

    switch (body.action) {
      case 'template': {
        if (!isSource(body.source)) throw new ImportError(400, 'unknown_source', 'Sursă necunoscută.')
        return json(env, 200, { source: body.source, file_name: `${body.source}-sablon.csv`, content: templateCsv(body.source) })
      }
      case 'preview': {
        if (typeof body.brand_id !== 'string') throw new ImportError(400, 'invalid_id', 'brand_id lipsește.')
        if (typeof body.content_base64 !== 'string' || body.content_base64 === '') throw new ImportError(422, 'empty_file', 'Fișierul lipsește.')
        const { tenantId } = await authorize(deps, authHeader, userId, body.brand_id)
        let bytes: Uint8Array
        try {
          bytes = base64ToBytes(body.content_base64)
        } catch {
          throw new ImportError(400, 'invalid_base64', 'Conținutul fișierului nu e base64 valid.')
        }
        const declared = (typeof body.declared === 'object' && body.declared !== null ? body.declared : {}) as Record<string, string | null>
        const report = await previewImport(
          { db, now: deps.now },
          {
            tenant_id: tenantId, brand_id: body.brand_id, user_id: userId, source: String(body.source ?? ''),
            file_name: typeof body.file_name === 'string' ? body.file_name : null, bytes, declared,
          },
        )
        return json(env, 200, report)
      }
      case 'confirm':
      case 'report': {
        if (typeof body.batch_id !== 'string') throw new ImportError(400, 'invalid_id', 'batch_id lipsește.')
        assertUuid(body.batch_id, 'batch_id')
        const batch = await loadBatchForUser(deps, db, authHeader, userId, body.batch_id)
        if (body.action === 'report') {
          return json(env, 200, await batchReport(db, batch, typeof body.offset === 'number' ? body.offset : 0))
        }
        return json(env, 200, await confirmImport({ db, now: deps.now }, batch, userId))
      }
      default:
        throw new ImportError(400, 'unknown_action', 'Acțiune necunoscută.')
    }
  } catch (err) {
    if (err instanceof ImportError) return json(env, err.status, { error: err.message, code: err.code })
    console.error('csv-import: eroare internă', (err as Error).name)
    return json(env, 500, { error: 'Eroare internă.', code: 'internal' })
  }
}

async function authenticate({ env, fetch }: HandlerDeps, authHeader: string): Promise<string> {
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: authHeader } })
  if (!res.ok) throw new ImportError(401, 'invalid_session', 'Sesiune invalidă sau expirată.')
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string') throw new ImportError(401, 'invalid_session', 'Sesiune invalidă.')
  assertUuid(user.id, 'user_id')
  return user.id
}

/** Citiri cu JWT-ul utilizatorului: RLS decide ce vede. */
async function userRest<T>(deps: HandlerDeps, authHeader: string, path: string): Promise<T[]> {
  const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/${path}`, { headers: { apikey: deps.env.anonKey, Authorization: authHeader } })
  if (!res.ok) throw new ImportError(403, 'forbidden', 'Acces refuzat.')
  return ((await res.json()) ?? []) as T[]
}

/**
 * Importul cere: brandul vizibil utilizatorului (brand_access sau agency_admin, evaluat de RLS) ȘI rol agency_admin / account.
 * Brandul invizibil → 404 (nu confirmă existența). Rol nepermis → 403.
 */
async function authorize(deps: HandlerDeps, authHeader: string, userId: string, brandId: string): Promise<{ tenantId: string }> {
  assertUuid(brandId, 'brand_id')
  const brands = await userRest<{ id: string; tenant_id: string }>(deps, authHeader, `brands?select=id,tenant_id&id=eq.${brandId}`)
  const brand = brands[0]
  if (!brand) throw new ImportError(404, 'brand_not_found', 'Brand inexistent sau fără acces.')
  assertUuid(brand.tenant_id, 'tenant_id')
  const memberships = await userRest<{ role: string }>(
    deps, authHeader, `memberships?select=role&tenant_id=eq.${brand.tenant_id}&user_id=eq.${userId}&revoked_at=is.null`,
  )
  if (!memberships.some((m) => IMPORT_ROLES.has(m.role))) {
    throw new ImportError(403, 'role_not_allowed', 'Doar rolurile agency_admin și account pot importa.')
  }
  return { tenantId: brand.tenant_id }
}

async function loadBatchForUser(deps: HandlerDeps, db: ImportDb, authHeader: string, userId: string, batchId: string) {
  const batch = await loadBatch(db, batchId)
  // Autorizarea se repetă pe brandul lotului (accesul poate fi revocat între previzualizare și confirmare).
  const { tenantId } = await authorize(deps, authHeader, userId, batch.brand_id)
  if (tenantId !== batch.tenant_id) throw new ImportError(404, 'batch_not_found', 'Lot inexistent.')
  return batch
}
