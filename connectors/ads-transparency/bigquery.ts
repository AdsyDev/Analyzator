// Client minim pentru BigQuery REST (jobs.query + jobs.getQueryResults), peste o funcție de cerere autentificată injectată.
// Testele dau o funcție simulată; rularea reală folosește google-auth-library (deja dependență a proiectului).

import { GoogleAuth } from 'google-auth-library'
import { BQ_BASE_URL, BQ_LOCATION, BQ_SCOPE, MAX_PAGES, MAX_POLLS, PAGE_ROWS, QUERY_TIMEOUT_MS } from './config.ts'

export type HttpResult = { status: number; data: unknown }
/** O cerere HTTP autentificată (Bearer de la service account). Nu aruncă pentru 4xx/5xx: întoarce statusul. */
export type AuthedRequest = (req: { url: string; method: 'GET' | 'POST'; data?: unknown }) => Promise<HttpResult>

export type QueryParam = { name: string; type: 'STRING'; value: string } | { name: string; type: 'ARRAY<STRING>'; values: string[] }

export type QueryOutcome =
  | { ok: true; rows: Array<Array<string | null>>; fields: string[]; bytesBilled: number | null; truncated: boolean; calls: number }
  | { ok: false; status: number | null; reason: string; message: string; calls: number }

type BqError = { error?: { code?: number; message?: string; errors?: Array<{ reason?: string; message?: string }> } }
type BqPage = {
  jobComplete?: boolean
  jobReference?: { projectId?: string; jobId?: string; location?: string }
  schema?: { fields?: Array<{ name?: string }> }
  rows?: Array<{ f?: Array<{ v?: unknown }> }>
  pageToken?: string
  totalBytesBilled?: string
  errors?: Array<{ reason?: string; message?: string }>
}

function toParam(p: QueryParam) {
  return p.type === 'STRING'
    ? { name: p.name, parameterType: { type: 'STRING' }, parameterValue: { value: p.value } }
    : { name: p.name, parameterType: { type: 'ARRAY', arrayType: { type: 'STRING' } }, parameterValue: { arrayValues: p.values.map((value) => ({ value })) } }
}

function failure(r: HttpResult, calls: number): QueryOutcome {
  const e = (r.data as BqError | null)?.error
  const reason = e?.errors?.[0]?.reason ?? (r.status === 401 || r.status === 403 ? 'access_denied' : 'bigquery_error')
  return { ok: false, status: r.status, reason, message: (e?.message ?? `HTTP ${r.status}`).slice(0, 500), calls }
}

/** Celulele unui rând plat (doar coloane scalare): text sau null. Valorile ne-text se serializează JSON. */
function cells(row: { f?: Array<{ v?: unknown }> }): Array<string | null> {
  return (row.f ?? []).map((c) => (c.v === null || c.v === undefined ? null : typeof c.v === 'string' ? c.v : JSON.stringify(c.v)))
}

/**
 * Rulează o interogare standard SQL parametrizată, cu plafon de bytes facturați, și citește toate paginile.
 * Un job neterminat în timeout se așteaptă prin getQueryResults; peste MAX_PAGES pagini, rezultatul e marcat `truncated`.
 */
export async function runQuery(request: AuthedRequest, o: { project: string; sql: string; params: QueryParam[]; maxBytesBilled: number }): Promise<QueryOutcome> {
  let calls = 1
  const first = await request({
    url: `${BQ_BASE_URL}/projects/${encodeURIComponent(o.project)}/queries`,
    method: 'POST',
    data: {
      query: o.sql,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: o.params.map(toParam),
      maximumBytesBilled: String(Math.floor(o.maxBytesBilled)),
      maxResults: PAGE_ROWS,
      timeoutMs: QUERY_TIMEOUT_MS,
      location: BQ_LOCATION,
      useQueryCache: true,
    },
  })
  if (first.status < 200 || first.status >= 300) return failure(first, calls)
  let page = first.data as BqPage
  if (page.errors?.length) return { ok: false, status: null, reason: page.errors[0]?.reason ?? 'bigquery_error', message: (page.errors[0]?.message ?? 'eroare BigQuery').slice(0, 500), calls }
  const job = page.jobReference
  const results = (pageToken?: string) => {
    const q = new URLSearchParams({ location: job?.location ?? BQ_LOCATION, maxResults: String(PAGE_ROWS), timeoutMs: String(QUERY_TIMEOUT_MS) })
    if (pageToken) q.set('pageToken', pageToken)
    return `${BQ_BASE_URL}/projects/${encodeURIComponent(job?.projectId ?? o.project)}/queries/${encodeURIComponent(job?.jobId ?? '')}?${q}`
  }
  for (let poll = 0; page.jobComplete === false; poll++) {
    if (poll >= MAX_POLLS || !job?.jobId) return { ok: false, status: null, reason: 'timeout', message: 'Interogarea BigQuery nu s-a terminat în timpul alocat.', calls }
    const r = await request({ url: results(), method: 'GET' })
    calls++
    if (r.status < 200 || r.status >= 300) return failure(r, calls)
    page = r.data as BqPage
  }
  const fields = (page.schema?.fields ?? []).map((f) => f.name ?? '')
  const rows = (page.rows ?? []).map(cells)
  const bytesBilled = page.totalBytesBilled !== undefined ? Number(page.totalBytesBilled) : null
  let token = page.pageToken
  let pages = 1
  while (token && pages < MAX_PAGES) {
    const r = await request({ url: results(token), method: 'GET' })
    calls++
    if (r.status < 200 || r.status >= 300) return failure(r, calls)
    const next = r.data as BqPage
    rows.push(...(next.rows ?? []).map(cells))
    token = next.pageToken
    pages++
  }
  return { ok: true, rows, fields, bytesBilled, truncated: Boolean(token), calls }
}

/** Cererea reală: Bearer de la service account (JWT semnat local, fără cheie trimisă nicăieri în afară de Google OAuth). */
export function serviceAccountRequest(credentials: { client_email: string; private_key: string }): AuthedRequest {
  const auth = new GoogleAuth({ credentials, scopes: [BQ_SCOPE] })
  return async ({ url, method, data }) => {
    const client = await auth.getClient()
    try {
      const res = await client.request({ url, method, data, validateStatus: () => true })
      return { status: res.status, data: res.data }
    } catch (err) {
      return { status: 0, data: { error: { message: (err as Error).message } } }
    }
  }
}
