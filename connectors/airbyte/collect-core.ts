// Colectarea Paid Media din destinația Postgres a Airbyte-ului agenției (E-6, etapa 2) în paid_daily.
// Configurare: `airbyte_postgres` per client (connection string-ul read-only în Vault) și `airbyte` per site
// (external_account_id = `<platformă>:<ID cont>`). Contract: docs/contracts/airbyte.md.
//
// Reguli:
// - O singură metodă per cont: un cont legat și la conectorul API al platformei (meta_ads, google_ads, tiktok_ads) în
//   același client nu se colectează din Airbyte (altfel cheltuiala s-ar număra de două ori). Apare `not_connected`.
// - Rândurile se scriu ca ale conectorilor API (collection_method = api), cu source_id = conexiunea `airbyte` a site-ului,
//   sync_run cu sursa = platforma (meta_ads, google_ads, tiktok_ads) și schema_version `airbyte-postgres-v1:<tabel>`.
// - Conexiunea: aceleași verificări ca funcția server (doar nume public, IP verificat, TLS verificat, sesiune read-only).

import { checkResolved, parseCredential } from '../../supabase/functions/airbyte/dsn.ts'
import { groupTables, PgError, readColumns, type PgErrorKind, type PgSession, type PgTarget, type Platform } from '../../supabase/functions/airbyte/inspect.ts'
import { isValidTimeZone, lookbackWindow } from '../google/dates.ts'
import { PAID_KEY } from '../meta/collect-core.ts'
import { getSourceToken, loadActiveConnections } from '../shared/connections.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunHandle } from '../shared/sync-runs.ts'
import { assertUuid, type Db } from '../shared/supabase-rest.ts'
import { upsertScoped } from '../shared/upsert.ts'
import { catalogQuery, pickCatalog, pickReport, reportQuery, SPECS, toPaidRows, type ReportRow } from './streams.ts'

export const AIRBYTE_CREDENTIAL_PROVIDER = 'airbyte_postgres'
export const AIRBYTE_PROVIDER = 'airbyte'
export const AIRBYTE_LOOKBACK_DAYS = 35
/** Fusul ferestrei comune de citire; zilele din tabele sunt deja în fusul fiecărui cont. */
const WINDOW_TZ = 'Europe/Bucharest'

export type AirbyteDeps = {
  db: Db
  now?: () => Date
  resolve: (host: string) => Promise<string[]>
  connect: <T>(target: PgTarget, run: (session: PgSession) => Promise<T>) => Promise<T>
}

export type AirbyteOutcome = {
  tenant_id: string
  brand_id: string | null
  connection_id: string
  platform: Platform | null
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  sync_run_id: string | null
  rows_written: number
  errors: SyncRunError[]
  reason?: string
}

type Row = { id: string; tenant_id: string; brand_id: string | null; provider: string; external_account_id: string; status: string }
type Linked = Row & { brand_id: string; platform: Platform; account: string }

const EXTERNAL = /^(meta_ads|google_ads|tiktok_ads):(\d{1,32})$/
/** ID-ul contului din conexiunea API a platformei, în forma din tabelele Airbyte. */
const apiAccount = (external: string) => external.trim().replace(/^act_/, '').replace(/-/g, '')

/** Erorile driverului care înseamnă configurare greșită (cheia devine invalidă), nu o pană. */
const INVALIDATING: readonly PgErrorKind[] = ['auth', 'database_not_found', 'tls', 'permission', 'not_read_only']
const PG_MESSAGE: Record<PgErrorKind, string> = {
  auth: 'Serverul Airbyte a refuzat utilizatorul sau parola.',
  database_not_found: 'Baza de date din connection string nu există.',
  tls: 'Conexiunea TLS la serverul Airbyte a eșuat (certificat sau TLS oprit).',
  unreachable: 'Serverul Airbyte nu răspunde.',
  timeout: 'Serverul Airbyte nu a răspuns la timp.',
  permission: 'Utilizatorul read-only nu are drept pe baza sau pe tabel.',
  not_read_only: 'Sesiunea nu a putut fi pusă read-only; conexiunea a fost închisă fără citire.',
  other: 'Serverul Airbyte a răspuns cu o eroare neașteptată.',
}

