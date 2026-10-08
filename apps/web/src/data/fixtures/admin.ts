import adminFile from '../../../../../tests/fixtures/ui/admin.json'
import { failed, ready, type AccessPerson, type BrandAlias, type CompetitorSetVersion, type ConfigProvider, type MappingKind, type Role, type SeomonitorMapping, type UsersProvider } from '../../contracts'
import { addDays, todayBucharest } from '../../lib/period'

interface Options {
  now: () => Date
  getRole: () => Role
  getUserId: () => string
  allowed: Set<string>
}

/**
 * Administrare cu date FICTIVE, doar pentru previzualizare. Modificările (rol, acces) rămân în memorie cât ține
 * sesiunea; nimic nu pleacă spre un server. Aceleași reguli ca la server: doar `agency_admin`, iar o persoană nu
 * își poate modifica singură rolul sau accesul.
 */
export function createAdminFixtures({ now, getRole, getUserId, allowed }: Options): { users: UsersProvider; config: ConfigProvider } {
  const today = () => todayBucharest(now())
  const instantDaysAgo = (n: number) => new Date(now().getTime() - n * 86_400_000).toISOString()

  const people: AccessPerson[] = adminFile.people.map((p) => ({
    user_id: p.user_id,
    tenant_id: p.organization === 'STADA' ? 'tenant-stada-preview' : 'tenant-agency-preview',
    organization: p.organization,
    role: p.role as Role,
    membership_active: p.membership_active,
    since: instantDaysAgo(p.since_days_ago),
    name: p.name,
    email: p.email,
    brands: p.brands.map((brand_id) => ({ brand_id, active: true })),
  }))

  const adminOnly = () => (getRole() === 'agency_admin' ? null : failed<never>('Administrarea utilizatorilor este disponibilă doar administratorilor agenției.'))
  const find = (tenantId: string, userId: string) => people.find((p) => p.tenant_id === tenantId && p.user_id === userId)
  const SELF = 'Nu îți poți modifica singur rolul sau accesul.'

  const users: UsersProvider = {
    people: async () => adminOnly() ?? ready(people.map((p) => ({ ...p, brands: p.brands.map((b) => ({ ...b })) }))),
    setRole: async (tenantId, userId, role) => {
      const denied = adminOnly()
      if (denied) return denied
      if (userId === getUserId()) return failed(SELF)
      const p = find(tenantId, userId)
      if (!p) return failed('Persoana nu a fost găsită.')
      p.role = role
      return ready(null)
    },
    setMembershipActive: async (tenantId, userId, active) => {
      const denied = adminOnly()
      if (denied) return denied
      if (userId === getUserId()) return failed(SELF)
      const p = find(tenantId, userId)
      if (!p) return failed('Persoana nu a fost găsită.')
      p.membership_active = active
      return ready(null)
    },
    setBrandAccess: async (tenantId, userId, brandId, active) => {
      const denied = adminOnly()
      if (denied) return denied
      if (userId === getUserId()) return failed(SELF)
      if (!allowed.has(brandId)) return failed('Spațiul de brand nu a fost găsit sau nu ai acces la el.')
      const p = find(tenantId, userId)
      if (!p) return failed('Persoana nu a fost găsită.')
      const existing = p.brands.find((b) => b.brand_id === brandId)
      if (existing) existing.active = active
      else p.brands.push({ brand_id: brandId, active })
      return ready(null)
    },
  }

  const versions = adminFile.competitor_versions as Record<string, Array<{ version: number; effective_from_days_ago: number; note: string | null; members: Array<{ id: string; name: string; domain: string | null }> }>>
  const aliases = adminFile.aliases as Record<string, Array<{ id: string; alias: string; used_in: string }>>

  const config: ConfigProvider = {
    competitorVersions: async (brandId) => {
      if (!allowed.has(brandId)) return failed('Acces refuzat la acest spațiu de brand.')
      const list = versions[brandId] ?? []
      const effective = list.filter((v) => addDays(today(), -v.effective_from_days_ago) <= today()).sort((a, b) => b.version - a.version)[0]?.version
      return ready(
        list.map<CompetitorSetVersion>((v) => ({
          version: v.version,
          effective_from: addDays(today(), -v.effective_from_days_ago),
          note: v.note,
          created_at: instantDaysAgo(v.effective_from_days_ago + 2),
          current: v.version === effective,
          members: v.members.map((m, i) => ({ ...m, label: `C${i + 1}` })),
        })),
      )
    },
    aliases: async (brandId) => {
      if (!allowed.has(brandId)) return failed('Acces refuzat la acest spațiu de brand.')
      return ready<BrandAlias[]>(aliases[brandId] ?? [])
    },
    seomonitorMappings: async () =>
      getRole() === 'client_viewer'
        ? failed('Maparea grupurilor este vizibilă doar echipei AdSymphony.')
        : ready(
            adminFile.seomonitor_mappings.map<SeomonitorMapping>((m) => ({
              campaign_id: m.campaign_id,
              group_id: m.group_id,
              version: m.version,
              effective_from: addDays(today(), -m.effective_days_ago),
              kind: m.kind as MappingKind,
              brand_id: m.brand_id,
              brand_type: m.brand_type as SeomonitorMapping['brand_type'],
              is_primary_visibility: m.is_primary_visibility,
              note: m.note,
            })),
          ),
  }
  return { users, config }
}
