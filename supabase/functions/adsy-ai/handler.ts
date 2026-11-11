// Funcția server AdSy AI (Etapa 4, deciziile M). Independentă de runtime (doar fetch), testabilă în Node.
//
// POST { action: "status", brand_id } → 200 { configured, model_id, prompt_version }
// POST { action: "chat", brand_id, question, period: { start, end }, comparison?: "previous" | "year_ago" }
//   → 200 { status, answer?, cached?, model_id?, prompt_version?, request_id? }
//   status: ok | insufficient_evidence | out_of_scope | rejected | ai_off | not_configured | budget_exhausted | rate_limited | model_error
//
// Ordinea verificărilor, toate pe server:
// 1. Sesiunea utilizatorului (GoTrue).
// 2. Accesul la brand și controalele AdSy AI, prin `brand_ai_settings` chemat cu sesiunea utilizatorului (RLS). Cu chatul
//    oprit de politică sau de preferință, funcția se oprește aici: nu citește date și nu cheamă modelul.
// 3. Contextul (indicatori, analize publicate) se citește tot cu sesiunea utilizatorului: modelul vede doar ce vede el.
// 4. Plafonul lunar al brandului și limita zilnică a utilizatorului, apoi cache-ul.
// 5. Un singur apel către model, fără unelte. Răspunsul e verificat (contract.ts) înainte să ajungă la utilizator.
// Cheia de service scrie doar jurnalul `ai_requests`, cu tenant și brand verificate explicit. Cheia modelului nu apare în
// răspunsuri, în jurnal sau în prompt.

import { ALLOWED_HEADERS } from '../_shared/cors.ts'
import { buildContext, CHAT_METRIC_KEYS, MAX_QUESTION, PROMPT_VERSION, RESPONSE_SCHEMA, sha256Hex, SYSTEM_PROMPT, userPrompt, verifyAnswer, type Answer, type InsightRow, type MetricRow, type Period } from './contract.ts'
import { generateJson, isValidModelId } from './gemini.ts'

export type HandlerEnv = {
  supabaseUrl: string
  serviceRoleKey: string
  anonKey: string
  allowedOrigin?: string
  /** Cheia Gemini API și modelul: fără ele, AdSy AI e „neconfigurat” și nu pleacă nicio cerere. */
  geminiApiKey?: string
  modelId?: string
}
export type HandlerDeps = { env: HandlerEnv; fetch: (input: string, init?: RequestInit) => Promise<Response>; now?: () => Date }

/** Cereri de chat pe utilizator în 24 de ore, pe lângă plafonul lunar de tokeni al brandului. */
export const MAX_USER_REQUESTS_PER_DAY = 60
export const MAX_PERIOD_DAYS = 400
const MAX_OUTPUT_TOKENS = 1200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function corsHeaders(env: HandlerEnv): Record<string, string> {
  if (!env.allowedOrigin) return {}
  return { 'Access-Control-Allow-Origin': env.allowedOrigin, 'Access-Control-Allow-Headers': ALLOWED_HEADERS, 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
}
const json = (env: HandlerEnv, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(env) } })

type Actor = { id: string; authorization: string }
type Settings = { tenant_id: string; policy: { chat: boolean; monthly_token_cap: number | null }; preference: { chat: boolean }; effective: { chat: boolean } }
type ChatInput = { brandId: string; question: string; period: Period; comparison: 'previous' | 'year_ago' }

async function authenticate(req: Request, { env, fetch }: HandlerDeps): Promise<Actor> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(auth)) throw new HttpError(401, 'Autentificare necesară.')
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, { headers: { apikey: env.anonKey, Authorization: auth } })
  if (!res.ok) throw new HttpError(401, 'Sesiune invalidă sau expirată.')
  const user = (await res.json()) as { id?: unknown }
  if (typeof user.id !== 'string' || !UUID.test(user.id)) throw new HttpError(401, 'Sesiune invalidă.')
  return { id: user.id, authorization: auth }
}

const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const dayCount = (p: Period) => Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / 86_400_000) + 1

export function parseBrand(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.brand_id !== 'string' || !UUID.test(b.brand_id)) throw new HttpError(400, 'brand_id invalid.')
  return b.brand_id.toLowerCase()
}