export async function collectAirbyte(deps: AirbyteDeps): Promise<AirbyteOutcome[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const credentials = await loadActiveConnections(db, AIRBYTE_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.filter((c) => c.brand_id === null).map((c) => [c.tenant_id, c]))
  const skippedReason = new Map<string, string>()
  if (credentials.skipped.length) {
    const rows = await db.select<{ id: string; tenant_id: string }>('source_connections', `select=id,tenant_id&provider=eq.${AIRBYTE_CREDENTIAL_PROVIDER}&status=eq.active`)
    for (const s of credentials.skipped) {
      const row = rows.find((r) => r.id === s.id)
      if (row) skippedReason.set(row.tenant_id, `destinația Airbyte: ${s.reason}`)
    }
  }

  const connections = await db.select<Row>('source_connections', `select=id,tenant_id,brand_id,provider,external_account_id,status&provider=eq.${AIRBYTE_PROVIDER}&status=eq.active`)
  const api = await db.select<Row>('source_connections', 'select=id,tenant_id,brand_id,provider,external_account_id,status&provider=in.(meta_ads,google_ads,tiktok_ads)&status=eq.active')
  const viaApi = new Set(api.map((c) => `${c.tenant_id}|${c.provider}|${apiAccount(c.external_account_id)}`))

  const outcomes: AirbyteOutcome[] = []
  const byTenant = new Map<string, Linked[]>()
  for (const c of connections) {
    if (c.provider !== AIRBYTE_PROVIDER || c.status !== 'active') throw new Error(`Conexiunea ${c.id} nu corespunde filtrului; opresc rularea.`)
    const m = EXTERNAL.exec(c.external_account_id.trim())
    const nc = (reason: string, platform: Platform | null = null) =>
      outcomes.push({ tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, platform, status: 'not_connected', sync_run_id: null, rows_written: 0, errors: [], reason })
    if (!c.brand_id) nc('conexiune Airbyte fără site')
    else if (!m) nc(`contul „${c.external_account_id}” nu are forma platformă:ID (meta_ads:…, google_ads:…, tiktok_ads:…)`)
    else if (viaApi.has(`${c.tenant_id}|${m[1]}|${m[2]}`)) nc(`contul e colectat deja prin conectorul API ${m[1]}; se folosește o singură metodă per cont`, m[1] as Platform)
    else if (!credentialByTenant.has(c.tenant_id)) nc(skippedReason.get(c.tenant_id) ?? 'destinația Airbyte a clientului nu e configurată', m[1] as Platform)
    else {
      const list = byTenant.get(c.tenant_id) ?? []
      list.push({ ...c, brand_id: c.brand_id, platform: m[1] as Platform, account: m[2]! })
      byTenant.set(c.tenant_id, list)
    }
  }

  for (const [tenantId, list] of byTenant) {
    assertUuid(tenantId, 'tenant_id')
    try {
      outcomes.push(...(await collectTenant(deps, credentialByTenant.get(tenantId)!.id, list, now)))
    } catch (err) {
      // Izolare per client: o eroare neașteptată nu îi oprește pe ceilalți.
      for (const c of list) outcomes.push(await failedRun(db, c, now, 'exception', (err as Error).message))
    }
  }
  return outcomes
}

async function failedRun(db: Db, c: Linked, now: () => Date, code: string, message: string): Promise<AirbyteOutcome> {
  const w = lookbackWindow(now(), WINDOW_TZ, AIRBYTE_LOOKBACK_DAYS)
  const h = await startSyncRun(db, { tenant_id: c.tenant_id, brand_id: c.brand_id, source: c.platform, source_connection_id: c.id, period_start: w.start, period_end: w.end }, now)
  const errors = [{ code, status: null, message }]
  await finishSyncRun(db, h, { status: 'failed', rows_written: 0, attempt_count: 1, errors }, now)
  return { tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id, platform: c.platform, status: 'failed', sync_run_id: h.id, rows_written: 0, errors }
}

