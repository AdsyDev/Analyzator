/**
 * Identificatorul scurt din URL-uri și din baza de date (`tenants.slug`, `brands.slug`): litere mici fără
 * diacritice, cifre și cratime, ca în constrângerea `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Domeniul unui site, cum îl salvăm: litere mici, fără schemă, `www.`, cale, query, port sau `/` final.
 * Întoarce `null` pentru text gol și `undefined` pentru un text care nu arată a domeniu.
 */
export function normalizeDomain(input: string): string | null | undefined {
  const raw = input.trim().toLowerCase()
  if (raw === '') return null
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]*@/, '')
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
  return /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) ? host : undefined
}
