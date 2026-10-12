import { failed, ready, TENANT_PROVIDERS, type CredentialStatus, type ProviderResult, type SourceConnection, type SourcesProvider, type TenantConnection, type TenantProviderId, type TokenSaved, type ValidationOutcome, type ValidationOutcomeKind } from '../../contracts'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'
import { deriveStatuses, mapConnection, mapSyncRun, SourceContractError, type ConnectionRow, type ImportBatchRow, type SyncRunRow } from './mapSources'

const CONNECTION_COLUMNS =
  'id, brand_id, provider, external_account_id, display_name, credential_status, last_validated_at, last_validation_error, credential_updated_by, credential_updated_at'
const RUN_COLUMNS = 'id, brand_id, source, period_start, period_end, status, rows_written, errors, started_at, finished_at, created_at'
const RUN_LIMIT = 50
const FUNCTION = 'source-credentials'
const OUTCOMES: readonly ValidationOutcomeKind[] = ['valid', 'invalid', 'rate_limited', 'provider_error', 'budget_exhausted']
const CREDENTIALS = ['missing', 'unverified', 'valid', 'invalid']

const utcDay = (d: Date) => d.toISOString().slice(0, 10)
const TENANT_COLUMNS = 'id, tenant_id, provider, external_account_id, display_name, credential_status, credential_updated_at'

interface TenantConnectionRow {
  id: string
  tenant_id: string
  provider: string
  external_account_id: string
  display_name: string | null
  credential_status: string
  credential_updated_at: string | null
}

function mapTenantConnection(r: TenantConnectionRow): TenantConnection {
  if (!CREDENTIALS.includes(r.credential_status)) throw new SourceContractError(`credential_status necunoscut: ${r.credential_status}`)
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    provider: r.provider as TenantProviderId,
    external_account_id: r.external_account_id,
    display_name: r.display_name,
    credential_status: r.credential_status as CredentialStatus,
    credential_updated_at: r.credential_updated_at,
  }
}

/** Mesajul în română al funcției server (`{ error }`), dacă răspunsul HTTP îl conține; altfel un mesaj generic. */
async function functionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context
  if (ctx && typeof (ctx as { json?: unknown }).json === 'function') {
    try {
      const body = (await (ctx as { json: () => Promise<unknown> }).json()) as { error?: unknown }
      if (typeof body.error === 'string' && body.error.length <= 300) return body.error
    } catch {
      // corp ilizibil: mesajul generic
    }
  }
  return 'Funcția serverului nu a răspuns. Reîncearcă în câteva clipe.'
}

/**
 * Providerul real pentru surse: citește prin sesiunea utilizatorului (RLS decide ce vede) și apelează
 * funcția server pentru credențiale. Tokenul trece o singură dată, spre funcția server; nu se păstrează și
 * nu apare în rezultate, erori sau loguri.
 */
