// Client HTTP cu buget de apeluri și retry.
// - Fiecare încercare (inclusiv retry) consumă o unitate din buget; la buget epuizat nu se mai apelează nimic.
// - 429 și 5xx (și erorile de rețea) se reîncearcă cu backoff exponențial, respectând Retry-After.
// - 400, 401, 403 și alte coduri nu se reîncearcă.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
export type Sleep = (ms: number) => Promise<void>

export class CallBudget {
  readonly limit: number
  #used = 0

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 0) throw new Error(`Buget invalid: ${limit}`)
    this.limit = limit
  }

  get used(): number {
    return this.#used
  }

  get remaining(): number {
    return this.limit - this.#used
  }

  tryConsume(): boolean {
    if (this.#used >= this.limit) return false
    this.#used++
    return true
  }
}

export type HttpFailureKind =
  | 'access_denied' // 401, 403
  | 'bad_request' // 400
  | 'rate_limited' // 429 după toate încercările
  | 'server_error' // 5xx după toate încercările
  | 'network_error'
  | 'budget_exhausted'
  | 'unexpected_status'

export type HttpSuccess = { ok: true; status: number; body: string; attempts: number }
export type HttpFailure = {
  ok: false
  kind: HttpFailureKind
  status: number | null
  attempts: number
  message: string
}
export type HttpResult = HttpSuccess | HttpFailure

export type RetryOptions = {
  budget: CallBudget
  maxAttempts?: number
  baseDelayMs?: number
  /** Un Retry-After mai mare decât atât oprește retry-ul în loc să aștepte. */
  maxDelayMs?: number
  /**
   * Programul explicit de așteptare între încercări (de ex. 1, 5, 15 minute). Dacă e dat, maxAttempts devine
   * delaysMs.length + 1. Retry-After, când există, are prioritate.
   */
  delaysMs?: number[]
  /** Jitter aplicat întârzierilor din program (nu și lui Retry-After); întoarce întârzierea finală. */
  jitter?: (delayMs: number) => number
  fetch?: FetchLike
  sleep?: Sleep
  now?: () => number
}

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retry-After: secunde sau dată HTTP. Întoarce milisecunde, sau null dacă lipsește ori e invalid. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - nowMs)
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function failureFor(status: number): { kind: HttpFailureKind; message: string } {
  if (status === 401 || status === 403) {
    return { kind: 'access_denied', message: `Acces refuzat (${status}): token invalid, expirat sau fără drept pe proiect.` }
  }
  if (status === 400) return { kind: 'bad_request', message: 'Parametri invalizi (400).' }
  if (status === 429) return { kind: 'rate_limited', message: 'Limită de apeluri atinsă (429).' }
  if (status >= 500) return { kind: 'server_error', message: `Eroare la furnizor (${status}).` }
  return { kind: 'unexpected_status', message: `Răspuns neașteptat (${status}).` }
}

export async function fetchWithRetry(url: string, init: RequestInit, options: RetryOptions): Promise<HttpResult> {
  const {
    budget,
    delaysMs,
    jitter = (ms: number) => ms,
    maxAttempts = delaysMs ? delaysMs.length + 1 : 3,
    baseDelayMs = 1000,
    maxDelayMs = 60_000,
    fetch: doFetch = globalThis.fetch,
    sleep = defaultSleep,
    now = Date.now,
  } = options

  let attempts = 0
  let lastStatus: number | null = null
  let lastFailure: { kind: HttpFailureKind; message: string } | null = null

  while (attempts < maxAttempts) {
    if (!budget.tryConsume()) {
      return {
        ok: false,
        kind: 'budget_exhausted',
        status: lastStatus,
        attempts,
        message: `Buget de apeluri epuizat (${budget.used}/${budget.limit})${lastFailure ? ` după: ${lastFailure.message}` : ''}.`,
      }
    }
    attempts++

    let retryAfterMs: number | null = null
    try {
      const res = await doFetch(url, init)
      lastStatus = res.status
      if (res.ok) return { ok: true, status: res.status, body: await res.text(), attempts }
      await res.body?.cancel()
      lastFailure = failureFor(res.status)
      if (!isRetryable(res.status)) {
        return { ok: false, ...lastFailure, status: res.status, attempts }
      }
      retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now())
    } catch (err) {
      lastStatus = null
      lastFailure = { kind: 'network_error', message: `Eroare de rețea: ${(err as Error).message}` }
    }

    if (attempts >= maxAttempts) break

    const scheduled = delaysMs ? delaysMs[attempts - 1] ?? delaysMs[delaysMs.length - 1]! : baseDelayMs * 2 ** (attempts - 1)
    const delay = retryAfterMs ?? Math.max(0, Math.round(jitter(scheduled)))
    if (delay > maxDelayMs) {
      return {
        ok: false,
        kind: lastFailure.kind,
        status: lastStatus,
        attempts,
        message: `${lastFailure.message} Retry-After de ${Math.round(delay / 1000)} s depășește limita; nu reîncerc.`,
      }
    }
    await sleep(delay)
  }

  return {
    ok: false,
    kind: lastFailure?.kind ?? 'unexpected_status',
    status: lastStatus,
    attempts,
    message: `${lastFailure?.message ?? 'Eșec.'} (${attempts} încercări)`,
  }
}
