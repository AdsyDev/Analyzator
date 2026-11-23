// Colectarea reclamelor competitorilor din Google Ads Transparency Center (deciziile Y), săptămânal.
//
// Ce se colectează: ID-urile de advertiser (AR…) de pe membrii setului de competitori în vigoare azi și ai versiunilor viitoare,
// pentru fiecare brand. O singură interogare BigQuery per client (toți advertiserii lui), plătită de proiectul service account-ului
// `google_service_account` al clientului; rezultatul se scrie pe fiecare brand, doar pentru advertiserii din setul lui.
// Fiecare brand are un sync_run `ads_transparency`. Fără service account sau fără advertiseri: `not_connected`, fără sync_run.

import { calendarDateIn, addDaysIso } from '../google/dates.ts'
import { loadCredentials } from '../google/collect-core.ts'
import { loadActiveConnections, recordProviderCalls, utcDay } from '../shared/connections.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunHandle, type SyncRunResult } from '../shared/sync-runs.ts'
import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { runQuery, serviceAccountRequest, type AuthedRequest } from './bigquery.ts'
import { BILLING_PROJECT_ENV, CREDENTIAL_PROVIDER, DEFAULT_MAX_GB, MAX_GB_ENV, MAX_ROWS, REGION, SCHEMA_MAX_BYTES, SOURCE, TRACKER_SOURCE } from './config.ts'
import { AD_SKIP_LABELS, ADVERTISER_ID, OPTIONAL_COLUMNS, REGION_FIELDS, REQUIRED_FIELDS, SCHEMA_SQL, adRow, creativesSql, recordsOf, type AdSkipReason } from './normalize.ts'

export type AdsDeps = {
  db: Db
  /** Cererea autentificată pentru un service account; implicit google-auth-library. */
  request?: (credentials: { client_email: string; private_key: string }) => AuthedRequest
  now?: () => Date
  env?: Record<string, string | undefined>
}

export type AdsOutcome = {
  tenant_id: string
  brand_id: string
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  sync_run_id: string | null
  rows_written: number
  errors: SyncRunError[]
  reason?: string
}

export const KEYS = {
  competitor_ads: ['tenant_id', 'brand_id', 'source', 'advertiser_id', 'native_ad_id', 'region_code'],
  competitor_trackers: ['tenant_id', 'brand_id', 'source', 'external_id'],
} as const

type SetRow = { id: string; tenant_id: string; brand_id: string; effective_from: string }
type MemberRow = { competitor_set_id: string; tenant_id: string; brand_id: string; ads_advertiser_ids: string[] | null }

/**
 * Advertiserii de colectat pe brand: din versiunea setului în vigoare azi și din versiunile viitoare (ca datele să existe
 * când o versiune nouă intră în vigoare). Versiunile trecute nu se mai colectează.
 */
export function advertisersByBrand(sets: SetRow[], members: MemberRow[], today: string): Map<string, { tenant_id: string; ids: string[] }> {
  const byBrand = new Map<string, SetRow[]>()
  for (const s of sets) byBrand.set(s.brand_id, [...(byBrand.get(s.brand_id) ?? []), s])
  const out = new Map<string, { tenant_id: string; ids: string[] }>()
  for (const [brand, list] of byBrand) {
    const current = list.filter((s) => s.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
    const wanted = new Set(list.filter((s) => s.effective_from > today || s.id === current?.id).map((s) => s.id))
    const ids = new Set<string>()
    for (const m of members) {
      if (m.brand_id !== brand || !wanted.has(m.competitor_set_id)) continue
      for (const id of m.ads_advertiser_ids ?? []) if (ADVERTISER_ID.test(id)) ids.add(id)
    }
    if (ids.size > 0) out.set(brand, { tenant_id: list[0]!.tenant_id, ids: [...ids].sort() })
  }
  return out
}

function statusOf(errors: SyncRunError[], fatal: boolean): SyncRunResult['status'] {
  if (fatal) return 'failed'
  return errors.some((e) => !e.code.startsWith('parser_')) ? 'partial' : 'succeeded'
}

export async function collectAdsTransparency(deps: AdsDeps): Promise<AdsOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const env = deps.env ?? process.env
  const today = calendarDateIn(now(), 'Europe/Bucharest')

  const sets = await db.select<SetRow>('competitor_sets', 'select=id,tenant_id,brand_id,effective_from')
  const members = await db.select<MemberRow>('competitor_set_members', 'select=competitor_set_id,tenant_id,brand_id,ads_advertiser_ids')
  const wanted = advertisersByBrand(sets, members, today)

  const credentials = await loadActiveConnections(db, CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c.id]))

  const outcomes: AdsOutcome[] = []
  const byTenant = new Map<string, Array<{ brand_id: string; ids: string[] }>>()
  for (const [brand, w] of wanted) {
    if (!credentialByTenant.has(w.tenant_id)) {
      outcomes.push({ tenant_id: w.tenant_id, brand_id: brand, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason: 'service account Google neconfigurat sau invalid pentru acest client' })
      continue
    }
    byTenant.set(w.tenant_id, [...(byTenant.get(w.tenant_id) ?? []), { brand_id: brand, ids: w.ids }])
  }
  for (const [tenantId, brands] of byTenant) outcomes.push(...(await collectTenant(deps, tenantId, credentialByTenant.get(tenantId)!, brands, now, env, today)))
  return outcomes
}

