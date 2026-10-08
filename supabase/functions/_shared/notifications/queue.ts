// Mecanismul de coadă pentru notificări (farmacovigilență acum; eșecuri de refresh în B8).
// Un rând `pending` nu se pierde niciodată: fără secret sau fără destinatari rămâne pending, la eșec tranzitoriu rămâne
// pending cu eroarea notată, iar după prea multe încercări devine `failed` (vizibil, reluabil manual).
// Fără dependențe: rulează în Deno și Node.

import { sendEmail, type FetchLike } from './resend.ts'

export type Row = Record<string, unknown>
export interface QueueDb {
  select<T = Row>(table: string, query: string): Promise<T[]>
  insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]>
  update<T = Row>(table: string, query: string, patch: Row): Promise<T[]>
}

export type NotifyEnv = { RESEND_API_KEY?: string; PV_FROM_EMAIL?: string; APP_BASE_URL?: string }

export type DispatchDeps = {
  db: QueueDb
  fetch: FetchLike
  env: NotifyEnv
  now?: () => Date
  maxAttempts?: number
  batchLimit?: number
  /** Doar notificările acestor tenanți (apelul de la un utilizator). Gol sau lipsă = toate (worker). */
  tenantIds?: string[]
}

export type DispatchSummary = {
  state: 'ok' | 'secret_missing' | 'sender_missing'
  pending_before: number
  sent: number
  retrying: number
  failed: number
  waiting_for_contacts: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXCERPT = 500

type Notification = { id: string; tenant_id: string; brand_id: string; flag_id: string; attempts: number; last_error: string | null }
type Flag = { id: string; entity_type: string; entity_ref: string; link: string | null; text_snapshot: string; snapshot_source: string; flagged_by: string; flagged_at: string }

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT ? flat : `${flat.slice(0, EXCERPT)}… (text trunchiat; textul complet e în Analyzator)`
}

const ENTITY: Record<string, string> = { mention: 'mențiune', review: 'review', ai_answer: 'răspuns AI' }

export function pvEmail(brandName: string, flag: Flag, baseUrl: string | undefined): { subject: string; text: string } {
  const when = new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }).format(new Date(flag.flagged_at))
  return {
    subject: `[Farmacovigilență] Marcaj nou: ${brandName}`,
    text: [
      `Un utilizator a marcat o ${ENTITY[flag.entity_type] ?? flag.entity_type} pentru farmacovigilență.`,
      '',
      `Brand: ${brandName}`,
      `Marcat la: ${when} (Europe/Bucharest)`,
      `Marcat de (ID utilizator): ${flag.flagged_by}`,
      `Tip: ${ENTITY[flag.entity_type] ?? flag.entity_type} (${flag.entity_ref})`,
      `Link: ${flag.link ?? '(fără link)'}`,
      `Sursa textului: ${flag.snapshot_source === 'entity' ? 'preluat din înregistrare' : 'furnizat de utilizator'}`,
      '',
      'Fragment din text (snapshot la momentul marcării):',
      excerpt(flag.text_snapshot),
      '',
      baseUrl ? `Jurnal: ${baseUrl.replace(/\/+$/, '')}/administrare/farmacovigilenta` : 'Jurnalul complet este în Analyzator (Administrare).',
      '',
      'Analyzator nu stabilește dacă este o reacție adversă și nu înlocuiește procedura clientului. Transmiterea urmează procedura de farmacovigilență (de regulă în cel mult o zi lucrătoare).',
    ].join('\n'),
  }
}

