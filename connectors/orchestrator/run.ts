// Refresh săptămânal. Rulare: npm run refresh:weekly [-- --only seomonitor,ga4,gsc]
//
// Rulează conectorii activi (flag-uri CONNECTOR_*_ENABLED) în ordine: seomonitor → ga4 → gsc. Eșecul unei surse nu le oprește pe
// celelalte. La final trimite alertele (eșecuri și rulări parțiale) din coadă (dacă RESEND_API_KEY și OPS_FROM_EMAIL există; altfel rămân pending).
// Cod de ieșire 1 dacă o sursă a eșuat sau a aruncat o excepție; rulările parțiale sunt raportate ca avertismente (cod 0).

import { parseArgs } from 'node:util'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { dispatchOpsNotifications } from './ops-notifications.ts'
import { REFRESH_ORDER, runRefresh, type RefreshSource } from './refresh.ts'
import { defaultRunners } from './runners.ts'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { only: { type: 'string' } }, strict: true })
  let only: RefreshSource[] | undefined
  if (values.only !== undefined) {
    const parts = values.only.split(',').map((s) => s.trim()).filter(Boolean)
    const bad = parts.filter((p) => !(REFRESH_ORDER as readonly string[]).includes(p))
    if (bad.length || parts.length === 0) throw new Error(`--only acceptă ${REFRESH_ORDER.join(', ')} (primit: ${values.only})`)
    only = parts as RefreshSource[]
  }

  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const report = await runRefresh({ db, env: process.env, runners: defaultRunners({ db }), only, appBaseUrl: process.env.APP_BASE_URL })

  for (const s of report.sources) {
    if (s.state === 'disabled') {
      console.log(`${s.source}: dezactivat (flag-ul conectorului nu e „true” sau sursa nu e cerută)`)
      continue
    }
    console.log(`${s.source}: ${s.state === 'exception' ? 'EXCEPȚIE' : 'rulat'} · reușite ${s.counts.succeeded} · parțiale ${s.counts.partial} · eșuate ${s.counts.failed} · neconectate ${s.counts.not_connected}`)
    if (s.exception) console.log(`  excepție: ${s.exception}`)
    for (const o of s.outcomes) {
      if (o.status === 'partial') console.log(`::warning::${s.source} brand ${o.brand_id}: rulare parțială (${o.errors.length} note în sync_runs.errors)`)
      if (o.status === 'failed') console.log(`::error::${s.source} brand ${o.brand_id}: rulare eșuată (sync_run ${o.sync_run_id})`)
    }
  }
  console.log(`alerte puse în coadă: ${report.notifications_enqueued}`)

  const ops = await dispatchOpsNotifications({
    db, fetch: (url, init) => fetch(url, init),
    env: { RESEND_API_KEY: process.env.RESEND_API_KEY, OPS_FROM_EMAIL: process.env.OPS_FROM_EMAIL ?? process.env.PV_FROM_EMAIL },
  })
  console.log(`alerte trimise: ${JSON.stringify(ops)}`)

  if (report.failed_runs > 0 || report.exceptions > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
