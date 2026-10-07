// Maparea tenant_slug / brand_slug → ID, la începutul rulării.
// Orice slug negăsit (sau un brand care există doar în alt tenant) oprește rularea; nu se scrie nimic.

import { assertSlug, type Db } from './supabase-rest.ts'

export type BrandRef = { tenant_slug: string; brand_slug: string }
export type ResolvedBrand = { tenant_slug: string; brand_slug: string; tenant_id: string; brand_id: string }

export class SlugResolutionError extends Error {
  readonly missing: string[]
  constructor(missing: string[]) {
    super(`Sluguri negăsite: ${missing.join(', ')}. Rularea se oprește; nu se scrie în niciun brand.`)
    this.name = 'SlugResolutionError'
    this.missing = missing
  }
}

type TenantRow = { id: string; slug: string; status: string }
type BrandRow = { id: string; slug: string; tenant_id: string; status: string }

export async function resolveBrands<T extends BrandRef>(db: Db, refs: T[]): Promise<Array<T & ResolvedBrand>> {
  for (const ref of refs) {
    assertSlug(ref.tenant_slug, 'tenant_slug')
    assertSlug(ref.brand_slug, 'brand_slug')
  }

  const tenantSlugs = [...new Set(refs.map((r) => r.tenant_slug))]
  const tenants = await db.select<TenantRow>('tenants', `select=id,slug,status&slug=in.(${tenantSlugs.join(',')})`)
  const tenantBySlug = new Map(tenants.filter((t) => t.status === 'active').map((t) => [t.slug, t]))

  const missing: string[] = []
  for (const slug of tenantSlugs) {
    if (!tenantBySlug.has(slug)) missing.push(`tenant "${slug}" (inexistent sau arhivat)`)
  }
  if (missing.length) throw new SlugResolutionError(missing)

  const brandByKey = new Map<string, BrandRow>()
  for (const [tenantSlug, tenant] of tenantBySlug) {
    const brandSlugs = [...new Set(refs.filter((r) => r.tenant_slug === tenantSlug).map((r) => r.brand_slug))]
    // Filtrul pe tenant_id e explicit: un brand cu același slug din alt tenant nu e găsit.
    const brands = await db.select<BrandRow>(
      'brands',
      `select=id,slug,tenant_id,status&tenant_id=eq.${tenant.id}&slug=in.(${brandSlugs.join(',')})`,
    )
    for (const brand of brands) {
      if (brand.tenant_id !== tenant.id) {
        throw new Error(`Brandul ${brand.slug} întors pentru alt tenant decât ${tenantSlug}; opresc rularea.`)
      }
      if (brand.status === 'active') brandByKey.set(`${tenantSlug}/${brand.slug}`, brand)
    }
  }

  for (const ref of refs) {
    if (!brandByKey.has(`${ref.tenant_slug}/${ref.brand_slug}`)) {
      missing.push(`brand "${ref.brand_slug}" în tenantul "${ref.tenant_slug}" (inexistent sau arhivat)`)
    }
  }
  if (missing.length) throw new SlugResolutionError(missing)

  return refs.map((ref) => {
    const tenant = tenantBySlug.get(ref.tenant_slug)!
    const brand = brandByKey.get(`${ref.tenant_slug}/${ref.brand_slug}`)!
    return { ...ref, tenant_id: tenant.id, brand_id: brand.id }
  })
}