export async function dispatchPvNotifications(deps: DispatchDeps): Promise<DispatchSummary> {
  const { db, env } = deps
  const maxAttempts = deps.maxAttempts ?? 5
  const limit = deps.batchLimit ?? 20
  const tenants = (deps.tenantIds ?? []).filter((t) => UUID.test(t))
  if ((deps.tenantIds ?? []).length !== tenants.length) throw new Error('tenantIds conține un ID invalid')

  // Un apel de utilizator are tenanți: filtrăm în interogare (nu după limită), ca alți tenanți să nu epuizeze lotul.
  if (deps.tenantIds && tenants.length === 0) {
    return { state: 'ok', pending_before: 0, sent: 0, retrying: 0, failed: 0, waiting_for_contacts: 0 }
  }
  const tenantFilter = deps.tenantIds ? `&tenant_id=in.(${tenants.join(',')})` : ''
  const pending = await db.select<Notification>(
    'pv_notifications',
    `select=id,tenant_id,brand_id,flag_id,attempts,last_error&status=eq.pending${tenantFilter}&order=created_at.asc&limit=${limit}`,
  )
  const summary: DispatchSummary = { state: 'ok', pending_before: pending.length, sent: 0, retrying: 0, failed: 0, waiting_for_contacts: 0 }

  // Fără secret sau expeditor: nimic nu se încearcă, nimic nu se modifică; notificările rămân pending.
  if (!env.RESEND_API_KEY) return { ...summary, state: 'secret_missing' }
  if (!env.PV_FROM_EMAIL) return { ...summary, state: 'sender_missing' }

  for (const n of pending) {
    if (![n.id, n.tenant_id, n.brand_id, n.flag_id].every((v) => UUID.test(v))) throw new Error('notificare cu ID invalid; opresc')

    // Revendicare atomică: doar un dispatcher câștigă.
    const attempt = n.attempts + 1
    const claimed = await db.update<{ id: string }>(
      'pv_notifications', `id=eq.${n.id}&tenant_id=eq.${n.tenant_id}&brand_id=eq.${n.brand_id}&status=eq.pending`,
      { status: 'sending', attempts: attempt },
    )
    if (claimed.length !== 1) continue

    const scope = `tenant_id=eq.${n.tenant_id}&brand_id=eq.${n.brand_id}`
    const release = (patch: Row) => db.update('pv_notifications', `id=eq.${n.id}&${scope}`, patch)
    const event = (event_type: string, note: string | null) =>
      db.insert('pv_flag_events', { tenant_id: n.tenant_id, brand_id: n.brand_id, flag_id: n.flag_id, event_type, note })

    try {
      const flags = await db.select<Flag>(
        'pv_flags', `select=id,entity_type,entity_ref,link,text_snapshot,snapshot_source,flagged_by,flagged_at&id=eq.${n.flag_id}&${scope}`,
      )
      const flag = flags[0]
      if (!flag) throw new Error('marcaj inexistent pentru notificare')
      const brands = await db.select<{ name: string }>('brands', `select=name&id=eq.${n.brand_id}&tenant_id=eq.${n.tenant_id}`)
      const contacts = await db.select<{ email: string }>('pv_contacts', `select=email&tenant_id=eq.${n.tenant_id}&active=eq.true&order=email.asc`)
      const recipients = [...new Set(contacts.map((c) => c.email.toLowerCase()))]

      if (recipients.length === 0) {
        // Nu se pierde: rămâne pending (fără a număra încercarea), cu motivul vizibil; evenimentul se scrie o singură dată.
        await release({ status: 'pending', attempts: n.attempts, last_error: 'no_contacts' })
        if (n.last_error !== 'no_contacts') await event('no_contacts', 'Nicio persoană de contact activă pentru farmacovigilență')
        summary.waiting_for_contacts++
        continue
      }

      const mail = pvEmail(brands[0]?.name ?? 'brand necunoscut', flag, env.APP_BASE_URL)
      const result = await sendEmail(deps.fetch, env.RESEND_API_KEY, {
        from: env.PV_FROM_EMAIL, to: recipients, subject: mail.subject, text: mail.text, idempotencyKey: `pv-notification-${n.id}`,
      })

      if (result.ok) {
        await release({
          status: 'sent', sent_at: (deps.now?.() ?? new Date()).toISOString(), recipients, provider_message_id: result.id, last_error: null,
        })
        await event('notification_sent', `Trimis către ${recipients.length} destinatari`)
        summary.sent++
      } else {
        const final = !result.retryable || attempt >= maxAttempts
        await release({ status: final ? 'failed' : 'pending', last_error: result.message.slice(0, 500) })
        await event('notification_failed', `${result.message} (încercarea ${attempt}/${maxAttempts}${final ? ', definitiv' : ''})`)
        if (final) summary.failed++
        else summary.retrying++
      }
    } catch (err) {
      // Orice excepție după revendicare: notificarea revine în coadă, nu rămâne blocată în `sending`.
      const final = attempt >= maxAttempts
      await release({ status: final ? 'failed' : 'pending', last_error: `eroare internă: ${(err as Error).message}`.slice(0, 500) }).catch(() => undefined)
      if (final) summary.failed++
      else summary.retrying++
    }
  }
  return summary
}
