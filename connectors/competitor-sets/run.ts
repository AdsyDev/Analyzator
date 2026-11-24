// Seturile de competitori din datele surselor (decizia Y-17). Rulare: workflow-ul manual `competitor-sets`, sau local:
//   npm run competitor-sets -- discover
//   COMPETITOR_SETS='{"proenzi": {...}}' npm run competitor-sets -- create [--apply]
// Fără --apply, `create` doar arată ce ar scrie.

import { parseArgs } from 'node:util'
import { calendarDateIn } from '../google/dates.ts'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { createSets, discover, discoveryReport, type SetInput } from './core.ts'

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { apply: { type: 'boolean', default: false } }, strict: true })
  const mode = positionals[0]
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const today = calendarDateIn(new Date(), 'Europe/Bucharest')
  if (mode === 'discover') {
    const found = await discover(db, today)
    console.log(discoveryReport(found))
    return
  }
  if (mode === 'create') {
    const raw = process.env.COMPETITOR_SETS ?? ''
    let input: Record<string, SetInput>
    try {
      input = JSON.parse(raw) as Record<string, SetInput>
    } catch {
      throw new Error('COMPETITOR_SETS lipsește sau nu e JSON: { "<slug sau ID brand>": { "effective_from": "YYYY-MM-DD", "note": "...", "members": [ ... ] } }')
    }
    const out = await createSets(db, input, { today, apply: values.apply })
    let bad = 0
    for (const o of out) {
      console.log(`${o.brand}: ${o.status}${o.version ? `, v${o.version} din ${o.effective_from}` : ''}`)
      for (const m of o.members ?? []) {
        console.log(`  ${m.name}${m.domain ? ` · ${m.domain}` : ''} · cuvinte: ${m.listening_keywords.join(', ') || '(numele)'} · profiluri: ${m.social_handles.join(', ') || '(numele)'} · advertiseri: ${m.ads_advertiser_ids.join(', ') || '—'}`)
      }
      for (const e of o.errors ?? []) console.log(`  eroare: ${e}`)
      if (o.status === 'invalid' || o.status === 'not_found') bad++
    }
    if (!values.apply) console.log('Rulare de probă: nimic scris. Repornește cu apply = true ca să scrii.')
    if (bad) process.exitCode = 1
    return
  }
  throw new Error('Mod necunoscut: discover sau create')
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
