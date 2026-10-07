// Orchestrarea colectării zilnice Clarity pentru un proiect (brand).
// Parserul și scrierea în clarity_daily sunt injectate: se implementează după probă,
// pe baza fixtures din tests/fixtures/clarity/.

import { createHash } from 'node:crypto'
import { CallBudget, fetchWithRetry, type FetchLike, type Sleep } from '../shared/http-budget.ts'
import { previousCalendarDayInBucharest } from '../shared/dates.ts'
import { finishSyncRun, startSyncRun, type SyncRunError, type SyncRunResult } from '../shared/sync-runs.ts'
import type { Db } from '../shared/supabase-rest.ts'
import {
  getSourceToken,
  providerCallsToday,
  recordProviderCalls,
  utcDay,
  type SourceConnection,
} from '../shared/connections.ts'
import { CLARITY_DAILY_BUDGET, CLARITY_ENDPOINT, CLARITY_MIN_BUDGET_TO_START } from './config.ts'

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

export type ParseContext = {
  tenant_id: string
  brand_id: string
  /** Ziua stocată: ziua anterioară rulării în Europe/Bucharest. */
  date: string
  call: ClarityCall
  /** Proveniență: conexiunea, run-ul, momentul răspunsului (sfârșitul ferestrei de 24 h), hash-ul corpului brut. */
  source_id: string
  sync_run_id: string
  collected_at: string
  payload_hash: string
  window_days: 1 | 2 | 3
}

/** Ce a întâlnit parserul fără să știe ce înseamnă (câmpuri sau blocuri necunoscute, valori invalide). */
export type ParseNote = { code: string; message: string; metric_name?: string; field?: string }

export type ParseResult<TRow> = { rows: TRow[]; notes: ParseNote[] }

/** Primește payload-ul brut (JSON parsat) și întoarce rândurile pentru clarity_daily. Aruncă la formă invalidă. */
export interface ClarityParser<TRow> {
  parse(payload: unknown, context: ParseContext): ParseResult<TRow>
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
  /** Bugetul zilnic al furnizorului (implicit 10); se scad apelurile deja făcute azi (UTC). */
  dailyLimit?: number
  /** Sub acest buget rămas, rularea nu pornește (implicit 4 = un apel per dimensiune). */
  minBudgetToStart?: number
}

export type CollectOutcome = SyncRunResult & {
  sync_run_id: string
  date: string
  calls_before_run: number
  collected: ClarityDimensionKey[]
  not_collected: ClarityDimensionKey[]
}

export async function collectConnection<TRow>(
  deps: CollectDeps<TRow>,
  connection: SourceConnection,
): Promise<CollectOutcome> {
  if (connection.provider !== 'clarity') throw new Error(`Conexiunea ${connection.id} nu e Clarity.`)
  const now = deps.now ?? (() => new Date())
  const date = previousCalendarDayInBucharest(now())
  const dayUtc = utcDay(now())
  const scope = { tenant_id: connection.tenant_id, brand_id: connection.brand_id }
  const handle = await startSyncRun(
    deps.db,
    { ...scope, source: 'clarity', source_connection_id: connection.id, period_start: date, period_end: date },
    now,
  )

  const dailyLimit = deps.dailyLimit ?? CLARITY_DAILY_BUDGET
  const minToStart = deps.minBudgetToStart ?? CLARITY_MIN_BUDGET_TO_START
  const callsBefore = await providerCallsToday(deps.db, connection.id, dayUtc)
  const remaining = Math.max(0, dailyLimit - callsBefore)

  // Sub pragul minim nu pornim: o rulare care pierde din start dimensiuni nu merită bugetul.
  if (remaining < minToStart) {
    const result: SyncRunResult = {
      status: 'failed',
      rows_written: 0,
      attempt_count: 0,
      errors: [{
        code: 'insufficient_budget',
        status: null,
        message: `Buget rămas azi (UTC ${dayUtc}): ${remaining}/${dailyLimit}, sub minimul de ${minToStart}. Nicio cerere trimisă.`,
      }],
    }
    await finishSyncRun(deps.db, handle, result, now)
    return {
      ...result,
      sync_run_id: handle.id,
      date,
      calls_before_run: callsBefore,
      collected: [],
      not_collected: CLARITY_CALLS.map((c) => c.key),
    }
  }

  let token: string
  try {
    token = await getSourceToken(deps.db, connection.id)
  } catch (err) {
    const result: SyncRunResult = {
      status: 'failed',
      rows_written: 0,
      attempt_count: 0,
      errors: [{ code: 'token_unavailable', status: null, message: (err as Error).message }],
    }
    await finishSyncRun(deps.db, handle, result, now)
    return { ...result, sync_run_id: handle.id, date, calls_before_run: callsBefore, collected: [], not_collected: CLARITY_CALLS.map((c) => c.key) }
  }
  const budget = new CallBudget(remaining)
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
        { headers: { Authorization: `Bearer ${token}` } },
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

      let parsed: ParseResult<TRow>
      try {
        parsed = deps.parser.parse(payload, {
          ...scope,
          date,
          call,
          source_id: connection.id,
          sync_run_id: handle.id,
          collected_at: now().toISOString(),
          payload_hash: createHash('sha256').update(result.body).digest('hex'),
          window_days: 1,
        })
      } catch (err) {
        notCollected.push(call.key)
        errors.push({ code: 'invalid_payload', dimension: call.key, status: result.status, message: (err as Error).message })
        continue
      }
      for (const note of parsed.notes) {
        // Câmpurile necunoscute se loghează (și ajung în sync_runs), fără să schimbe statusul run-ului.
        console.warn(`clarity ${connection.id} ${call.key}: ${note.code} ${note.message}`)
        errors.push({ code: `parser_${note.code}`, dimension: call.key, status: null, message: note.message })
      }
      const rows = parsed.rows
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

  try {
    await recordProviderCalls(deps.db, {
      ...scope,
      source_connection_id: connection.id,
      call_date_utc: dayUtc,
      purpose: 'collect',
      calls: budget.used,
      sync_run_id: handle.id,
    })
  } catch (err) {
    errors.push({ code: 'call_count_not_recorded', status: null, message: (err as Error).message })
  }
  const result: SyncRunResult = { status, rows_written: rowsWritten, attempt_count: budget.used, errors }
  await finishSyncRun(deps.db, handle, result, now)
  return { ...result, sync_run_id: handle.id, date, calls_before_run: callsBefore, collected, not_collected: notCollected }
}
