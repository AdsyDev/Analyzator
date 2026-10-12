/**
 * Verifică în browser fișierul JSON al unui service account Google înainte de a-l trimite funcției server
 * `source-credentials`. Nu păstrează și nu întoarce cheia privată: doar adresa contului (pentru etichetă)
 * și textul compact care pleacă spre server.
 */
export type ServiceAccountCheck =
  | { ok: true; clientEmail: string; projectId: string | null; compact: string }
  | { ok: false; message: string }

const MAX_LENGTH = 8192 // limita din set_source_token

export function checkServiceAccount(text: string): ServiceAccountCheck {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, message: 'Fișierul nu e JSON valid. Folosește fișierul descărcat din Google Cloud (Keys → Add key → JSON).' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, message: 'Fișierul nu are forma unei chei de service account.' }
  const o = data as Record<string, unknown>
  if (o.type !== 'service_account') return { ok: false, message: 'Fișierul nu e o cheie de service account (lipsește "type": "service_account"). Un fișier OAuth client sau API key nu merge aici.' }
  if (typeof o.client_email !== 'string' || !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(o.client_email)) return { ok: false, message: 'Lipsește adresa service account-ului (client_email).' }
  if (typeof o.private_key !== 'string' || !o.private_key.includes('PRIVATE KEY')) return { ok: false, message: 'Lipsește cheia privată (private_key). Descarcă din nou cheia JSON.' }
  const compact = JSON.stringify(o)
  if (compact.length > MAX_LENGTH) return { ok: false, message: 'Fișierul e prea mare pentru o cheie de service account.' }
  return { ok: true, clientEmail: o.client_email, projectId: typeof o.project_id === 'string' ? o.project_id : null, compact }
}
