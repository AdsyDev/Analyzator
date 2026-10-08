// Colectorul GA4 și Search Console. Rulare: npm run collect:google [-- --only ga4|gsc]
// Configurare: source_connections (google_service_account per tenant, ga4 și gsc per brand); service account în Vault.
// Contract: docs/contracts/google.md.

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectGoogle, type GoogleSource } from './collect-core.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: 'string' } }, strict: true })
  if (values.only !== undefined && values.only !== 'ga4' && values.only !== 'gsc') throw new Error('--only acceptă ga4 sau gsc.')
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectGoogle({ db }, values.only as GoogleSource | undefined)

  let failed = 0
  for (const o of outcomes) {
    if (o.status === 'not_connected') {
      console.log(`${o.source} ${o.connection_id}: neconectat (${o.reason})`)
      continue
    }
    console.log(
      `${o.source} ${o.connection_id} brand ${o.brand_id}: ${o.status}, ${o.rows_written} rânduri, ${o.api_calls} apeluri` +
        (o.errors.length ? `, ${o.errors.length} note în sync_runs.errors` : ''),
    )
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log('Nicio conexiune ga4/gsc activă.')
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
