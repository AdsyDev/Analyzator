// Colectarea zilnică din destinația Postgres Airbyte în paid_daily. Rulare: npm run collect:airbyte
// Reimportul istoricului (cel mult 730 de zile în urmă), pentru toate site-urile sau unul:
//   npm run collect:airbyte -- --from 2026-01-01 [--brand <uuid>]
// Conexiunile: `airbyte_postgres` per client (connection string-ul read-only din Vault) și `airbyte` per site.
// Contract: docs/contracts/airbyte.md.

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { collectAirbyte } from './collect-core.ts'
import { resolveHost, withReadOnlySession } from './session.ts'

async function main(): Promise<void> {
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const { values } = parseArgs({ options: { from: { type: 'string' }, brand: { type: 'string' } }, strict: true })
  const outcomes = await collectAirbyte({ db, resolve: resolveHost, connect: withReadOnlySession, from: values.from || undefined, brandId: values.brand || undefined })
  let failed = 0
  for (const o of outcomes) {
    const detail = o.status === 'not_connected' ? `not_connected (${o.reason ?? ''})` : `${o.status}, ${o.rows_written} rânduri, ${o.errors.length} erori/note`
    console.log(`brand ${o.brand_id ?? '—'} · airbyte ${o.platform ?? '?'}: ${detail}`)
    for (const e of o.errors.filter((x) => !x.code.startsWith('parser_'))) console.log(`  ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    if (o.status === 'failed') failed++
  }
  if (outcomes.length === 0) console.log('Nicio conexiune Airbyte activă.')
  if (failed) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`Eroare: ${(e as Error).message}`)
  process.exitCode = 1
})
