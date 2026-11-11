// Colectorul de indexare (Search Console URL Inspection). Rulare: npm run collect:index [-- --brand <uuid>]
// Inspectează URL-urile prioritare ale fiecărui brand și paginile lui cu cele mai multe clickuri (cel mult 200 pe brand).
// Configurare: aceleași conexiuni ca Search Console (google_service_account per client, gsc per brand).
// Contract: docs/contracts/google.md, secțiunea „Indexare”.

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectIndex } from './index-core.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { brand: { type: 'string' } }, strict: true })
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectIndex({ db }, { brandId: values.brand })

  let failed = 0
  for (const o of outcomes) {
    if (o.status === 'not_connected') {
      console.log(`indexare ${o.connection_id} brand ${o.brand_id ?? '—'}: nerulat (${o.reason})`)
      continue
    }
    console.log(`indexare ${o.connection_id} brand ${o.brand_id}: ${o.status}, ${o.rows_written} din ${o.urls} URL-uri inspectate`)
    // Motivele pe cod, cu numărul lor; URL-urile respinse se văd în sync_runs.errors.
    const byCode = new Map<string, number>()
    for (const e of o.errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1)
    for (const [code, n] of byCode) console.log(`  ${code}: ${n}`)
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log(values.brand ? `Nicio conexiune Search Console activă pe brandul ${values.brand}.` : 'Nicio conexiune Search Console activă.')
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
