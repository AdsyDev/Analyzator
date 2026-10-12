// Conectorul săptămânal Meta Ads. Rulare: npm run collect:meta
// Conexiunile: `meta_account` per client (tokenul system user din Vault) și `meta_ads` per brand (contul de ads).
// Contract: docs/contracts/meta-ads.md.

import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectMeta } from './collect-core.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectMeta({ db })
  let failed = 0
  for (const o of outcomes) {
    const detail = o.status === 'not_connected' ? `not_connected (${o.reason ?? ''})` : `${o.status}, ${o.rows_written} rânduri, ${o.errors.length} erori/note`
    console.log(`brand ${o.brand_id ?? '—'} · meta_ads: ${detail}`)
    for (const e of o.errors.filter((x) => !x.code.startsWith('parser_'))) console.log(`  ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log('Nicio conexiune Meta Ads activă.')
  if (failed) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`Eroare: ${(e as Error).message}`)
  process.exitCode = 1
})
