// Conexiunile active din source_connections, tokenul din Vault și contorul de apeluri per zi UTC.
// Doar worker (service role). Tokenul nu se loghează.

import { assertUuid, type Db } from './supabase-rest.ts'

export type SourceConnection = {
  id: string
  tenant_id: string
  brand_id: string
  provider: string
  external_account_id: string
  credential_status: 'unverified' | 'valid' | 'invalid'
}

type ConnectionRow = {
  id: string
  tenant_id: string
  brand_id: string | null
  provider: string
  external_account_id: string
  status: string
  credential_status: string
}

export type SkippedConnection = { id: string; reason: string }

/** Conexiune la nivel de client (un cont de furnizor pentru mai multe branduri), de ex. SEOmonitor. */
export type TenantConnection = Omit<SourceConnection, 'brand_id'> & { brand_id: string | null }

/**
 * Conexiunile de colectat pentru un furnizor: active, cu brand și cu token.
 * Cele fără token sau cu token invalid sunt întoarse separat, ca să fie raportate.
 */
export async function loadActiveConnections(
  db: Db,
  provider: string,
  options?: { requireBrand?: true },
): Promise<{ connections: SourceConnection[]; skipped: SkippedConnection[] }>
export async function loadActiveConnections(
  db: Db,
  provider: string,
  options: { requireBrand: false },
): Promise<{ connections: TenantConnection[]; skipped: SkippedConnection[] }>
export async function loadActiveConnections(
  db: Db,
  provider: string,
  options: { requireBrand?: boolean } = { requireBrand: true },
): Promise<{ connections: TenantConnection[]; skipped: SkippedConnection[] }> {
  const requireBrand = options.requireBrand !== false
  if (!/^[a-z0-9_]+$/.test(provider)) throw new Error(`provider invalid: ${provider}`)
  const rows = await db.select<ConnectionRow>(
    'source_connections',
    `select=id,tenant_id,brand_id,provider,external_account_id,status,credential_status&provider=eq.${provider}&status=eq.active`,
  )
  const connections: TenantConnection[] = []
  const skipped: SkippedConnection[] = []
  for (const row of rows) {
    if (row.provider !== provider || row.status !== 'active') {
      throw new Error(`Conexiunea ${row.id} nu corespunde filtrului; opresc rularea.`)
    }
    if (!row.brand_id && requireBrand) {
      skipped.push({ id: row.id, reason: 'fără brand (colectarea e per brand)' })
    } else if (row.credential_status === 'missing') {
      skipped.push({ id: row.id, reason: 'fără token configurat' })
    } else if (row.credential_status === 'invalid') {
      skipped.push({ id: row.id, reason: 'token marcat invalid la ultima validare' })
    } else if (row.credential_status === 'unverified' || row.credential_status === 'valid') {
      connections.push({ ...row, brand_id: row.brand_id, credential_status: row.credential_status })
    } else {
      skipped.push({ id: row.id, reason: `stare necunoscută: ${row.credential_status}` })
    }
  }
  return { connections, skipped }
}

export async function getSourceToken(db: Db, connectionId: string): Promise<string> {
  assertUuid(connectionId, 'connection_id')
  const token = await db.rpc<unknown>('get_source_token', { p_connection_id: connectionId })
  if (typeof token !== 'string' || token === '') throw new Error(`Token indisponibil pentru conexiunea ${connectionId}.`)
  return token
}

/** Ziua de buget: UTC. Resetarea limitei Clarity e presupusă la 00:00 UTC (nedocumentată). */
export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

export async function providerCallsToday(db: Db, connectionId: string, dayUtc: string): Promise<number> {
  assertUuid(connectionId, 'connection_id')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayUtc)) throw new Error(`zi invalidă: ${dayUtc}`)
  const rows = await db.select<{ calls: number }>(
    'provider_api_calls',
    `select=calls&source_connection_id=eq.${connectionId}&call_date_utc=eq.${dayUtc}`,
  )
  return rows.reduce((sum, r) => sum + r.calls, 0)
}

export async function recordProviderCalls(
  db: Db,
  entry: {
    tenant_id: string
    /** null pentru conexiunile la nivel de client (de ex. SEOmonitor). */
    brand_id: string | null
    source_connection_id: string
    call_date_utc: string
    purpose: 'collect' | 'validate'
    calls: number
    sync_run_id?: string | null
  },
): Promise<void> {
  if (entry.calls <= 0) return
  const rows = await db.insert<{ tenant_id: string; source_connection_id: string }>('provider_api_calls', {
    ...entry,
    sync_run_id: entry.sync_run_id ?? null,
  })
  const row = rows[0]
  if (!row || row.tenant_id !== entry.tenant_id || row.source_connection_id !== entry.source_connection_id) {
    throw new Error('provider_api_calls: rândul întors nu corespunde conexiunii.')
  }
}
