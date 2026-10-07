// Conectorul zilnic Clarity. Rulare: npm run collect:clarity
// Configurarea vine din source_connections (provider = 'clarity'); tokenurile din Vault.
//
// Parserul urmează forma din documentația Microsoft (neconfirmată pe un payload real): vezi
// docs/contracts/clarity.md. Ziua stocată = ziua anterioară rulării în Europe/Bucharest.

import { loadActiveConnections } from '../shared/connections.ts'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectConnection } from './collect-core.ts'
import { clarityParser } from './parse.ts'
import { clarityWriter } from './write.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const parser = clarityParser
  const writer = clarityWriter(db)
  const { connections, skipped } = await loadActiveConnections(db, 'clarity')
  for (const s of skipped) console.log(`sărit ${s.id}: ${s.reason}`)

  let failed = 0
  for (const connection of connections) {
    try {
      const o = await collectConnection({ db, parser, writer }, connection)
      console.log(
        `${connection.id} (${connection.external_account_id}) ${o.date}: ${o.status}, ${o.rows_written} rânduri, ` +
          `${o.attempt_count} apeluri (înainte azi: ${o.calls_before_run})` +
          (o.not_collected.length ? `, necolectat: ${o.not_collected.join(', ')}` : ''),
      )
      if (o.status === 'failed') failed++
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