export function parseChat(body: unknown): ChatInput {
  const b = (body ?? {}) as Record<string, unknown>
  const brandId = parseBrand(body)
  const question = typeof b.question === 'string' ? b.question.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : ''
  if (question.length < 3) throw new HttpError(400, 'Scrie o întrebare.')
  if (question.length > MAX_QUESTION) throw new HttpError(400, `Întrebarea are cel mult ${MAX_QUESTION} de caractere.`)
  const p = (b.period ?? {}) as Record<string, unknown>
  if (!isDate(p.start) || !isDate(p.end) || p.end < p.start) throw new HttpError(400, 'Perioadă invalidă.')
  const period = { start: p.start, end: p.end }
  if (dayCount(period) > MAX_PERIOD_DAYS + 1) throw new HttpError(400, 'Perioada e prea lungă.')
  if (b.comparison !== undefined && b.comparison !== 'previous' && b.comparison !== 'year_ago') throw new HttpError(400, 'Comparație necunoscută.')
  return { brandId, question, period, comparison: b.comparison === 'year_ago' ? 'year_ago' : 'previous' }
}

/** Perioada de comparație, ca în `metrics.comparison_period` (anterioară de aceeași lungime sau cu un an înainte). */
export function comparisonPeriod(period: Period, comparison: 'previous' | 'year_ago'): Period {
  if (comparison === 'previous') return { start: addDays(period.start, -dayCount(period)), end: addDays(period.start, -1) }
  const back = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
    // 29 februarie devine 28 februarie, ca în Postgres.
    const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
    return `${String(y - 1).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
  }
  return { start: back(period.start), end: back(period.end) }
}

/** Începutul lunii calendaristice în Europe/Bucharest, ca moment UTC (regula 9). */
export function bucharestMonthStart(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = Number(parts.find((p) => p.type === 'year')!.value)
  const m = Number(parts.find((p) => p.type === 'month')!.value)
  // Decalajul României e +2 sau +3: încercăm ambele și păstrăm momentul care e chiar miezul nopții la București.
  for (const offset of [3, 2]) {
    const candidate = new Date(Date.UTC(y, m - 1, 1, -offset))
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', day: '2-digit', hourCycle: 'h23' }).formatToParts(candidate)
    if (local.find((p) => p.type === 'hour')!.value === '00' && local.find((p) => p.type === 'day')!.value === '01') return candidate.toISOString()
  }
  return new Date(Date.UTC(y, m - 1, 1, -2)).toISOString()
}

/** PostgREST cu sesiunea utilizatorului: RLS decide ce se vede. 42501 = fără acces la brand. */
async function asUser<T>(deps: HandlerDeps, actor: Actor, path: string, init: RequestInit = {}): Promise<T> {
  const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: deps.env.anonKey, Authorization: actor.authorization, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  })
  const text = await res.text()
  if (!res.ok) {
    let code = ''
    try {
      code = (JSON.parse(text) as { code?: string }).code ?? ''
    } catch {
      // ignorat
    }
    if (code === '42501') throw new HttpError(403, 'Nu ai acces la acest spațiu de brand.')
    throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

/** PostgREST cu cheia de service: doar jurnalul `ai_requests`, mereu cu tenant și brand în filtru sau în rând. */
async function asService<T>(deps: HandlerDeps, path: string, init: RequestInit = {}): Promise<T> {
  const res = await deps.fetch(`${deps.env.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: deps.env.serviceRoleKey, Authorization: `Bearer ${deps.env.serviceRoleKey}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`REST ${path.split('?')[0]}: ${res.status}`)
  return (text ? JSON.parse(text) : null) as T
}

async function loadSettings(deps: HandlerDeps, actor: Actor, brandId: string): Promise<Settings> {
  const s = await asUser<Settings | null>(deps, actor, 'rpc/brand_ai_settings', { method: 'POST', body: JSON.stringify({ p_brand_id: brandId }) })
  if (!s || typeof s.tenant_id !== 'string' || !UUID.test(s.tenant_id) || typeof s.effective?.chat !== 'boolean' || typeof s.policy?.chat !== 'boolean') throw new Error('brand_ai_settings: răspuns neașteptat')
  return s
}

const configured = (env: HandlerEnv) => typeof env.geminiApiKey === 'string' && env.geminiApiKey.trim() !== '' && typeof env.modelId === 'string' && isValidModelId(env.modelId)

type LogRow = { status: Answer['status'] | 'error'; response: Answer | null; reason: string | null; cachedFrom: string | null; usage: { prompt_tokens: number; output_tokens: number; total_tokens: number } }

async function chat(deps: HandlerDeps, actor: Actor, input: ChatInput): Promise<Record<string, unknown>> {
  const { env } = deps
  const now = deps.now ?? (() => new Date())
  const settings = await loadSettings(deps, actor, input.brandId)
  // Oprit de politică sau de preferință: nimic nu mai pleacă de aici, nici spre date, nici spre model.
  if (!settings.effective.chat) return { status: 'ai_off', blocked_by: settings.policy.chat ? 'preference' : 'policy' }
  if (!configured(env)) return { status: 'not_configured' }
  const modelId = env.modelId as string
  const tenantId = settings.tenant_id

  // Contextul, citit cu sesiunea utilizatorului.
  const brands = await asUser<Array<{ id: string; tenant_id: string; name: string }>>(deps, actor, `brands?select=id,tenant_id,name&id=eq.${input.brandId}`)
  const brand = brands[0]
  if (brands.length !== 1 || !brand || brand.id !== input.brandId || brand.tenant_id !== tenantId) throw new HttpError(403, 'Nu ai acces la acest spațiu de brand.')
  const [envelope, definitions, insights] = await Promise.all([
    asUser<{ data?: MetricRow[] }>(deps, actor, 'rpc/brand_metrics', {
      method: 'POST',
      body: JSON.stringify({ p_brand_id: input.brandId, p_metric_keys: CHAT_METRIC_KEYS, p_start: input.period.start, p_end: input.period.end, p_kind: input.comparison === 'year_ago' ? 'yoy' : 'custom' }),
    }),
    asUser<Array<{ metric_key: string; name_ro: string }>>(deps, actor, `metric_definitions_current?select=metric_key,name_ro&metric_key=in.(${CHAT_METRIC_KEYS.join(',')})`),
    asUser<InsightRow[]>(deps, actor, 'rpc/brand_insights', { method: 'POST', body: JSON.stringify({ p_brand_id: input.brandId, p_start: input.period.start, p_end: input.period.end }) }),
  ])
  const ctx = buildContext({
    brandName: brand.name,
    period: input.period,
    comparisonPeriod: comparisonPeriod(input.period, input.comparison),
    metrics: Array.isArray(envelope?.data) ? envelope.data : [],
    definitions: Array.isArray(definitions) ? definitions : [],
    insights: Array.isArray(insights) ? insights : [],
  })
  const snapshot = await sha256Hex(JSON.stringify(ctx.data))
  const cacheKey = await sha256Hex([tenantId, input.brandId, 'chat', snapshot, modelId, PROMPT_VERSION, input.question.toLowerCase().replace(/\s+/g, ' ')].join('\n'))
  const scope = `tenant_id=eq.${tenantId}&brand_id=eq.${input.brandId}`

  const log = async (row: LogRow): Promise<string | null> => {
    const saved = await asService<Array<{ id: string }>>(deps, 'ai_requests', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: tenantId, brand_id: input.brandId, user_id: actor.id, task: 'chat', model_id: modelId, prompt_version: PROMPT_VERSION, question: input.question,
        period_start: input.period.start, period_end: input.period.end, data_snapshot_id: snapshot, cache_key: cacheKey,
        status: row.status, response: row.response, rejection_reason: row.reason, cached_from: row.cachedFrom, ...row.usage,
      }),
    })
    return saved?.[0]?.id ?? null
  }
  const none = { prompt_tokens: 0, output_tokens: 0, total_tokens: 0 }

  // Cache: aceleași date, aceeași întrebare, același model și prompt. Un răspuns din cache nu consumă tokeni.
  const cached = await asService<Array<{ id: string; tenant_id: string; brand_id: string; status: Answer['status']; response: Answer | null }>>(
    deps,
    `ai_requests?select=id,tenant_id,brand_id,status,response&${scope}&cache_key=eq.${cacheKey}&cached_from=is.null&status=in.(ok,insufficient_evidence,out_of_scope)&order=created_at.desc&limit=1`,
  )
  const hit = cached[0]
  if (hit && hit.response) {
    if (hit.tenant_id !== tenantId || hit.brand_id !== input.brandId) throw new Error('Cache citit pentru alt client sau alt brand; opresc cererea.')
    const requestId = await log({ status: hit.status, response: hit.response, reason: hit.response.reason, cachedFrom: hit.id, usage: none })
    return { status: hit.status, answer: publicAnswer(hit.response), cached: true, model_id: modelId, prompt_version: PROMPT_VERSION, request_id: requestId }
  }

  // Plafoane: tokenii lunii pe brand și cererile zilei pe utilizator. Cererile servite din cache nu se numără.
  const cap = typeof settings.policy.monthly_token_cap === 'number' && settings.policy.monthly_token_cap > 0 ? settings.policy.monthly_token_cap : 0
  const month = await asService<Array<{ tenant_id: string; brand_id: string; total_tokens: number }>>(
    deps,
    `ai_requests?select=tenant_id,brand_id,total_tokens&${scope}&created_at=gte.${encodeURIComponent(bucharestMonthStart(now()))}&total_tokens=gt.0&limit=20000`,
  )
  if (month.some((r) => r.tenant_id !== tenantId || r.brand_id !== input.brandId)) throw new Error('Consum citit pentru alt client sau alt brand; opresc cererea.')
  if (month.reduce((sum, r) => sum + (Number(r.total_tokens) || 0), 0) >= cap) return { status: 'budget_exhausted' }
  const since = new Date(now().getTime() - 86_400_000).toISOString()
  const mine = await asService<Array<{ id: string }>>(deps, `ai_requests?select=id&tenant_id=eq.${tenantId}&user_id=eq.${actor.id}&cached_from=is.null&created_at=gte.${encodeURIComponent(since)}&limit=${MAX_USER_REQUESTS_PER_DAY}`)
  if (mine.length >= MAX_USER_REQUESTS_PER_DAY) return { status: 'rate_limited' }

  const result = await generateJson(deps.fetch, {
    apiKey: env.geminiApiKey as string, modelId, system: SYSTEM_PROMPT, user: userPrompt(ctx, input.question), schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.2,
  })
  if (!result.ok) {
    const requestId = await log({ status: 'error', response: null, reason: `model:${result.kind}`, cachedFrom: null, usage: result.usage })
    return { status: 'model_error', code: result.kind, model_id: modelId, prompt_version: PROMPT_VERSION, request_id: requestId }
  }
  const answer = verifyAnswer(result.text, ctx, input.question)
  const requestId = await log({ status: answer.status, response: answer, reason: answer.reason, cachedFrom: null, usage: result.usage })
  return { status: answer.status, answer: publicAnswer(answer), cached: false, model_id: modelId, prompt_version: PROMPT_VERSION, request_id: requestId }
}

/** Ce ajunge la utilizator: fără motivul intern al respingerii. */
function publicAnswer(a: Answer): Omit<Answer, 'reason'> {
  const { reason: _reason, ...rest } = a
  return rest
}

export async function handle(req: Request, deps: HandlerDeps): Promise<Response> {
  const { env } = deps
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) })
  if (req.method !== 'POST') return json(env, 405, { error: 'Metodă nepermisă.' })
  try {
    const actor = await authenticate(req, deps)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw new HttpError(400, 'Corp JSON invalid.')
    }
    const action = (body as { action?: unknown } | null)?.action
    if (action === 'status') {
      // Verifică accesul la brand înainte să spună ceva despre configurare.
      await loadSettings(deps, actor, parseBrand(body))
      return json(env, 200, { configured: configured(env), model_id: configured(env) ? env.modelId : null, prompt_version: PROMPT_VERSION })
    }
    if (action === 'chat') return json(env, 200, await chat(deps, actor, parseChat(body)))
    throw new HttpError(400, 'Acțiune necunoscută.')
  } catch (err) {
    if (err instanceof HttpError) return json(env, err.status, { error: err.message })
    // Detaliile erorii rămân în logul funcției; răspunsul nu spune nimic despre schemă, model sau chei.
    console.error(`adsy-ai: ${(err as Error).message}`)
    return json(env, 500, { error: 'AdSy AI nu a putut răspunde. Reîncearcă.' })
  }
}
