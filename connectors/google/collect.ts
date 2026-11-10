// Colectorul GA4 și Search Console. Rulare: npm run collect:google [-- --only ga4|gsc] [--brand <uuid>]
// Reimportul istoricului unui site, pe o singură sursă (cel mult 16 luni în urmă):
//   npm run collect:google -- --only gsc --brand <uuid> --from YYYY-MM-DD   (de ex. după trecerea pe Domain property)
//   npm run collect:google -- --only ga4 --brand <uuid> --from YYYY-MM-DD   (istoric pentru perioade lungi și comparația pe an)
// Configurare: source_connections (google_service_account per tenant, ga4 și gsc per brand); service account în Vault.
// Contract: docs/contracts/google.md.

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectGoogle, type GoogleSource } from './collect-core.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: 'string' }, brand: { type: 'string' }, from: { type: 'string' } }, strict: true })
  if (values.only !== undefined && values.only !== 'ga4' && values.only !== 'gsc') throw new Error('--only acceptă ga4 sau gsc.')
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const outcomes = await collectGoogle({ db }, values.only as GoogleSource | undefined, { brandId: values.brand, from: values.from })

  let failed = 0
  for (const o of outcomes) {
    if (o.status === 'not_connected') {
      console.log(`${o.source} ${o.connection_id}: neconectat (${o.reason})`)
      continue
    }
    console.log(
      `${o.source} ${o.connection_id} brand ${o.brand_id} ${o.period.start}..${o.period.end}: ${o.status}, ${o.rows_written} rânduri, ${o.api_calls} apeluri` +
        (o.errors.length ? `, ${o.errors.length} note în sync_runs.errors` : ''),
    )
    // Motivele, ca în rezumatul SEOmonitor: codul și mesajul fiecărei erori, apoi seturile cu zile fără rânduri.
    for (const e of o.errors) console.log(`  ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    for (const [dataset, c] of Object.entries(o.coverage)) {
      if (c.coverage < 1) console.log(`  acoperire ${dataset}: ${c.covered_days} din ${c.expected_days}`)
    }
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log(values.brand ? `Nicio conexiune ${values.only ?? 'ga4/gsc'} activă pe brandul ${values.brand}.` : 'Nicio conexiune ga4/gsc activă.')
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