async function collectTenant(deps: AirbyteDeps, credentialId: string, list: Linked[], now: () => Date): Promise<AirbyteOutcome[]> {
  const { db } = deps
  const validation = (ok: boolean, error?: string) => db.rpc('record_source_validation', { p_connection_id: credentialId, p_ok: ok, ...(error ? { p_error: error } : {}) }).catch(() => undefined)
  const failAll = async (code: string, message: string) => Promise.all(list.map((c) => failedRun(db, c, now, code, message)))

  const parsed = parseCredential(await getSourceToken(db, credentialId))
  if (!parsed.ok) {
    await validation(false, parsed.reason)
    return failAll(`airbyte_${parsed.reason}`, parsed.message)
  }
  const dsn = parsed.dsn
  let addresses: string[]
  try {
    addresses = await deps.resolve(dsn.host)
  } catch {
    return failAll('airbyte_dns_failed', `Numele ${dsn.host} nu a putut fi rezolvat (DNS).`)
  }
  if (addresses.length === 0) {
    await validation(false, 'dns_failed')
    return failAll('airbyte_dns_failed', `Numele ${dsn.host} nu există în DNS.`)
  }
  const blocked = checkResolved(addresses)
  if (blocked) {
    await validation(false, blocked.reason)
    return failAll(`airbyte_${blocked.reason}`, blocked.message)
  }

  const window = lookbackWindow(now(), WINDOW_TZ, AIRBYTE_LOOKBACK_DAYS)
  const outcomes: AirbyteOutcome[] = []
  const pending = new Set(list)
  try {
    await deps.connect(
      { ip: addresses[0]!, servername: dsn.host, port: dsn.port, user: dsn.user, password: dsn.password, database: dsn.database, ca: dsn.ca },
      async (session) => {
        const tables = groupTables(await readColumns(session))
        for (const platform of Object.keys(SPECS) as Platform[]) {
          const conns = list.filter((c) => c.platform === platform)
          if (conns.length === 0) continue
          const report = pickReport(platform, tables)
          if (!report) {
            for (const c of conns) {
              pending.delete(c)
              outcomes.push(await failedRun(db, c, now, 'stream_not_found', `Niciun tabel ${SPECS[platform].streams.join(' / ')} citibil în destinația Airbyte (verifică fluxul și GRANT SELECT).`))
            }
            continue
          }
          // Doar cifre (EXTERNAL), deci lista separată prin virgulă e neambiguă.
          const accounts = [...new Set(conns.map((c) => c.account))].join(',')
          const catalog = pickCatalog(platform, tables)
          let rows: ReportRow[]
          let catalogRows: Array<{ account_id: string; currency: string | null; timezone: string | null }> = []
          try {
            rows = await session.query<ReportRow>(reportQuery(platform, report), [accounts, window.start, window.end])
            if (catalog) catalogRows = await session.query(catalogQuery(platform, catalog), [accounts])
          } catch (err) {
            if (err instanceof PgError && (err.kind === 'unreachable' || err.kind === 'auth')) throw err
            const kind = err instanceof PgError ? err.kind : 'other'
            for (const c of conns) {
              pending.delete(c)
              outcomes.push(await failedRun(db, c, now, `airbyte_${kind}`, `${report.schema}.${report.table}: ${PG_MESSAGE[kind]}`))
            }
            continue
          }
          for (const c of conns) {
            pending.delete(c)
            outcomes.push(await writeAccount(db, c, rows.filter((r) => r.account_id === c.account), catalogRows.find((r) => r.account_id === c.account) ?? null, `${report.schema}.${report.table}`, window, now))
          }
        }
      },
    )
    await validation(true)
  } catch (err) {
    const kind: PgErrorKind = err instanceof PgError ? err.kind : 'other'
    if (INVALIDATING.includes(kind)) await validation(false, kind)
    for (const c of pending) outcomes.push(await failedRun(db, c, now, `airbyte_${kind}`, PG_MESSAGE[kind]))
  }
  return outcomes
}

async function writeAccount(
  db: Db,
  c: Linked,
  rows: ReportRow[],
  catalog: { currency: string | null; timezone: string | null } | null,
  table: string,
  window: { start: string; end: string },
  now: () => Date,
): Promise<AirbyteOutcome> {
  const scope = { tenant_id: c.tenant_id, brand_id: c.brand_id }
  const handle: SyncRunHandle = await startSyncRun(db, { ...scope, source: c.platform, source_connection_id: c.id, period_start: window.start, period_end: window.end }, now)
  const errors: SyncRunError[] = []
  const notes: string[] = []
  const done = async (status: 'succeeded' | 'partial' | 'failed', written: number): Promise<AirbyteOutcome> => {
    for (const n of [...new Set(notes)].slice(0, 50)) errors.push({ code: 'parser_note', status: null, message: n })
    await finishSyncRun(db, handle, { status, rows_written: written, attempt_count: 1, errors }, now)
    return { ...scope, connection_id: c.id, platform: c.platform, status, sync_run_id: handle.id, rows_written: written, errors }
  }
  try {
    const currency = (rows.find((r) => r.currency)?.currency ?? catalog?.currency ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) {
      if (rows.length === 0) return await done('succeeded', 0)
      errors.push({ code: 'currency_missing', status: null, dimension: table, message: 'Moneda contului nu apare nici în raport, nici în catalogul Airbyte; rândurile nu se scriu.' })
      return await done('failed', 0)
    }
    const tzCandidate = rows.find((r) => r.timezone)?.timezone ?? catalog?.timezone ?? null
    const tz = tzCandidate && isValidTimeZone(tzCandidate) ? tzCandidate : WINDOW_TZ
    if (tz !== tzCandidate) notes.push(`fusul orar al contului necunoscut (${tzCandidate ?? 'lipsă'}); notat Europe/Bucharest`)
    const paid = toPaidRows(c.platform, rows.map((r) => ({ ...r, currency: r.currency?.trim().toUpperCase() ?? null })), {
      ...scope, source_id: c.id, sync_run_id: handle.id, collected_at: now().toISOString(), source_timezone: tz, currency, table,
    }, notes)
    const written = await upsertScoped(db, 'paid_daily', PAID_KEY, paid, scope)
    return await done(notes.some((n) => n.includes('nu se scrie')) && written > 0 ? 'partial' : 'succeeded', written)
  } catch (e) {
    errors.push({ code: 'exception', status: null, message: (e as Error).message })
    return await done('failed', 0)
  }
}
