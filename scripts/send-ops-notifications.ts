// Trimite alertele operaționale din coadă (eșecuri de refresh). Folosit pentru reluare; refresh-ul le trimite deja la final.
//   npm run send:ops-notifications
// Fără RESEND_API_KEY / OPS_FROM_EMAIL nu se trimite nimic: alertele rămân `pending`.
import { SupabaseRest, supabaseConfigFromEnv } from '../connectors/shared/supabase-rest.ts'
import { dispatchOpsNotifications } from '../connectors/orchestrator/ops-notifications.ts'

const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
const summary = await dispatchOpsNotifications({
  db, fetch: (url, init) => fetch(url, init),
  env: { RESEND_API_KEY: process.env.RESEND_API_KEY, OPS_FROM_EMAIL: process.env.OPS_FROM_EMAIL ?? process.env.PV_FROM_EMAIL },
})
console.log(JSON.stringify(summary))
if (summary.failed > 0) process.exitCode = 1
