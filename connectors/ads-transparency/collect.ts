// Colectorul săptămânal Google Ads Transparency (reclamele competitorilor). Rulare: npm run collect:ads-transparency
// Configurare: ID-urile de advertiser pe setul de competitori (create_competitor_set_version) și service account-ul
// Google al clientului (google_service_account), cu rolul BigQuery Job User. Contract: docs/contracts/ads-transparency.md.

import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectAdsTransparency } from './collect-core.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectAdsTransparency({ db })
  let failed = 0
  for (const o of outcomes) {
    const detail = o.status === 'not_connected' ? `not_connected (${o.reason ?? ''})` : `${o.status}, ${o.rows_written} rânduri`
    console.log(`brand ${o.brand_id} · ads_transparency: ${detail}`)
    for (const e of o.errors) console.log(`  ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log('Niciun brand cu ID-uri de advertiser în setul de competitori.')
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
