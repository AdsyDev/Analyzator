// Trimite notificările din coadă (farmacovigilență) cu service role. Rulează din cron / GitHub Actions sau manual.
//   npm run send:notifications
// Mediu: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PV_FROM_EMAIL, APP_BASE_URL (opțional).
// Fără RESEND_API_KEY nu se trimite nimic și nu se modifică nimic: notificările rămân `pending`.
import { restImportDb } from '../supabase/functions/_shared/csv-import/rest-db.ts'
import { dispatchPvNotifications } from '../supabase/functions/_shared/notifications/queue.ts'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Eroare: lipsește ${name}.`)
    process.exit(1)
  }
  return v
}

const db = restImportDb({ url: required('SUPABASE_URL'), serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY') })
const summary = await dispatchPvNotifications({
  db,
  fetch: (url, init) => fetch(url, init),
  env: { RESEND_API_KEY: process.env.RESEND_API_KEY, PV_FROM_EMAIL: process.env.PV_FROM_EMAIL, APP_BASE_URL: process.env.APP_BASE_URL },
})
console.log(JSON.stringify(summary))
if (summary.state === 'secret_missing') console.log('RESEND_API_KEY lipsește: notificările rămân în coadă (pending).')
if (summary.state === 'sender_missing') console.log('PV_FROM_EMAIL lipsește: notificările rămân în coadă (pending).')
if (summary.failed > 0) process.exitCode = 1