async function collectTenant(
  deps: AdsDeps,
  tenantId: string,
  credentialId: string,
  brands: Array<{ brand_id: string; ids: string[] }>,
  now: () => Date,
  env: Record<string, string | undefined>,
  today: string,
): Promise<AdsOutcome[]> {
  const { db } = deps
  assertUuid(tenantId, 'tenant_id')
  // Datele Google sunt considerate complete până ieri (ziua de azi poate fi incompletă); de confirmat la prima rulare reală.
  const asOf = addDaysIso(today, -1)
  const runs: Array<{ brand_id: string; ids: string[]; handle: SyncRunHandle }> = []
  for (const b of brands) {
    assertUuid(b.brand_id, 'brand_id')
    const handle = await startSyncRun(db, { tenant_id: tenantId, brand_id: b.brand_id, source: SOURCE, source_connection_id: credentialId, period_start: asOf, period_end: asOf }, now)
    runs.push({ ...b, handle })
  }
  const finish = async (run: (typeof runs)[number], errors: SyncRunError[], rows: number, fatal: boolean): Promise<AdsOutcome> => {
    const status = statusOf(errors, fatal)
    await finishSyncRun(db, run.handle, { status, rows_written: rows, attempt_count: 1, errors }, now)
    return { tenant_id: tenantId, brand_id: run.brand_id, status, sync_run_id: run.handle.id, rows_written: rows, errors }
  }
  const failAll = async (error: SyncRunError) => Promise.all(runs.map((r) => finish(r, [error], 0, true)))

  const sa = await loadCredentials(db, credentialId)
  if (!sa.ok) return await failAll({ code: sa.code, status: null, message: sa.message })
  const project = (env[BILLING_PROJECT_ENV] ?? '').trim() || sa.value.project_id || ''
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) {
    return await failAll({ code: 'billing_project_missing', status: null, message: `Proiectul Google Cloud care plătește interogarea lipsește sau e invalid (project_id din service account sau ${BILLING_PROJECT_ENV}).` })
  }
  const maxGb = Number(env[MAX_GB_ENV] ?? DEFAULT_MAX_GB)
  const maxBytesBilled = (Number.isFinite(maxGb) && maxGb > 0 ? maxGb : DEFAULT_MAX_GB) * 1e9

  const allIds = [...new Set(brands.flatMap((b) => b.ids))].sort()
  const request = (deps.request ?? serviceAccountRequest)({ client_email: sa.value.client_email, private_key: sa.value.private_key })

  // Schema tabelului, înaintea interogării: numele câmpurilor nu sunt publicate în afara consolei Google Cloud.
  const schema = await runQuery(request, { project, sql: SCHEMA_SQL, params: [], maxBytesBilled: SCHEMA_MAX_BYTES })
  if (!schema.ok) {
    await recordProviderCalls(db, { tenant_id: tenantId, brand_id: null, source_connection_id: credentialId, call_date_utc: utcDay(now()), purpose: 'collect', calls: schema.calls })
    const hint = schema.reason === 'access_denied' || schema.reason === 'accessDenied' ? ' Service account-ul are nevoie de rolul BigQuery Job User în proiect și de API-ul BigQuery activ.' : ''
    return await failAll({ code: schema.reason, status: schema.status, dimension: 'schema', message: `${schema.message}${hint}` })
  }
  const fieldIdx = schema.fields.indexOf('field_path')
  const present = new Set(schema.rows.map((r) => (r[fieldIdx] ?? '').toLowerCase()).filter(Boolean))
  const missing = REQUIRED_FIELDS.filter((f) => !present.has(f))
  if (missing.length > 0) {
    await recordProviderCalls(db, { tenant_id: tenantId, brand_id: null, source_connection_id: credentialId, call_date_utc: utcDay(now()), purpose: 'collect', calls: schema.calls })
    const found = [...present].sort().slice(0, 60).join(', ') || 'niciunul'
    return await failAll({ code: 'schema_changed', status: null, dimension: 'schema', message: `Tabelul creative_stats nu are câmpurile ${missing.join(', ')}. Câmpuri găsite: ${found}.` })
  }
  const schemaNotes: SyncRunError[] = []
  const absent = [...OPTIONAL_COLUMNS.filter((c) => !present.has(c)), ...REGION_FIELDS.filter((f) => !present.has(`region_stats.${f}`)).map((f) => `region_stats.${f}`)]
  if (absent.length > 0) schemaNotes.push({ code: 'parser_note', status: null, dimension: 'schema', message: `câmpuri absente din creative_stats, lăsate NULL: ${absent.join(', ')}` })

  const result = await runQuery(request, {
    project,
    sql: creativesSql(present),
    params: [
      { name: 'advertiser_ids', type: 'ARRAY<STRING>', values: allIds },
      { name: 'region', type: 'STRING', value: REGION },
    ],
    maxBytesBilled,
  })
  await recordProviderCalls(db, { tenant_id: tenantId, brand_id: null, source_connection_id: credentialId, call_date_utc: utcDay(now()), purpose: 'collect', calls: schema.calls + result.calls })
  if (!result.ok) {
    const hint = result.reason === 'bytesBilledLimitExceeded'
      ? ` Plafonul e ${maxBytesBilled / 1e9} GB (${MAX_GB_ENV}).`
      : result.reason === 'access_denied' || result.reason === 'accessDenied'
        ? ' Service account-ul are nevoie de rolul BigQuery Job User în proiect și de API-ul BigQuery activ.'
        : ''
    return await failAll({ code: result.reason, status: result.status, message: `${result.message}${hint}` })
  }

  const records = recordsOf(result.fields, result.rows)
  const collectedAt = now().toISOString()
  const notes: SyncRunError[] = [...schemaNotes]
  if (result.bytesBilled !== null) notes.push({ code: 'parser_note', status: null, dimension: 'bytes_billed', message: `BigQuery: ${(result.bytesBilled / 1e9).toFixed(2)} GB facturați pentru ${allIds.length} advertiseri` })
  const truncated = result.truncated || records.length > MAX_ROWS
  const out: AdsOutcome[] = []
  for (const run of runs) {
    const errors: SyncRunError[] = [...notes]
    let rows = 0
    try {
      const scope = { tenant_id: tenantId, brand_id: run.brand_id }
      const mine = new Set(run.ids)
      const ads: Row[] = []
      const skipped = new Map<AdSkipReason, number>()
      const names = new Map<string, string>()
      for (const rec of records.slice(0, MAX_ROWS)) {
        if (!mine.has((rec.advertiser_id ?? '').trim())) continue
        const r = adRow(rec, { ...scope, source_id: credentialId, sync_run_id: run.handle.id, collected_at: collectedAt })
        if (!r.ok) {
          skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1)
          continue
        }
        ads.push(r.row)
        if (r.row.advertiser_name) names.set(r.row.advertiser_id as string, r.row.advertiser_name as string)
      }
      for (const [reason, n] of skipped) errors.push({ code: 'parser_note', status: null, dimension: 'ads_skipped', message: `${n} ${n === 1 ? 'reclamă sărită' : 'reclame sărite'}: ${AD_SKIP_LABELS[reason]}` })
      if (truncated) errors.push({ code: 'truncated', status: null, dimension: 'creative_stats', message: `Rezultatul depășește ${MAX_ROWS} de rânduri; restul nu a fost citit.` })
      rows += await upsertScoped(db, 'competitor_ads', KEYS.competitor_ads, ads, scope)
      // Fiecare advertiser interogat, cu sau fără reclame: zero reclame e un zero real numai dacă advertiserul a fost interogat.
      const trackers = run.ids.map((id) => ({
        ...scope,
        source: TRACKER_SOURCE,
        external_id: id,
        label: names.get(id) ?? null,
        covered_from: null,
        covered_to: asOf,
        complete: !truncated,
        last_seen_at: collectedAt,
        source_id: credentialId,
        sync_run_id: run.handle.id,
      }))
      rows += await upsertScoped(db, 'competitor_trackers', KEYS.competitor_trackers, trackers, scope)
      out.push(await finish(run, errors, rows, false))
    } catch (err) {
      errors.push({ code: 'exception', status: null, message: (err as Error).message })
      out.push(await finish(run, errors, rows, true))
    }
  }
  return out
}
