// Rulează setul de evaluare AdSy AI pe modelul real: `npm run eval:ai` (deciziile Q).
//
//   GEMINI_API_KEY=… npm run eval:ai -- [--model id[,id…]] [--cases cale.json] [--group nume]
//
// Trimite modelului DOAR cazurile din fișier (implicit cele sintetice din tests/fixtures/adsy-ai). Nu citește și nu scrie
// în bază. Fiecare răspuns trece prin aceeași verificare ca în producție, deci rezultatul arată ce ar vedea utilizatorul.
// Codul de ieșire e 1 dacă există vreun caz nesigur sau dacă rata de reușită e sub prag: se rulează înainte de a schimba
// modelul sau promptul. Cheia se citește din mediu și nu se afișează.

import { readFileSync } from 'node:fs'
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, PROMPT_VERSION, userPrompt } from '../../supabase/functions/adsy-ai/contract.ts'
import { DEFAULT_MODEL_ID, generateJson } from '../../supabase/functions/adsy-ai/gemini.ts'
import { contextOf, modelError, parseEvalSet, scoreCase, summarize, type CaseResult } from './evaluate.ts'

const DEFAULT_CASES = new URL('../../tests/fixtures/adsy-ai/eval-cases.json', import.meta.url)
/** Sub acest prag de cazuri reușite, modelul sau promptul nu se schimbă în producție. */
const MIN_PASS_RATE = 0.85

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

const key = process.env.GEMINI_API_KEY
if (!key) {
  console.error('Lipsește GEMINI_API_KEY în mediu (de exemplu în .env.local, care nu se comite).')
  process.exit(2)
}
const casesPath = arg('cases')
const set = parseEvalSet(JSON.parse(readFileSync(casesPath ?? DEFAULT_CASES, 'utf8')))
const group = arg('group')
const cases = group ? set.cases.filter((c) => c.group === group) : set.cases
const models = (arg('model') ?? process.env.ADSY_AI_MODEL ?? DEFAULT_MODEL_ID).split(',').map((m) => m.trim()).filter(Boolean)

let failed = false
for (const modelId of models) {
  const results: CaseResult[] = []
  let tokens = 0
  let ms = 0
  for (const c of cases) {
    const ctx = contextOf(set, c)
    const started = Date.now()
    const r = await generateJson(fetch, { apiKey: key, modelId, system: SYSTEM_PROMPT, user: userPrompt(ctx, c.question), schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>, maxOutputTokens: 1200, temperature: 0.2 })
    ms += Date.now() - started
    tokens += r.usage.total_tokens
    const result = r.ok ? scoreCase(c, ctx, r.text) : modelError(c, r.kind)
    results.push(result)
    const mark = result.unsafe ? 'NESIGUR' : result.pass ? 'ok     ' : 'picat  '
    console.log(`${mark} ${c.id} [${c.group}] ${result.status}${result.problems.length ? ` :: ${result.problems.join('; ')}` : ''}`)
    if (!result.pass && result.text.trim()) console.log(`          ${result.text.replace(/\s+/g, ' ').slice(0, 240)}`)
  }
  const s = summarize(results)
  const answered = s.total - s.errors
  const rate = answered > 0 ? s.passed / answered : 0
  console.log(`\n${modelId} · prompt ${PROMPT_VERSION}: ${s.passed} din ${s.total} reușite (${(rate * 100).toFixed(0)} % din cele ${answered} la care modelul a răspuns), ${s.unsafe} nesigure, ${s.errors} fără răspuns de la model`)
  console.log(Object.entries(s.byGroup).map(([g, v]) => `  ${g}: ${v.passed}/${v.total}`).join('\n'))
  console.log(`  ${tokens} tokeni, ${cases.length ? Math.round(ms / cases.length) : 0} ms pe caz\n`)
  if (s.unsafe > 0 || rate < MIN_PASS_RATE || answered === 0) failed = true
}
process.exit(failed ? 1 : 0)
