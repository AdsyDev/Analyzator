import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import { failed, ready, type Client, type ClientsProvider, type Role } from '../../contracts'
import { normalizeDomain } from '../../lib/slug'

interface Options {
  now: () => Date
  getRole: () => Role
  /** Conexiunile fictive per spațiu, ca în pagina Surse. */
  connections: (brandId: string) => number
}

/**
 * Clienți și site-uri cu date FICTIVE, doar pentru previzualizare. Clientul sau site-ul nou rămâne în memorie
 * cât ține sesiunea (nu apare în selectorul de brand); nimic nu pleacă spre un server.
 */
export function createClientsFixtures({ now, getRole, connections }: Options): ClientsProvider {
  const created = (daysAgo: number) => new Date(now().getTime() - daysAgo * 86_400_000).toISOString()
  const clients: Client[] = [
    {
      id: brandsFile.tenant_id,
      slug: 'stada-romania',
      name: 'STADA România',
      status: 'active',
      created_at: created(210),
      spaces: brandsFile.brands.map((b, i) => ({
        id: b.id,
        tenant_id: brandsFile.tenant_id,
        slug: b.id.replace(/^brand-/, ''),
        name: b.name,
        domain: b.domain,
        status: 'active' as const,
        created_at: created(210 - i * 14),
        connections: connections(b.id),
      })),
    },
  ]
  const adminOnly = () => (getRole() === 'agency_admin' ? null : failed<never>('Doar administratorii agenției pot face această modificare.'))
  const copy = () => clients.map((c) => ({ ...c, spaces: c.spaces.map((s) => ({ ...s })) }))
  let seq = 0

  return {
    list: async () => adminOnly() ?? ready(copy()),
    createClient: async (input) => {
      const denied = adminOnly()
      if (denied) return denied
      if (clients.some((c) => c.slug === input.slug)) return failed('Există deja un client cu acest identificator. Alege altul.')
      const id = `tenant-preview-${++seq}`
      clients.push({ id, slug: input.slug, name: input.name.trim(), status: 'active', created_at: now().toISOString(), spaces: [] })
      return ready({ id })
    },
    renameClient: async (id, name) => {
      const denied = adminOnly()
      if (denied) return denied
      const c = clients.find((x) => x.id === id)
      if (!c) return failed('Clientul nu a fost găsit.')
      c.name = name.trim()
      return ready(null)
    },
    createSpace: async (tenantId, input) => {
      const denied = adminOnly()
      if (denied) return denied
      const c = clients.find((x) => x.id === tenantId)
      if (!c) return failed('Clientul nu a fost găsit.')
      if (c.spaces.some((s) => s.slug === input.slug)) return failed('Clientul are deja un site cu acest identificator. Alege altul.')
      const domain = input.domain === null ? null : normalizeDomain(input.domain)
      if (domain === undefined) return failed('Domeniul nu pare valid. Exemplu: exemplu.ro')
      const id = `brand-preview-${++seq}`
      c.spaces.push({ id, tenant_id: tenantId, slug: input.slug, name: input.name.trim(), domain, status: 'active', created_at: now().toISOString(), connections: 0 })
      return ready({ id })
    },
    updateSpace: async (id, patch) => {
      const denied = adminOnly()
      if (denied) return denied
      const s = clients.flatMap((c) => c.spaces).find((x) => x.id === id)
      if (!s) return failed('Site-ul nu a fost găsit.')
      if (patch.domain !== undefined) {
        const d = patch.domain === null ? null : normalizeDomain(patch.domain)
        if (d === undefined) return failed('Domeniul nu pare valid. Exemplu: exemplu.ro')
        s.domain = d
      }
      if (patch.name !== undefined) s.name = patch.name.trim()
      if (patch.status !== undefined) s.status = patch.status
      return ready(null)
    },
  }
}
