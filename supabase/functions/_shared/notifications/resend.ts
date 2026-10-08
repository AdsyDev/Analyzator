// Trimiterea e-mailurilor prin Resend (https://resend.com/docs/api-reference/emails/send-email).
// POST https://api.resend.com/emails · Authorization: Bearer <cheie> · Idempotency-Key (max 256, valabil 24 h) ·
// `to` acceptă listă (maximum 50) · răspuns de succes: { id }.
// Documentația citită 2026-10-08 nu descrie codurile de eroare: 429 și 5xx se tratează ca tranzitorii, restul 4xx definitive.
// Cheia nu se loghează și nu apare în mesajele de eroare.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; retryable: boolean; status: number | null; message: string }

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'
export const MAX_RECIPIENTS = 50

export async function sendEmail(
  fetchFn: FetchLike,
  apiKey: string,
  email: { from: string; to: string[]; subject: string; text: string; idempotencyKey: string },
): Promise<SendResult> {
  if (email.to.length === 0) return { ok: false, retryable: false, status: null, message: 'fără destinatari' }
  if (email.to.length > MAX_RECIPIENTS) return { ok: false, retryable: false, status: null, message: `peste ${MAX_RECIPIENTS} de destinatari` }
  if (email.idempotencyKey.length > 256) return { ok: false, retryable: false, status: null, message: 'Idempotency-Key peste 256 de caractere' }

  let res: Response
  try {
    res = await fetchFn(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': email.idempotencyKey },
      body: JSON.stringify({ from: email.from, to: email.to, subject: email.subject, text: email.text }),
    })
  } catch (err) {
    return { ok: false, retryable: true, status: null, message: `eroare de rețea: ${(err as Error).name}` }
  }
  const body = await res.text()
  if (res.ok) {
    try {
      const id = (JSON.parse(body) as { id?: unknown }).id
      return { ok: true, id: typeof id === 'string' ? id : null }
    } catch {
      return { ok: true, id: null }
    }
  }
  // Fără corpul răspunsului: poate conține adrese sau text.
  return { ok: false, retryable: res.status === 429 || res.status >= 500, status: res.status, message: `Resend a răspuns ${res.status}` }
}
