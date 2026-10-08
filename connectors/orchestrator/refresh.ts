// Orchestratorul refreshului săptămânal. Rulează conectorii activi, în ordine, per sursă (și per brand, în interiorul
// conectorilor), cu sync_runs. Eșecul unei surse nu le oprește pe celelalte; un eșec rămâne în sync_runs și intră în coada de alerte.
//
// Ordinea (prioritate, și de rulare): seomonitor → ga4 → gsc. Clarity are colectare zilnică proprie (clarity-daily.yml,
// buget de 10 apeluri/zi) și nu intră în refresh-ul săptămânal. Flag-urile CONNECTOR_*_ENABLED se citesc doar prin
// connectors/shared/flags.ts. Statusul surselor, `data_as_of` și acoperirea se calculează în SQL (view-urile source_status
// și source_freshness); orchestratorul nu le duplică.

import { connectorEnabled } from '../shared/flags.ts'
import { lookbackWindow } from '../google/dates.ts'
import { finishSyncRun, startSyncRun, type SyncRunError } from '../shared/sync-runs.ts'
import type { Db } from '../shared/supabase-rest.ts'
import { assertUuid } from '../shared/supabase-rest.ts'
import { enqueueFailure } from './ops-notifications.ts'

export type RefreshSource = 'seomonitor' | 'ga4' | 'gsc'
export const REFRESH_ORDER: readonly RefreshSource[] = ['seomonitor', 'ga4', 'gsc']
export const REFRESH_LOOKBACK_DAYS = 35

export type RunnerOutcome = {
  tenant_id: string
  brand_id: string | null
  connection_id: string | null
  sync_run_id: string | null
  status: 'succeeded' | 'partial' | 'failed' | 'not_connected'
  errors: SyncRunError[]
  reason?: string
}
export type Runner = () => Promise<RunnerOutcome[]>
export type Runners = Record<RefreshSource, Runner>

type Counts = { succeeded: number; partial: number; failed: number; not_connected: number }
export type SourceReport = {
  source: RefreshSource
  state: 'disabled' | 'ran' | 'exception'
  outcomes: RunnerOutcome[]
  counts: Counts
  exception?: string
  started_at: string | null
  finished_at: string | null
}

export type RefreshReport = {
  started_at: string
  finished_at: string
  sources: SourceReport[]
  failed_runs: number
  partial_runs: number
  exceptions: number
  notifications_enqueued: number
  /** Adevărat doar dacă nicio sursă n-a eșuat și nicio rulare n-a fost parțială. */
  clean: boolean
}

export type RefreshDeps = {
  db: Db
  env: Record<string, string | undefined>
  runners: Runners
  now?: () => Date
  /** Doar aceste surse (în ordinea standard). */
  only?: readonly RefreshSource[]
  appBaseUrl?: string
}

const emptyCounts = (): Counts => ({ succeeded: 0, partial: 0, failed: 0, not_connected: 0 })

/**
 * O excepție a unui conector (înainte să-și fi scris sync_runs) se înregistrează pentru fiecare brand afectat: conexiunile
 * active ale sursei; o conexiune la nivel de client (SEOmonitor) afectează toate brandurile active ale clientului.
 */