export function createSupabaseSources(client: DataClient, now: () => Date = () => new Date()): SourcesProvider {
  async function loadConnections(brandId: string): Promise<ConnectionRow[]> {
    const { data, error } = await client.from('source_connections').select(CONNECTION_COLUMNS).eq('brand_id', brandId).eq('status', 'active').order('created_at')
    if (error) throw new Error(QUERY_FAILED)
    return (data ?? []) as unknown as ConnectionRow[]
  }
  async function loadRuns(brandId: string): Promise<SyncRunRow[]> {
    const { data, error } = await client.from('sync_runs').select(RUN_COLUMNS).eq('brand_id', brandId).order('created_at', { ascending: false }).limit(RUN_LIMIT)
    if (error) throw new Error(QUERY_FAILED)
    return (data ?? []) as unknown as SyncRunRow[]
  }
  async function callsByConnection(brandId: string): Promise<Map<string, number>> {
    const { data, error } = await client.from('provider_api_calls').select('source_connection_id, calls').eq('brand_id', brandId).eq('call_date_utc', utcDay(now()))
    if (error) throw new Error(QUERY_FAILED)
    const out = new Map<string, number>()
    for (const r of (data ?? []) as unknown as Array<{ source_connection_id: string; calls: number }>) out.set(r.source_connection_id, (out.get(r.source_connection_id) ?? 0) + r.calls)
    return out
  }

  async function guarded<T>(work: () => Promise<T>): Promise<ProviderResult<T>> {
    try {
      return ready(await work())
    } catch (e) {
      if (e instanceof SourceContractError) return failed('Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.')
      return failed(e instanceof Error && e.message ? e.message : QUERY_FAILED)
    }
  }

  return {
    statuses: (brandId) =>
      guarded(async () => {
        const [connections, runs, batches] = await Promise.all([
          loadConnections(brandId),
          loadRuns(brandId),
          client
            .from('import_batches')
            .select('status, updated_at')
            .eq('brand_id', brandId)
            .eq('status', 'imported')
            .then(({ data, error }) => {
              if (error) throw new Error(QUERY_FAILED)
              return (data ?? []) as unknown as ImportBatchRow[]
            }),
        ])
        return deriveStatuses(connections, runs, batches)
      }),

    connections: (brandId) =>
      guarded(async () => {
        const [rows, calls] = await Promise.all([loadConnections(brandId), callsByConnection(brandId)])
        return rows.map((r) => mapConnection(r, calls.get(r.id) ?? 0))
      }),

    syncRuns: (brandId) => guarded(async () => (await loadRuns(brandId)).map(mapSyncRun)),

    createConnection: (brandId, input) =>
      guarded(async () => {
        // `tenant_id` vine din brand (RLS verifică apartenența); nu îl cerem utilizatorului.
        const brand = await client.from('brands').select('tenant_id').eq('id', brandId).maybeSingle()
        const tenantId = (brand.data as { tenant_id?: string } | null)?.tenant_id
        if (brand.error || !tenantId) throw new Error('Spațiul de brand nu a fost găsit sau nu ai acces la el.')
        const { data, error } = await client
          .from('source_connections')
          .insert({ tenant_id: tenantId, brand_id: brandId, provider: input.provider, external_account_id: input.external_account_id, display_name: input.display_name })
          .select(CONNECTION_COLUMNS)
          .single()
        if (error) {
          // 23505 = conexiune existentă pentru același cont; 42501 = fără drept de scriere.
          if (error.code === '23505') throw new Error('Există deja o conexiune pentru acest cont.')
          if (error.code === '42501') throw new Error('Doar administratorii agenției pot adăuga conexiuni.')
          throw new Error('Conexiunea nu a putut fi creată. Verifică datele și reîncearcă.')
        }
        return mapConnection(data as unknown as ConnectionRow, 0) satisfies SourceConnection
      }),

    setToken: (connectionId, token) =>
      guarded(async (): Promise<TokenSaved> => {
        const { data, error } = await client.functions.invoke(FUNCTION, { body: { action: 'set_token', connection_id: connectionId, token } })
        if (error) throw new Error(await functionError(error))
        const d = data as { connection_id?: unknown; credential_status?: unknown } | null
        if (!d || typeof d.connection_id !== 'string' || typeof d.credential_status !== 'string' || !CREDENTIALS.includes(d.credential_status)) {
          throw new SourceContractError('Răspuns set_token invalid')
        }
        return { connection_id: d.connection_id, credential_status: d.credential_status as TokenSaved['credential_status'] }
      }),

    validate: (connectionId) =>
      guarded(async (): Promise<ValidationOutcome> => {
        const { data, error } = await client.functions.invoke(FUNCTION, { body: { action: 'validate', connection_id: connectionId } })
        if (error) throw new Error(await functionError(error))
        const d = data as Record<string, unknown> | null
        if (
          !d ||
          typeof d.connection_id !== 'string' ||
          typeof d.credential_status !== 'string' ||
          !CREDENTIALS.includes(d.credential_status) ||
          typeof d.calls_today !== 'number' ||
          typeof d.daily_limit !== 'number' ||
          typeof d.outcome !== 'string' ||
          !OUTCOMES.includes(d.outcome as ValidationOutcomeKind) ||
          typeof d.message !== 'string'
        ) {
          throw new SourceContractError('Răspuns validate invalid')
        }
        return {
          connection_id: d.connection_id,
          credential_status: d.credential_status as ValidationOutcome['credential_status'],
          calls_today: d.calls_today,
          daily_limit: d.daily_limit,
          outcome: d.outcome as ValidationOutcomeKind,
          message: d.message,
        }
      }),

    tenantConnections: (tenantId) =>
      guarded(async () => {
        const { data, error } = await client.from('source_connections').select(TENANT_COLUMNS).eq('tenant_id', tenantId).is('brand_id', null).eq('status', 'active').order('created_at')
        if (error) throw new Error(QUERY_FAILED)
        return ((data ?? []) as unknown as TenantConnectionRow[])
          .filter((r) => (TENANT_PROVIDERS as readonly string[]).includes(r.provider))
          .map(mapTenantConnection)
      }),

    createTenantConnection: (tenantId, input) =>
      guarded(async () => {
        if (!(TENANT_PROVIDERS as readonly string[]).includes(input.provider)) throw new Error('Sursă necunoscută.')
        const { data, error } = await client
          .from('source_connections')
          .insert({ tenant_id: tenantId, brand_id: null, provider: input.provider, external_account_id: input.external_account_id, display_name: input.display_name })
          .select(TENANT_COLUMNS)
          .single()
        if (error) {
          if (error.code === '23505') throw new Error('Există deja o conexiune pentru acest cont.')
          if (error.code === '42501') throw new Error('Doar administratorii agenției pot adăuga conexiuni.')
          throw new Error('Conexiunea nu a putut fi creată. Verifică datele și reîncearcă.')
        }
        return mapTenantConnection(data as unknown as TenantConnectionRow)
      }),

    startOAuth: (tenantId, provider, accountLabel) =>
      guarded(async () => {
        const { data, error } = await client.functions.invoke('oauth', { body: { action: 'start', provider, tenant_id: tenantId, account_label: accountLabel } })
        if (error) throw new Error(await functionError(error))
        const url = (data as { authorize_url?: unknown } | null)?.authorize_url
        if (typeof url !== 'string' || !/^https:\/\/(accounts\.google\.com|business-api\.tiktok\.com)\//.test(url)) throw new SourceContractError('Răspuns oauth invalid')
        return { authorize_url: url }
      }),
  }
}
