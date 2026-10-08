import { failed, ready, notConnected, type AccessPerson, type CompetitorSetVersion, type ConfigProvider, type MappingKind, type ProviderResult, type Role, type SeomonitorMapping, type UsersProvider } from '../../contracts'
import { ROLES } from '../../contracts'
import { todayBucharest } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

const SELF = 'Nu îți poți modifica singur rolul sau accesul.'
const NO_RIGHT = 'Doar administratorii agenției pot modifica accesul.'

interface MembershipRow {
  tenant_id: string
  user_id: string
  role: string
  revoked_at: string | null
  created_at: string
  tenants: { name: string } | { name: string }[] | null
}
interface AccessRow {
  tenant_id: string
  brand_id: string
  user_id: string
  revoked_at: string | null
}

async function currentUserId(client: DataClient): Promise<string | null> {
  const { data } = await client.auth.getSession()
  return data.session?.user.id ?? null
}

/** Cod Postgres → mesaj pentru utilizator; detaliile bazei de date nu ajung în interfață. */
function writeError(code: string | undefined, fallback: string): string {
  return code === '42501' ? NO_RIGHT : fallback
}

/**
 * Utilizatorii: citire și modificare prin sesiunea utilizatorului. RLS decide cine poate scrie
 * (`agency_admin` al tenantului); nicio verificare din interfață nu înlocuiește asta. Numele și emailul
 * nu sunt citibile din client, deci rămân null.
 */
