// Conectorul săptămânal SEOmonitor. Rulare: npm run collect:seomonitor
// Conexiunile: source_connections cu provider = 'seomonitor' (la nivel de client, external_account_id = company_id);
// tokenurile din Vault. Maparea grupurilor → branduri: seomonitor_group_mappings. Contract: docs/contracts/seomonitor.md.

import { loadActiveConnections } from '../shared/connections.ts'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectSeomonitorConnection } from './collect-core.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const { connections, skipped } = await loadActiveConnections(db, 'seomonitor', { requireBrand: false })
  for (const s of skipped) console.log(`sărit ${s.id}: ${s.reason}`)

  let failed = 0
  for (const connection of connections) {
    try {
      const o = await collectSeomonitorConnection({ db }, connection)
      console.log(`${connection.id} (company ${connection.external_account_id}): acces ${o.access}, ${o.calls} apeluri, ${o.queue.length} grupuri în coada de verificare`)
      for (const note of o.notes) console.log(`  notă: ${note}`)
      for (const r of o.runs) {
        console.log(`  brand ${r.brand_id}: ${r.status}, ${r.rows_written} rânduri, ${r.errors.length} erori/note`)
        if (r.status === 'failed') failed++
      }
    } catch (err) {
      failed++
      console.error(`${connection.id}: ${(err as Error).message}`)
    }
  }
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
