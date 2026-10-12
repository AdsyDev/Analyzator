// Conectorul săptămânal TikTok Ads. Rulare: npm run collect:tiktok
// Mediu: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TIKTOK_APP_ID, TIKTOK_APP_SECRET. Contract: docs/contracts/tiktok-ads.md.

import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectTikTok, tiktokEnvFrom } from './collect-core.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectTikTok({ db, env: tiktokEnvFrom(process.env) })
  let failed = 0
  for (const o of outcomes) {
    const detail = o.status === 'not_connected' ? `not_connected (${o.reason ?? ''})` : `${o.status}, ${o.rows_written} rânduri, ${o.errors.length} erori/note`
    console.log(`brand ${o.brand_id ?? '—'} · tiktok_ads: ${detail}`)
    for (const e of o.errors.filter((x) => !x.code.startsWith('parser_'))) console.log(`  ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log('Nicio conexiune TikTok Ads activă.')
  if (failed) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`Eroare: ${(e as Error).message}`)
  process.exitCode = 1
})