export function createSupabaseUsers(client: DataClient): UsersProvider {
  async function guardSelf(userId: string): Promise<ProviderResult<null> | null> {
    const me = await currentUserId(client)
    if (me === null) return failed('Sesiunea a expirat. Autentifică-te din nou.')
    return me === userId ? failed(SELF) : null
  }

  return {
    async people() {
      const [m, a] = await Promise.all([
        client.from('memberships').select('tenant_id, user_id, role, revoked_at, created_at, tenants(name)').order('created_at'),
        client.from('brand_access').select('tenant_id, brand_id, user_id, revoked_at'),
      ])
      if (m.error || a.error) return failed(QUERY_FAILED)
      const access = (a.data ?? []) as unknown as AccessRow[]
      const rows = (m.data ?? []) as unknown as MembershipRow[]
      const people: AccessPerson[] = []
      for (const r of rows) {
        if (!(ROLES as readonly string[]).includes(r.role)) return failed('Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.')
        const tenant = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants
        people.push({
          user_id: r.user_id,
          tenant_id: r.tenant_id,
          organization: tenant?.name ?? '',
          role: r.role as Role,
          membership_active: r.revoked_at === null,
          since: r.created_at,
          name: null,
          email: null,
          brands: access.filter((x) => x.tenant_id === r.tenant_id && x.user_id === r.user_id).map((x) => ({ brand_id: x.brand_id, active: x.revoked_at === null })),
        })
      }
      return ready(people)
    },

    async setRole(tenantId, userId, role) {
      if (!(ROLES as readonly string[]).includes(role)) return failed('Rol necunoscut.')
      const self = await guardSelf(userId)
      if (self) return self
      const { error } = await client.from('memberships').update({ role }).eq('tenant_id', tenantId).eq('user_id', userId)
      return error ? failed(writeError(error.code, 'Rolul nu a putut fi schimbat. Reîncearcă.')) : ready(null)
    },

    async setMembershipActive(tenantId, userId, active) {
      const self = await guardSelf(userId)
      if (self) return self
      const { error } = await client.from('memberships').update({ revoked_at: active ? null : new Date().toISOString() }).eq('tenant_id', tenantId).eq('user_id', userId)
      return error ? failed(writeError(error.code, 'Accesul nu a putut fi modificat. Reîncearcă.')) : ready(null)
    },

    async setBrandAccess(tenantId, userId, brandId, active) {
      const self = await guardSelf(userId)
      if (self) return self
      const me = await currentUserId(client)
      const existing = await client.from('brand_access').select('tenant_id').eq('tenant_id', tenantId).eq('brand_id', brandId).eq('user_id', userId).maybeSingle()
      if (existing.error) return failed(QUERY_FAILED)
      if (existing.data) {
        // Rândul există (unic pe tenant, brand, user): se revocă sau se restabilește, nu se șterge.
        const { error } = await client
          .from('brand_access')
          .update({ revoked_at: active ? null : new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('brand_id', brandId)
          .eq('user_id', userId)
        return error ? failed(writeError(error.code, 'Accesul nu a putut fi modificat. Reîncearcă.')) : ready(null)
      }
      if (!active) return ready(null)
      const { error } = await client.from('brand_access').insert({ tenant_id: tenantId, brand_id: brandId, user_id: userId, granted_by: me })
      return error ? failed(writeError(error.code, 'Accesul nu a putut fi acordat. Persoana trebuie să aibă mai întâi acces la organizație.')) : ready(null)
    },
  }
}

const MAPPING_KINDS: readonly string[] = ['brand', 'multi_brand', 'excluded']

/** Configurarea: citire. Versiunile de competitori sunt imutabile, iar modificările lor cer o funcție server atomică. */
export function createSupabaseConfig(client: DataClient, now: () => Date = () => new Date()): ConfigProvider {
  return {
    async competitorVersions(brandId) {
      const sets = await client.from('competitor_sets').select('id, version, effective_from, note, created_at').eq('brand_id', brandId).order('version', { ascending: false })
      if (sets.error) return failed(QUERY_FAILED)
      const members = await client.from('competitor_set_members').select('id, competitor_set_id, name, domain, sort_order').eq('brand_id', brandId).order('sort_order')
      if (members.error) return failed(QUERY_FAILED)
      const memberRows = (members.data ?? []) as unknown as Array<{ id: string; competitor_set_id: string; name: string; domain: string | null }>
      const setRows = (sets.data ?? []) as unknown as Array<{ id: string; version: number; effective_from: string; note: string | null; created_at: string }>
      const today = todayBucharest(now())
      const effective = setRows.filter((s) => s.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]?.id
      return ready<CompetitorSetVersion[]>(
        setRows.map((s) => ({
          version: s.version,
          effective_from: s.effective_from,
          note: s.note,
          created_at: s.created_at,
          current: s.id === effective,
          members: memberRows.filter((m) => m.competitor_set_id === s.id).map((m, i) => ({ id: m.id, name: m.name, domain: m.domain, label: `C${i + 1}` })),
        })),
      )
    },

    // Aliasurile brandului nu au un tabel în schema curentă: nu inventăm o sursă.
    aliases: async () => notConnected('Aliasurile brandului nu au încă un loc în baza de date. Se vor putea vedea aici după ce schema le primește.'),

    async seomonitorMappings() {
      const { data, error } = await client
        .from('seomonitor_group_mappings')
        .select('campaign_id, group_id, version, effective_from, mapping_kind, brand_id, brand_type, is_primary_visibility, note')
        .order('version', { ascending: false })
      if (error) return failed(QUERY_FAILED)
      const rows = (data ?? []) as unknown as Array<{ campaign_id: string; group_id: string; version: number; effective_from: string; mapping_kind: string; brand_id: string | null; brand_type: string | null; is_primary_visibility: boolean; note: string | null }>
      const today = todayBucharest(now())
      // Cea mai recentă versiune în vigoare pentru fiecare grup (versiunile viitoare nu se aplică încă).
      const latest = new Map<string, (typeof rows)[number]>()
      for (const r of rows) {
        if (r.effective_from > today || !MAPPING_KINDS.includes(r.mapping_kind)) continue
        const key = `${r.campaign_id}:${r.group_id}`
        const cur = latest.get(key)
        if (!cur || r.version > cur.version) latest.set(key, r)
      }
      return ready<SeomonitorMapping[]>(
        [...latest.values()].map((r) => ({
          campaign_id: r.campaign_id,
          group_id: r.group_id,
          version: r.version,
          effective_from: r.effective_from,
          kind: r.mapping_kind as MappingKind,
          brand_id: r.brand_id,
          brand_type: r.brand_type as SeomonitorMapping['brand_type'],
          is_primary_visibility: r.is_primary_visibility,
          note: r.note,
        })),
      )
    },
  }
}
