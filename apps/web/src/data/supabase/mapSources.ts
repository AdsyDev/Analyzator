import type { CredentialStatus, IsoDate, IsoDateTime, SourceConnection, SourceProviderId, SourceState, SourceStatusInfo, SyncRun, SyncRunStatus } from '../../contracts'
import { SOURCE_PROVIDERS } from '../../contracts'
import { PROVIDER_DESCRIPTIONS } from '../../lib/sources'

/** Bugetul zilnic de apeluri la pilot (spec: 10 per token). */
export const DAILY_CALL_BUDGET = 10

export interface ConnectionRow {
  id: string
  brand_id: string
  provider: string
  external_account_id: string
  display_name: string | null
  credential_status: string
  last_validated_at: string | null
  last_validation_error: string | null
  credential_updated_by: string | null
  credential_updated_at: string | null
}

export interface SyncRunRow {
  id: string
  brand_id: string
  source: string
  period_start: string
  period_end: string
  status: string
  rows_written: number
  errors: unknown
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface ImportBatchRow {
  status: string
  updated_at: string
}

const CREDENTIAL: readonly string[] = ['missing', 'unverified', 'valid', 'invalid']
const SYNC: readonly string[] = ['queued', 'running', 'partial', 'succeeded', 'failed']
const isProvider = (v: string): v is SourceProviderId => (SOURCE_PROVIDERS as readonly string[]).includes(v)

export class SourceContractError extends Error {}

/** Parser strict, ca la metrici: o valoare în afara contractului oprește ecranul, nu se ghicește. */
export function mapConnection(r: ConnectionRow, callsToday: number): SourceConnection {
  if (!isProvider(r.provider)) throw new SourceContractError(`Sursă necunoscută în conexiune: ${r.provider}`)
  if (!CREDENTIAL.includes(r.credential_status)) throw new SourceContractError(`credential_status necunoscut: ${r.credential_status}`)
  return {
    id: r.id,
    brand_id: r.brand_id,
    provider: r.provider,
    external_account_id: r.external_account_id,
    display_name: r.display_name,
    credential_status: r.credential_status as CredentialStatus,
    last_validated_at: r.last_validated_at,
    last_validation_error: r.last_validation_error,
    credential_updated_by: r.credential_updated_by,
    credential_updated_at: r.credential_updated_at,
    calls_today: callsToday,
    daily_call_budget: DAILY_CALL_BUDGET,
  }
}

/** Primul mesaj text din `errors` (jsonb), dacă există; structura exactă a elementelor nu e fixată de schemă. */
function firstError(errors: unknown): string | null {
  if (!Array.isArray(errors) || errors.length === 0) return null
  const e = errors[0] as unknown
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['code', 'message']) if (typeof o[k] === 'string') return o[k] as string
  }
  return 'Eroare la sincronizare'
}

export function mapSyncRun(r: SyncRunRow): SyncRun {
  if (!SYNC.includes(r.status)) throw new SourceContractError(`Status de sincronizare necunoscut: ${r.status}`)
  // `started_at` lipsește cât timp jobul e în coadă: folosim momentul creării, fără să-l prezentăm ca pornire reală.
  return {
    id: r.id,
    brand_id: r.brand_id,
    provider: r.source,
    range_from: r.period_start,
    range_to: r.period_end,
    started_at: r.started_at ?? r.created_at,
    finished_at: r.finished_at,
    rows: r.status === 'queued' ? null : r.rows_written,
    status: r.status as SyncRunStatus,
    error: firstError(r.errors),
  }
}

const NO_CONNECTION = 'Nicio conexiune configurată pentru acest spațiu.'

/**
 * Starea unei surse din conexiuni, sincronizări și importuri. Regulile sunt clasificări, nu metrici:
 * `stale` nu se derivă (nu există o politică de prospețime aprobată), iar fără sincronizare reușită sursa
 * rămâne „Neconectată", nu „Conectată" pe baza faptului că tokenul există.
 */
export function deriveStatuses(connections: ConnectionRow[], runs: SyncRunRow[], batches: ImportBatchRow[]): SourceStatusInfo[] {
  return (['seomonitor', 'ga4', 'gsc', 'clarity', 'planable', 'csv_import'] as const).map((provider) => {
    const base = { provider, description: PROVIDER_DESCRIPTIONS[provider] }
    if (provider === 'csv_import') {
      const last = batches.filter((b) => b.status === 'imported').sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
      return last
        ? { ...base, state: 'connected' as SourceState, data_as_of: null, imported_at: last.updated_at, note: null }
        : { ...base, state: 'not_connected' as SourceState, data_as_of: null, imported_at: null, note: 'Niciun import încheiat pentru acest spațiu.' }
    }
    const conns = connections.filter((c) => c.provider === provider)
    if (conns.length === 0) return { ...base, state: 'not_connected' as SourceState, data_as_of: null, imported_at: null, note: NO_CONNECTION }
    if (conns.some((c) => c.credential_status === 'invalid')) {
      return { ...base, state: 'error' as SourceState, data_as_of: null, imported_at: null, note: 'Tokenul a fost refuzat de furnizor. Setează un token nou.' }
    }
    const own = runs.filter((r) => r.source === provider).sort((a, b) => b.created_at.localeCompare(a.created_at))
    const latest = own[0]
    const lastWithData = own.find((r) => r.status === 'succeeded' || r.status === 'partial')
    const data_as_of: IsoDate | null = lastWithData?.period_end ?? null
    const imported_at: IsoDateTime | null = lastWithData?.finished_at ?? null
    if (!latest || !lastWithData) {
      const tokenNote = conns.every((c) => c.credential_status === 'missing') ? 'Token neconfigurat.' : 'Fără nicio sincronizare încheiată cu date.'
      if (latest?.status === 'failed') return { ...base, state: 'error' as SourceState, data_as_of, imported_at, note: 'Ultima sincronizare a eșuat.' }
      return { ...base, state: 'not_connected' as SourceState, data_as_of, imported_at, note: tokenNote }
    }
    if (latest.status === 'failed') return { ...base, state: 'error' as SourceState, data_as_of, imported_at, note: 'Ultima sincronizare a eșuat. Afișăm ultimele date importate.' }
    if (latest.status === 'partial') return { ...base, state: 'partial' as SourceState, data_as_of, imported_at, note: 'Ultima sincronizare a adus date parțiale.' }
    return { ...base, state: 'connected' as SourceState, data_as_of, imported_at, note: null }
  })
}
