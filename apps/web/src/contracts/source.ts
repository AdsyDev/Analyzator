import type { BrandId, IsoDate, IsoDateTime } from './common'

export const SOURCE_PROVIDERS = [
  'seomonitor',
  'ga4',
  'gsc',
  'clarity',
  'planable',
  'google_ads',
  'meta_ads',
  'csv_import',
] as const
export type SourceProviderId = (typeof SOURCE_PROVIDERS)[number]

/** Starea unei surse în pagina de status și în SourceStatus. */
export type SourceState = 'connected' | 'partial' | 'stale' | 'error' | 'not_connected'

export interface SourceStatusInfo {
  provider: SourceProviderId
  state: SourceState
  /** Ce aduce sursa, în română. */
  description: string
  data_as_of: IsoDate | null
  imported_at: IsoDateTime | null
  /** Motivul pentru `partial`, `stale`, `error` și `not_connected`. */
  note: string | null
}

/** Valorile din `source_connections.credential_status`. */
export type CredentialStatus = 'missing' | 'unverified' | 'valid' | 'invalid'

export interface SourceConnection {
  id: string
  brand_id: BrandId
  provider: SourceProviderId
  external_account_id: string
  display_name: string | null
  credential_status: CredentialStatus
  last_validated_at: IsoDateTime | null
  /** Doar codul (de ex. „HTTP 403"), niciodată conținut de la furnizor. */
  last_validation_error: string | null
  credential_updated_by: string | null
  credential_updated_at: IsoDateTime | null
  /** Apeluri consumate azi (ziua UTC). */
  calls_today: number
  /** Bugetul zilnic de apeluri; 10 la pilot. */
  daily_call_budget: number
}

export type SyncRunStatus = 'queued' | 'running' | 'partial' | 'succeeded' | 'failed'

export interface SyncRun {
  id: string
  brand_id: BrandId
  /** Cheia din `sync_runs.source`; poate fi o sursă încă fără etichetă în `PROVIDER_LABELS`. */
  provider: string
  range_from: IsoDate
  range_to: IsoDate
  started_at: IsoDateTime
  finished_at: IsoDateTime | null
  rows: number | null
  status: SyncRunStatus
  error: string | null
}

/** Conexiune nouă (agency_admin). Tokenul se setează separat, prin funcția server. */
export interface NewConnection {
  provider: SourceProviderId
  external_account_id: string
  display_name: string | null
}

/** Răspunsul funcției server după setarea tokenului: doar starea, niciodată tokenul. */
export interface TokenSaved {
  connection_id: string
  credential_status: CredentialStatus
}

export type ValidationOutcomeKind = 'valid' | 'invalid' | 'rate_limited' | 'provider_error' | 'budget_exhausted'

export interface ValidationOutcome {
  connection_id: string
  credential_status: CredentialStatus
  calls_today: number
  daily_limit: number
  outcome: ValidationOutcomeKind
  message: string
}
