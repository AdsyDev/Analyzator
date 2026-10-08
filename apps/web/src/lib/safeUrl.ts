/**
 * URL-urile din surse externe (citări AI, pagini) se validează înainte să devină linkuri (spec cap. 28):
 * doar http(s), fără credențiale în adresă. Orice altceva (`javascript:`, `data:`, adrese relative) nu devine link.
 */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  return u.href
}
