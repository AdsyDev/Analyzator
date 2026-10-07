// Conectorul zilnic Clarity. Rulare: npm run collect:clarity
// Configurarea vine din source_connections (provider = 'clarity'); tokenurile din Vault.
//
// STATUS: parserul și scrierea în clarity_daily nu sunt implementate (așteaptă proba și migrația din
// Promptul 4). Până atunci scriptul se oprește ÎNAINTE de a citi tokenuri sau de a apela Clarity.

import { loadActiveConnections } from '../shared/connections.ts'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectConnection, type ClarityParser, type ClarityWriter } from './collect-core.ts'

// Se înlocuiesc după probă cu implementările reale (interfețele din collect-core.ts).
const parser: ClarityParser<never> | null = null
const writer: ClarityWriter<never> | null = null

async function main(): Promise<void> {
  if (!parser || !writer) {
    throw new Error('Parserul și scrierea în clarity_daily nu sunt implementate încă (după probă). Nu apelez Clarity.')
  }
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
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
