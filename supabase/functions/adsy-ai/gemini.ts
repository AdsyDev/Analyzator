// Adaptorul de model pentru AdSy AI: Gemini API (generateContent), doar pe server. Independent de runtime (doar fetch).
// Cheia API vine din mediul funcției și se trimite doar în antetul cererii către Google; nu apare în loguri, în răspunsuri
// sau în prompt. Numele câmpurilor sunt cele din SDK-ul oficial `@google/genai` (v3.1.0), neconfirmate pe un cont real.

export const GEMINI_HOST = 'https://generativelanguage.googleapis.com'
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,99}$/
const TIMEOUT_MS = 45_000

export type ModelUsage = { prompt_tokens: number; output_tokens: number; total_tokens: number }
export type ModelFailure = 'auth' | 'rate_limited' | 'model_not_found' | 'blocked' | 'truncated' | 'unavailable' | 'invalid_response'
export type ModelResult = { ok: true; text: string; usage: ModelUsage } | { ok: false; kind: ModelFailure; status: number | null; usage: ModelUsage }

export type ModelRequest = {
  apiKey: string
  modelId: string
  system: string
  user: string
  /** Schema răspunsului, în subsetul OpenAPI acceptat de `responseSchema`. */
  schema: Record<string, unknown>
  maxOutputTokens: number
  temperature: number
}

export const isValidModelId = (id: string) => MODEL_ID.test(id)
const ZERO: ModelUsage = { prompt_tokens: 0, output_tokens: 0, total_tokens: 0 }
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)

function usageOf(body: unknown): ModelUsage {
  const u = (body as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata
  if (!u) return ZERO
  const prompt = int(u.promptTokenCount)
  // Tokenii de „gândire” se plătesc ca ieșire, deci intră în consum.
  const output = int(u.candidatesTokenCount) + int(u.thoughtsTokenCount)
  return { prompt_tokens: prompt, output_tokens: output, total_tokens: Math.max(int(u.totalTokenCount), prompt + output) }
}

/** Un singur apel, fără unelte: modelul primește text și întoarce JSON. Nu poate rula SQL, nu poate deschide URL-uri. */
export async function generateJson(fetchFn: (input: string, init?: RequestInit) => Promise<Response>, req: ModelRequest): Promise<ModelResult> {
  if (!isValidModelId(req.modelId)) return { ok: false, kind: 'model_not_found', status: null, usage: ZERO }
  let res: Response
  try {
    res = await fetchFn(`${GEMINI_HOST}/v1beta/models/${req.modelId}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxOutputTokens, responseMimeType: 'application/json', responseSchema: req.schema },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return { ok: false, kind: 'unavailable', status: null, usage: ZERO }
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) {
    const kind: ModelFailure = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : res.status === 404 ? 'model_not_found' : res.status === 400 ? 'invalid_response' : 'unavailable'
    return { ok: false, kind, status: res.status, usage: ZERO }
  }
  const usage = usageOf(body)
  const b = body as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> }; finishReason?: unknown }>; promptFeedback?: { blockReason?: unknown } } | null
  if (b?.promptFeedback?.blockReason) return { ok: false, kind: 'blocked', status: res.status, usage }
  const candidate = b?.candidates?.[0]
  const finish = typeof candidate?.finishReason === 'string' ? candidate.finishReason : ''
  if (finish === 'MAX_TOKENS') return { ok: false, kind: 'truncated', status: res.status, usage }
  if (finish !== '' && finish !== 'STOP') return { ok: false, kind: 'blocked', status: res.status, usage }
  const text = (candidate?.content?.parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('')
  if (text.trim() === '') return { ok: false, kind: 'invalid_response', status: res.status, usage }
  return { ok: true, text, usage }
}
