// Alertele de eșec ale refreshului: coadă `ops_notifications`, același mecanism ca la farmacovigilență
// (pending care nu se pierde fără secret sau contacte; reîncercări; failed vizibil), pe tabele proprii.
// Destinatari: `alert_contacts` active ale tenantului (liste interne, separate de pv_contacts).
// Reutilizează sendEmail (supabase/functions/_shared/notifications/resend.ts), neschimbat.

import { sendEmail, type FetchLike } from '../../supabase/functions/_shared/notifications/resend.ts'
import type { Db, Row } from '../shared/supabase-rest.ts'
import { assertUuid } from '../shared/supabase-rest.ts'
import type { SyncRunError } from '../shared/sync-runs.ts'

const MAX_ERRORS_SHOWN = 5
const MAX_MESSAGE = 200

export type FailedRun = {
  tenant_id: string
  brand_id: string | null
  sync_run_id: string
  source: string
  brand_name: string | null
  errors: SyncRunError[]
}

/** Textul alertei: sursă, brand și coduri de eroare; nu conține tokenuri sau date de client. */
export function failureMessage(run: FailedRun, appBaseUrl?: string): { subject: string; body: string } {
  const lines = run.errors.slice(0, MAX_ERRORS_SHOWN).map((e) => `- ${e.code}${e.dimension ? ` (${e.dimension})` : ''}: ${String(e.message).slice(0, MAX_MESSAGE)}`)
  return {
    subject: `[Analyzator] Refresh eșuat: ${run.source}${run.brand_name ? ` · ${run.brand_name}` : ''}`,
    body: [
      `Sincronizarea sursei ${run.source}${run.brand_name ? ` pentru brandul ${run.brand_name}` : ''} a eșuat.`,
      '',
      `Rulare: ${run.sync_run_id}`,
      run.errors.length ? `Erori (${run.errors.length}):` : 'Fără detalii de eroare.',
      ...lines,
      run.errors.length > MAX_ERRORS_SHOWN ? `… și încă ${run.errors.length - MAX_ERRORS_SHOWN}` : '',
      '',
      'Ce faci: runbook, secțiunea „Refresh săptămânal” → „O sursă a eșuat”. Celelalte surse au continuat.',
      appBaseUrl ? `Stare surse: ${appBaseUrl.replace(/\/+$/, '')}/administrare/surse` : '',
    ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n'),
  }
}

/** O alertă per sync_run eșuat; idempotent (unique sync_run_id + kind). */
export async function enqueueFailure(db: Db, run: FailedRun, appBaseUrl?: string): Promise<boolean> {
  assertUuid(run.tenant_id, 'tenant_id')
  assertUuid(run.sync_run_id, 'sync_run_id')
  if (run.brand_id) assertUuid(run.brand_id, 'brand_id')
  const m = failureMessage(run, appBaseUrl)
  const rows = await db.upsert<Row>(
    'ops_notifications',
    [{ tenant_id: run.tenant_id, brand_id: run.brand_id, sync_run_id: run.sync_run_id, kind: 'refresh_failed', source: run.source, subject: m.subject, body: m.body }],
    ['sync_run_id', 'kind'],
  )
  const row = rows[0]
  if (!row || row.tenant_id !== run.tenant_id) throw new Error('ops_notifications: rândul întors nu corespunde tenantului')
  return true
}

export type OpsDispatchEnv = { RESEND_API_KEY?: string; OPS_FROM_EMAIL?: string }
export type OpsDispatchSummary = {
  state: 'ok' | 'secret_missing' | 'sender_missing'
  pending_before: number
  sent: number
  retrying: number
  failed: number
  waiting_for_contacts: number
}

type Pending = { id: string; tenant_id: string; brand_id: string | null; subject: string; body: string; attempts: number; last_error: string | null }

export async function dispatchOpsNotifications(deps: { db: Db; fetch: FetchLike; env: OpsDispatchEnv; now?: () => Date; maxAttempts?: number; batchLimit?: number }): Promise<OpsDispatchSummary> {
  const { db, env } = deps
  const maxAttempts = deps.maxAttempts ?? 5
  const pending = await db.select<Pending>(
    'ops_notifications',
    `select=id,tenant_id,brand_id,subject,body,attempts,last_error&status=eq.pending&order=created_at.asc&limit=${deps.batchLimit ?? 20}`,
  )
  const summary: OpsDispatchSummary = { state: 'ok', pending_before: pending.length, sent: 0, retrying: 0, failed: 0, waiting_for_contacts: 0 }
  if (!env.RESEND_API_KEY) return { ...summary, state: 'secret_missing' }
  if (!env.OPS_FROM_EMAIL) return { ...summary, state: 'sender_missing' }

  for (const n of pending) {
    assertUuid(n.id, 'notification id')
    assertUuid(n.tenant_id, 'tenant_id')
    const attempt = n.attempts + 1
    const claimed = await db.update<Row>('ops_notifications', `id=eq.${n.id}&tenant_id=eq.${n.tenant_id}&status=eq.pending`, { status: 'sending', attempts: attempt })
    if (claimed.length !== 1) continue
    const release = (patch: Row) => db.update('ops_notifications', `id=eq.${n.id}&tenant_id=eq.${n.tenant_id}`, patch)
    try {
      const contacts = await db.select<{ email: string }>('alert_contacts', `select=email&tenant_id=eq.${n.tenant_id}&active=eq.true&order=email.asc`)
      const recipients = [...new Set(contacts.map((c) => c.email.toLowerCase()))]
      if (recipients.length === 0) {
        await release({ status: 'pending', attempts: n.attempts, last_error: 'no_contacts' })
        summary.waiting_for_contacts++
        continue
      }
      const r = await sendEmail(deps.fetch, env.RESEND_API_KEY, {
        from: env.OPS_FROM_EMAIL, to: recipients, subject: n.subject, text: n.body, idempotencyKey: `ops-notification-${n.id}`,
      })
      if (r.ok) {
        await release({ status: 'sent', sent_at: (deps.now?.() ?? new Date()).toISOString(), recipients, provider_message_id: r.id, last_error: null })
        summary.sent++
      } else {
        const final = !r.retryable || attempt >= maxAttempts
        await release({ status: final ? 'failed' : 'pending', last_error: r.message.slice(0, 500) })
        if (final) summary.failed++
        else summary.retrying++
      }
    } catch (err) {
      const final = attempt >= maxAttempts
      await release({ status: final ? 'failed' : 'pending', last_error: `eroare internă: ${(err as Error).message}`.slice(0, 500) }).catch(() => undefined)
      if (final) summary.failed++
      else summary.retrying++
    }
  }
  return summary
}