export async function recordSourceFailure(
  db: Db,
  source: RefreshSource,
  message: string,
  now: () => Date,
  scope?: { tenant_id: string },
): Promise<RunnerOutcome[]> {
  const filter = `provider=eq.${source}&status=eq.active${scope ? `&tenant_id=eq.${scope.tenant_id}` : ''}`
  const connections = await db.select<{ id: string; tenant_id: string; brand_id: string | null }>('source_connections', `select=id,tenant_id,brand_id&${filter}`)
  const targets = new Map<string, { tenant_id: string; brand_id: string; connection_id: string }>()
  for (const c of connections) {
    assertUuid(c.tenant_id, 'tenant_id')
    if (c.brand_id) {
      targets.set(`${c.tenant_id}/${c.brand_id}`, { tenant_id: c.tenant_id, brand_id: c.brand_id, connection_id: c.id })
    } else {
      const brands = await db.select<{ id: string }>('brands', `select=id&tenant_id=eq.${c.tenant_id}&status=eq.active`)
      for (const b of brands) targets.set(`${c.tenant_id}/${b.id}`, { tenant_id: c.tenant_id, brand_id: b.id, connection_id: c.id })
    }
  }
  const window = lookbackWindow(now(), 'Europe/Bucharest', REFRESH_LOOKBACK_DAYS)
  const errors: SyncRunError[] = [{ code: 'orchestrator_exception', status: null, message: message.slice(0, 500) }]
  const outcomes: RunnerOutcome[] = []
  for (const t of targets.values()) {
    const handle = await startSyncRun(db, {
      tenant_id: t.tenant_id, brand_id: t.brand_id, source, source_connection_id: t.connection_id,
      period_start: window.start, period_end: window.end,
    }, now)
    await finishSyncRun(db, handle, { status: 'failed', rows_written: 0, attempt_count: 0, errors }, now)
    outcomes.push({ tenant_id: t.tenant_id, brand_id: t.brand_id, connection_id: t.connection_id, sync_run_id: handle.id, status: 'failed', errors })
  }
  return outcomes
}

export async function runRefresh(deps: RefreshDeps): Promise<RefreshReport> {
  const { db, env } = deps
  const now = deps.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const wanted = deps.only ? REFRESH_ORDER.filter((s) => deps.only!.includes(s)) : REFRESH_ORDER
  const reports: SourceReport[] = []
  let enqueued = 0

  for (const source of REFRESH_ORDER) {
    if (!wanted.includes(source) || !connectorEnabled(env, source)) {
      reports.push({ source, state: 'disabled', outcomes: [], counts: emptyCounts(), started_at: null, finished_at: null })
      continue
    }
    const sourceStart = now().toISOString()
    let outcomes: RunnerOutcome[]
    let state: SourceReport['state'] = 'ran'
    let exception: string | undefined
    try {
      outcomes = await deps.runners[source]()
    } catch (err) {
      // Izolare: excepția unei surse nu oprește celelalte surse.
      state = 'exception'
      exception = (err as Error).message
      try {
        outcomes = await recordSourceFailure(db, source, exception, now)
      } catch (recordErr) {
        outcomes = []
        exception = `${exception}; înregistrarea eșecului a eșuat: ${(recordErr as Error).message}`
      }
    }

    const counts = emptyCounts()
    for (const o of outcomes) counts[o.status]++

    // Alertă pentru fiecare rulare eșuată (idempotent pe sync_run_id).
    const failed = outcomes.filter((o) => o.status === 'failed' && o.sync_run_id)
    if (failed.length) {
      const ids = [...new Set(failed.map((o) => o.brand_id).filter((b): b is string => !!b))]
      for (const id of ids) assertUuid(id, 'brand_id')
      const names = new Map<string, string>()
      if (ids.length) {
        for (const b of await db.select<{ id: string; name: string }>('brands', `select=id,name&id=in.(${ids.join(',')})`)) names.set(b.id, b.name)
      }
      for (const o of failed) {
        try {
          await enqueueFailure(db, {
            tenant_id: o.tenant_id, brand_id: o.brand_id, sync_run_id: o.sync_run_id!, source,
            brand_name: o.brand_id ? (names.get(o.brand_id) ?? null) : null, errors: o.errors,
          }, deps.appBaseUrl)
          enqueued++
        } catch (err) {
          exception = `${exception ? `${exception}; ` : ''}alerta nu a putut fi pusă în coadă: ${(err as Error).message}`
        }
      }
    }
    reports.push({ source, state, outcomes, counts, exception, started_at: sourceStart, finished_at: now().toISOString() })
  }

  const failedRuns = reports.reduce((n, r) => n + r.counts.failed, 0)
  const partialRuns = reports.reduce((n, r) => n + r.counts.partial, 0)
  const exceptions = reports.filter((r) => r.state === 'exception').length
  return {
    started_at: startedAt, finished_at: now().toISOString(), sources: reports,
    failed_runs: failedRuns, partial_runs: partialRuns, exceptions, notifications_enqueued: enqueued,
    clean: failedRuns === 0 && partialRuns === 0 && exceptions === 0,
  }
}
