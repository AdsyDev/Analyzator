// Adaptoarele dintre orchestrator și conectorii existenți (SEOmonitor, GA4, Search Console). Nu schimbă conectorii.
import { collectSeomonitorConnection } from '../seomonitor/collect-core.ts'
import { collectGoogle, type GoogleDeps } from '../google/collect-core.ts'
import { loadActiveConnections } from '../shared/connections.ts'
import type { FetchLike } from '../shared/http-budget.ts'
import { assertUuid, type Db } from '../shared/supabase-rest.ts'
import { recordSourceFailure, type RunnerOutcome, type Runners } from './refresh.ts'

export type RunnerDeps = {
  db: Db
  fetch?: FetchLike
  now?: () => Date
  /** Pentru teste: clienți Google simulați etc. */
  google?: Partial<GoogleDeps>
  seomonitor?: { sleep?: (ms: number) => Promise<void>; random?: () => number }
}

export function defaultRunners(deps: RunnerDeps): Runners {
  const { db } = deps
  const now = deps.now ?? (() => new Date())

  const google = (only: 'ga4' | 'gsc') => async (): Promise<RunnerOutcome[]> => {
    const outcomes = await collectGoogle({ db, now, ...deps.google }, only)
    // collectGoogle nu întoarce tenant_id: se ia din conexiunea fiecărui rezultat.
    const ids = [...new Set(outcomes.map((o) => o.connection_id))]
    for (const id of ids) assertUuid(id, 'connection_id')
    const tenantOf = new Map<string, string>()
    if (ids.length) {
      for (const c of await db.select<{ id: string; tenant_id: string }>('source_connections', `select=id,tenant_id&id=in.(${ids.join(',')})`)) tenantOf.set(c.id, c.tenant_id)
    }
    return outcomes.map((o): RunnerOutcome => {
      const tenant_id = tenantOf.get(o.connection_id)
      if (!tenant_id) throw new Error(`Conexiunea ${o.connection_id} nu mai există; opresc sursa ${only}.`)
      return o.status === 'not_connected'
        ? { tenant_id, brand_id: o.brand_id, connection_id: o.connection_id, sync_run_id: null, status: 'not_connected', errors: [], reason: o.reason }
        : { tenant_id, brand_id: o.brand_id, connection_id: o.connection_id, sync_run_id: o.sync_run_id, status: o.status, errors: o.errors }
    })
  }

  return {
    async seomonitor() {
      const { connections } = await loadActiveConnections(db, 'seomonitor', { requireBrand: false })
      const out: RunnerOutcome[] = []
      for (const connection of connections) {
        try {
          const o = await collectSeomonitorConnection({ db, fetch: deps.fetch, now, ...deps.seomonitor }, connection)
          if (o.runs.length === 0) {
            out.push({ tenant_id: connection.tenant_id, brand_id: null, connection_id: connection.id, sync_run_id: null, status: 'not_connected', errors: [], reason: 'nicio mapare grup → brand' })
          }
          for (const r of o.runs) {
            out.push({ tenant_id: connection.tenant_id, brand_id: r.brand_id, connection_id: connection.id, sync_run_id: r.sync_run_id, status: r.status === 'succeeded' || r.status === 'partial' ? r.status : 'failed', errors: r.errors })
          }
        } catch (err) {
          // Izolare per conexiune: o conexiune care aruncă nu o oprește pe următoarea.
          out.push(...(await recordSourceFailure(db, 'seomonitor', (err as Error).message, now, { tenant_id: connection.tenant_id })))
        }
      }
      return out
    },
    ga4: google('ga4'),
    gsc: google('gsc'),
  }
}
