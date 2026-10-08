// Clasificarea erorilor bibliotecilor Google (gRPC pentru GA4, HTTP pentru GSC) și retry cu backoff.

export type GoogleFailureKind =
  | 'access_denied' // 401/403, gRPC 7 PERMISSION_DENIED / 16 UNAUTHENTICATED
  | 'bad_request' // 400, gRPC 3 INVALID_ARGUMENT / 9 FAILED_PRECONDITION / 5 NOT_FOUND
  | 'rate_limited' // 429, gRPC 8 RESOURCE_EXHAUSTED
  | 'server_error' // 5xx, gRPC 13 INTERNAL / 14 UNAVAILABLE / 4 DEADLINE_EXCEEDED
  | 'network_error'
  | 'unexpected'

export type GoogleFailure = { kind: GoogleFailureKind; message: string; code: number | string | null }

const GRPC: Record<number, GoogleFailureKind> = {
  3: 'bad_request', 5: 'bad_request', 9: 'bad_request', 11: 'bad_request',
  7: 'access_denied', 16: 'access_denied',
  8: 'rate_limited',
  4: 'server_error', 13: 'server_error', 14: 'server_error',
}

export function classifyGoogleError(err: unknown): GoogleFailure {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; message?: unknown; response?: { status?: unknown } }
  const httpStatus = typeof e.response?.status === 'number' ? e.response.status : typeof e.status === 'number' ? e.status : null
  const code = httpStatus ?? (typeof e.code === 'number' || typeof e.code === 'string' ? e.code : null)
  // Mesajul poate conține detalii de la Google; niciodată cheia privată (nu o primește niciun apel de log).
  const message = typeof e.message === 'string' ? e.message.slice(0, 300) : 'eroare necunoscută'

  const status = httpStatus ?? (typeof e.code === 'number' && e.code >= 400 ? e.code : null)
  if (status !== null) {
    if (status === 401 || status === 403) return { kind: 'access_denied', message, code: status }
    if (status === 429) return { kind: 'rate_limited', message, code: status }
    if (status === 400 || status === 404) return { kind: 'bad_request', message, code: status }
    if (status >= 500) return { kind: 'server_error', message, code: status }
  }
  if (typeof e.code === 'number' && GRPC[e.code]) return { kind: GRPC[e.code]!, message, code: e.code }
  if (typeof e.code === 'string' && /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)$/.test(e.code)) {
    return { kind: 'network_error', message, code: e.code }
  }
  return { kind: 'unexpected', message, code }
}

export type CallResult<T> = { ok: true; value: T; attempts: number } | { ok: false; failure: GoogleFailure; attempts: number }

const RETRYABLE: ReadonlySet<GoogleFailureKind> = new Set(['rate_limited', 'server_error', 'network_error'])

/** 3 încercări, backoff exponențial; accesul refuzat și cererile invalide nu se reîncearcă. */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: { sleep: (ms: number) => Promise<void>; attempts?: number; baseDelayMs?: number },
): Promise<CallResult<T>> {
  const max = options.attempts ?? 3
  const base = options.baseDelayMs ?? 1000
  let last: GoogleFailure | null = null
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return { ok: true, value: await fn(), attempts: attempt }
    } catch (err) {
      last = classifyGoogleError(err)
      if (!RETRYABLE.has(last.kind) || attempt === max) return { ok: false, failure: last, attempts: attempt }
      await options.sleep(base * 2 ** (attempt - 1))
    }
  }
  return { ok: false, failure: last ?? { kind: 'unexpected', message: 'eșec', code: null }, attempts: max }
}
