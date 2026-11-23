// Maparea conturilor Airbyte pe site-uri, din worker. Contract: docs/contracts/airbyte.md („Maparea în bloc”).
//   npm run map:airbyte              → doar propunerea (nimic scris)
//   npm run map:airbyte -- --apply   → leagă conturile cu un singur site propus
// În GitHub: Actions → airbyte-map → Run workflow (apply bifat sau nu).

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { mapAirbyte, type MapAccount } from './map-core.ts'
import { resolveHost, withReadOnlySession } from './session.ts'

const line = (a: MapAccount) => `${a.label} · ${a.name} · ${a.id}${a.last_date ? ` · date până la ${a.last_date}` : ' · fără rapoarte citite'}`

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } }, strict: true })
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const reports = await mapAirbyte({ db, resolve: resolveHost, connect: withReadOnlySession, apply: values.apply })
  if (reports.length === 0) console.log('Niciun client cu destinația Airbyte configurată.')
  let failed = 0
  for (const r of reports) {
    console.log(`\n=== ${r.tenant_name} (${values.apply ? 'APLICARE' : 'doar propunere'})`)
    if (r.error) {
      console.log(`EROARE: ${r.error}`)
      failed++
      continue
    }
    const site = (id: string) => r.sites.find((s) => s.id === id)?.name ?? id
    console.log(`Site-uri: ${r.sites.map((s) => `${s.name}${s.status === 'active' ? '' : ` (${s.status})`}`).join(', ')}`)
    if (r.truncated) console.log('Atenție: inspecția nu a citit toate tabelele; pot lipsi conturi.')
    console.log(`\n-- Propuse (${r.proposed.length})`)
    for (const p of [...r.proposed].sort((a, b) => site(a.brand_id).localeCompare(site(b.brand_id), 'ro'))) {
      const state = values.apply ? (p.linked ? ' → LEGAT' : ` → NELEGAT: ${p.error}`) : ''
      if (values.apply && !p.linked) failed++
      console.log(`${site(p.brand_id)} ← ${line(p.account)}${state}`)
    }
    console.log(`\n-- Ambigue, nelegate (${r.ambiguous.length})`)
    for (const a of r.ambiguous) console.log(`${line(a.account)} → ${a.candidates.map(site).join(' sau ')}`)
    console.log(`\n-- Deja legate (${r.already.length})`)
    for (const a of r.already) console.log(`${site(a.brand_id)} ← ${line(a.account)}`)
    console.log(`\n-- Fără potrivire, nelegate (${r.unmatched.length})`)
    for (const a of r.unmatched) console.log(line(a))
  }
  if (failed) process.exitCode = 1
}

main().catch((e: unknown) => {
  console.error(`Eroare: ${(e as Error).message}`)
  process.exitCode = 1
})
