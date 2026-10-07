// Configurarea conectorului Clarity din mediu. Tokenurile nu se loghează.

export const CLARITY_ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'
export const CLARITY_DAILY_BUDGET = 10

export type ClarityProject = { tenant_slug: string; brand_slug: string; token: string }

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function parseClarityProjects(raw: string | undefined): ClarityProject[] {
  if (!raw) throw new Error('Lipsește CLARITY_PROJECTS (JSON: [{"tenant_slug","brand_slug","token"}]).')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('CLARITY_PROJECTS nu este JSON valid.')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('CLARITY_PROJECTS trebuie să fie o listă nevidă.')

  const seen = new Set<string>()
  return parsed.map((item, i) => {
    const p = (item ?? {}) as Partial<ClarityProject>
    if (typeof p.tenant_slug !== 'string' || !SLUG.test(p.tenant_slug)) {
      throw new Error(`Proiectul #${i}: tenant_slug lipsă sau invalid.`)
    }
    if (typeof p.brand_slug !== 'string' || !SLUG.test(p.brand_slug)) {
      throw new Error(`Proiectul #${i}: brand_slug lipsă sau invalid.`)
    }
    if (typeof p.token !== 'string' || p.token.trim() === '') {
      throw new Error(`Proiectul ${p.tenant_slug}/${p.brand_slug}: token lipsă.`)
    }
    const key = `${p.tenant_slug}/${p.brand_slug}`
    if (seen.has(key)) throw new Error(`Proiect duplicat: ${key}`)
    seen.add(key)
    return { tenant_slug: p.tenant_slug, brand_slug: p.brand_slug, token: p.token.trim() }
  })
}
