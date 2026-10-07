// Orchestrarea colectării zilnice Clarity pentru un proiect (brand).
// Parserul și scrierea în clarity_daily sunt injectate: se implementează după probă,
// pe baza fixtures din tests/fixtures/clarity/.

import { CallBudget, fetchWithRetry, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { previousCalendarDayInBucharest } from '../shared/dates.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunResult } from '../shared/sync-runs.ts'
import type { Db } from '../shared/supabase-rest.ts'
import type { ResolvedBrand } from '../shared/resolve.ts'
import { CLARITY_DAILY_BUDGET, CLARITY_ENDPOINT, type ClarityProject } from './config.ts'

export type ClarityDimensionKey = 'all' | 'device' | 'source' | 'page'

export type ClarityCall = {
  key: ClarityDimensionKey
  /** Numele exact din documentația Clarity (2025-12-05); null = fără dimensiune. */
  clarityDimension: string | null
}

/** Ordinea = prioritatea. La buget epuizat se pierd ultimele (pagini), nu totalurile. */
export const CLARITY_CALLS: readonly ClarityCall[] = [
  { key: 'all', clarityDimension: null },
  { key: 'device', clarityDimension: 'Device' },
  { key: 'source', clarityDimension: 'Source' },
  { key: 'page', clarityDimension: 'URL' },
]

export function clarityUrl(call: ClarityCall): string {
  const params = new URLSearchParams({ numOfDays: '1' })
  if (call.clarityDimension) params.set('dimension1', call.clarityDimension)
  return `${CLARITY_ENDPOINT}?${params.toString()}`
}

export type ParseContext = { tenant_id: string; brand_id: string; date: string; call: ClarityCall }

/** Primește payload-ul brut (JSON parsat) și întoarce rândurile pentru clarity_daily. */
export interface ClarityParser<TRow> {
  parse(payload: unknown, context: ParseContext): TRow[]
}

/** Upsert idempotent pe (tenant_id, brand_id, date, dimension, dimension_value); întoarce rândurile scrise. */
export interface ClarityWriter<TRow> {
  upsert(scope: { tenant_id: string; brand_id: string }, rows: TRow[]): Promise<number>
}

export type CollectDeps<TRow> = {
  db: Db
  parser: ClarityParser<TRow>
  writer: ClarityWriter<TRow>
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => Date
  budgetLimit?: number
}

export type CollectOutcome = SyncRunResult & {
  sync_run_id: string
  date: string
  collected: ClarityDimensionKey[]
  not_collected: ClarityDimensionKey[]
}

export async function collectProject<TRow>(
  deps: CollectDeps<TRow>,
  project: ClarityProject & ResolvedBrand,
): Promise<CollectOutcome> {
  const now = deps.now ?? (() => new Date())
  const date = previousCalendarDayInBucharest(now())
  const scope = { tenant_id: project.tenant_id, brand_id: project.brand_id }
  const handle = await startSyncRun(
    deps.db,
    { ...scope, source: 'clarity', period_start: date, period_end: date },
    now,
  )

  const budget = new CallBudget(deps.budgetLimit ?? CLARITY_DAILY_BUDGET)
  const errors: SyncRunError[] = []
  const collected: ClarityDimensionKey[] = []
  const notCollected: ClarityDimensionKey[] = []
  let rowsWritten = 0
  let emptyPayloads = 0
  let fatal = false

  try {
    for (const [index, call] of CLARITY_CALLS.entries()) {
      const result = await fetchWithRetry(
        clarityUrl(call),
        { headers: { Authorization: `Bearer ${project.token}` } },
        { budget, fetch: deps.fetch, sleep: deps.sleep },
      )

      if (!result.ok) {
        notCollected.push(call.key)
        errors.push({ code: result.kind, dimension: call.key, status: result.status, message: result.message })
        // Buget epuizat sau acces refuzat: celelalte apeluri nu au cum să reușească.
        if (result.kind === 'budget_exhausted' || result.kind === 'access_denied') {
          for (const skipped of CLARITY_CALLS.slice(index + 1)) {
            notCollected.push(skipped.key)
            errors.push({
              code: result.kind === 'budget_exhausted' ? 'budget_exhausted' : 'skipped_after_access_denied',
              dimension: skipped.key,
              status: null,
              message:
                result.kind === 'budget_exhausted'
                  ? 'Necolectat: bugetul zilnic de apeluri s-a epuizat.'
                  : 'Necolectat: acces refuzat la un apel anterior cu același token.',
            })
          }
          break
        }
        continue
      }

      let payload: unknown
      try {
        payload = JSON.parse(result.body)
      } catch {
        notCollected.push(call.key)
        errors.push({ code: 'invalid_json', dimension: call.key, status: result.status, message: 'Răspuns non-JSON.' })
        continue
      }

      const rows = deps.parser.parse(payload, { ...scope, date, call })
      if (rows.length === 0) {
        emptyPayloads++
        errors.push({ code: 'empty_payload', dimension: call.key, status: result.status, message: 'Payload fără rânduri.' })
      } else {
        rowsWritten += await deps.writer.upsert(scope, rows)
      }
      collected.push(call.key)
    }
  } catch (err) {
    fatal = true
    errors.push({ code: 'exception', message: (err as Error).message, status: null })
  }

  // Orice apel neatins (de ex. după o excepție) e listat explicit ca necolectat.
  for (const call of CLARITY_CALLS) {
    if (!collected.includes(call.key) && !notCollected.includes(call.key)) {
      notCollected.push(call.key)
      errors.push({ code: 'not_attempted', dimension: call.key, status: null, message: 'Necolectat: rularea s-a oprit înainte.' })
    }
  }

  const status: SyncRunResult['status'] =
    fatal || collected.length === 0
      ? 'failed'
      : notCollected.length === 0 && emptyPayloads === 0
        ? 'succeeded'
        : 'partial'

  const result: SyncRunResult = { status, rows_written: rowsWritten, attempt_count: budget.used, errors }
  await finishSyncRun(deps.db, handle, result, now)
  return { ...result, sync_run_id: handle.id, date, collected, not_collected: notCollected }
}
