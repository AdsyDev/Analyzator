import { failed, ready, notConnected, type AccessPerson, type CompetitorSetVersion, type ConfigProvider, type InviteStatus, type MappingKind, type NewSeomonitorMapping, type ProviderResult, type Role, type SeomonitorMapping, type UsersProvider } from '../../contracts'
import { INVITE_STATUSES, ROLES } from '../../contracts'
import { addDays, todayBucharest } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'
import { functionError } from './sourcesProvider'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'

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
/** Rândul din funcția server `users` (`identities`): identitatea din contul persoanei, doar pentru agency_admin. */
interface IdentityRow {
  tenant_id: string
  user_id: string
  email: string | null
  full_name: string | null
  last_sign_in_at: string | null
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
 * (`agency_admin` al tenantului); nicio verificare din interfață nu înlocuiește asta. Numele, emailul și invitația trec
 * prin funcția server `users` (E10): ea autentifică sesiunea și citește `auth.users` cu cheia de service, doar pentru
 * tenanții în care apelantul e agency_admin, fără să expună cheia.
 */
export function createSupabaseUsers(client: DataClient): UsersProvider {
  async function guardSelf(userId: string): Promise<ProviderResult<null> | null> {
    const me = await currentUserId(client)
    if (me === null) return failed('Sesiunea a expirat. Autentifică-te din nou.')
    return me === userId ? failed(SELF) : null
  }

  return {
    async people() {
      const [m, a, i] = await Promise.all([
        client.from('memberships').select('tenant_id, user_id, role, revoked_at, created_at, tenants(name)').order('created_at'),
        client.from('brand_access').select('tenant_id, brand_id, user_id, revoked_at'),
        client.functions.invoke('users', { body: { action: 'identities' } }),
      ])
      if (m.error || a.error) return failed(QUERY_FAILED)
      if (i.error) return failed(await functionError(i.error))
      const found = (i.data as { people?: unknown } | null)?.people
      if (!Array.isArray(found)) return failed(CONTRACT)
      const access = (a.data ?? []) as unknown as AccessRow[]
      const rows = (m.data ?? []) as unknown as MembershipRow[]
      const identities = new Map((found as IdentityRow[]).map((x) => [`${x.tenant_id}:${x.user_id}`, x]))
      const people: AccessPerson[] = []
      for (const r of rows) {
        if (!(ROLES as readonly string[]).includes(r.role)) return failed(CONTRACT)
        const tenant = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants
        const who = identities.get(`${r.tenant_id}:${r.user_id}`)
        people.push({
          user_id: r.user_id,
          tenant_id: r.tenant_id,
          organization: tenant?.name ?? '',
          role: r.role as Role,
          membership_active: r.revoked_at === null,
          since: r.created_at,
          name: who?.full_name ?? null,
          email: who?.email ?? null,
          last_sign_in_at: who?.last_sign_in_at ?? null,
          brands: access.filter((x) => x.tenant_id === r.tenant_id && x.user_id === r.user_id).map((x) => ({ brand_id: x.brand_id, active: x.revoked_at === null })),
        })
      }
      return ready(people)
    },

    async invite(input) {
      const { data, error } = await client.functions.invoke('users', {
        body: { action: 'invite', tenant_id: input.tenant_id, email: input.email, full_name: input.full_name, role: input.role, brand_ids: input.brand_ids },
      })
      if (error) return failed(await functionError(error))
      const d = data as { status?: unknown; user_id?: unknown } | null
      if (!d || typeof d.user_id !== 'string' || !INVITE_STATUSES.includes(d.status as InviteStatus)) return failed(CONTRACT)
      return ready({ status: d.status as InviteStatus, user_id: d.user_id })
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

    async saveSeomonitorMappings(tenantId, sourceId, rows: NewSeomonitorMapping[]) {
      if (rows.length === 0) return failed('Nicio schimbare de salvat.')
      const userId = await currentUserId(client)
      if (!userId) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const campaigns = [...new Set(rows.map((r) => r.campaign_id))]
      const existing = await client
        .from('seomonitor_group_mappings')
        .select('campaign_id, group_id, version')
        .eq('tenant_id', tenantId)
        .eq('source_id', sourceId)
        .in('campaign_id', campaigns)
      if (existing.error) return failed(QUERY_FAILED)
      const maxVersion = new Map<string, number>()
      for (const r of (existing.data ?? []) as unknown as Array<{ campaign_id: string; group_id: string; version: number }>) {
        const k = `${r.campaign_id}:${r.group_id}`
        maxVersion.set(k, Math.max(maxVersion.get(k) ?? 0, r.version))
      }
      // În vigoare de ieri: colectarea aplică versiunea valabilă la sfârșitul intervalului (ieri).
      const effective = addDays(todayBucharest(now()), -1)
      const insert = rows.map((r) => ({
        tenant_id: tenantId,
        source_id: sourceId,
        campaign_id: r.campaign_id,
        group_id: r.group_id,
        version: (maxVersion.get(`${r.campaign_id}:${r.group_id}`) ?? 0) + 1,
        effective_from: effective,
        mapping_kind: r.kind,
        brand_id: r.kind === 'brand' ? r.brand_id : null,
        brand_type: r.kind === 'brand' ? r.brand_type : null,
        is_primary_visibility: r.kind === 'brand' && r.is_primary_visibility,
        note: 'Din pagina site-ului',
        created_by: userId,
      }))
      const { error } = await client.from('seomonitor_group_mappings').insert(insert)
      if (error) return failed(error.code === '42501' ? 'Doar administratorii agenției pot mapa grupurile SEOmonitor.' : error.code === '23505' ? 'Maparea a fost schimbată între timp. Reîncarcă și încearcă din nou.' : QUERY_FAILED)
      return ready({ effective_from: effective })
    },
  }
}
