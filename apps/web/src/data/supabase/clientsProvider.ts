import { failed, ready, type Client, type ClientSpace, type ClientsProvider, type RecordStatus, type SpacePatch } from '../../contracts'
import { normalizeDomain, SLUG_PATTERN } from '../../lib/slug'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

interface TenantRow {
  id: string
  slug: string
  name: string
  status: string
  created_at: string
}
interface BrandRow extends TenantRow {
  tenant_id: string
  domain: string | null
}
interface ConnectionRow {
  brand_id: string | null
}

const NO_RIGHT = 'Doar administratorii agenției pot face această modificare.'
const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const STATUSES: readonly string[] = ['active', 'archived']

/** Cod Postgres → mesaj pentru utilizator; detaliile bazei de date nu ajung în interfață. */
function writeError(code: string | undefined, duplicate: string, fallback: string): string {
  if (code === '42501') return NO_RIGHT
  if (code === '23505') return duplicate
  return fallback
}

function validName(name: string): string | null {
  const n = name.trim()
  return n.length < 2 || n.length > 120 ? null : n
}

/**
 * Clienții și spațiile lor, prin sesiunea utilizatorului. RLS decide ce se vede și cine scrie (`agency_admin`);
 * verificările de aici doar dau mesaje clare înainte de cerere.
 */
export function createSupabaseClients(client: DataClient, newId: () => string = () => crypto.randomUUID()): ClientsProvider {
  return {
    async list() {
      const [t, b, c] = await Promise.all([
        client.from('tenants').select('id, slug, name, status, created_at').order('name'),
        client.from('brands').select('id, tenant_id, slug, name, domain, status, created_at').order('name'),
        client.from('source_connections').select('brand_id').eq('status', 'active'),
      ])
      if (t.error || b.error || c.error) return failed(QUERY_FAILED)
      const tenants = (t.data ?? []) as unknown as TenantRow[]
      const brands = (b.data ?? []) as unknown as BrandRow[]
      const connections = (c.data ?? []) as unknown as ConnectionRow[]
      if ([...tenants, ...brands].some((r) => !STATUSES.includes(r.status))) return failed(CONTRACT)
      const count = new Map<string, number>()
      for (const r of connections) if (r.brand_id) count.set(r.brand_id, (count.get(r.brand_id) ?? 0) + 1)
      const clients = tenants.map<Client>((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status as RecordStatus,
        created_at: r.created_at,
        spaces: brands
          .filter((x) => x.tenant_id === r.id)
          .map<ClientSpace>((x) => ({
            id: x.id,
            tenant_id: x.tenant_id,
            slug: x.slug,
            name: x.name,
            domain: x.domain,
            status: x.status as RecordStatus,
            created_at: x.created_at,
            connections: count.get(x.id) ?? 0,
          })),
      }))
      return ready(clients)
    },

    async createClient(input) {
      const name = validName(input.name)
      if (!name) return failed('Numele clientului trebuie să aibă între 2 și 120 de caractere.')
      if (!SLUG_PATTERN.test(input.slug)) return failed('Identificatorul poate conține doar litere mici, cifre și cratime.')
      // Fără RETURNING: rândul devine vizibil abia după ce triggerul îl face pe creator agency_admin (E5).
      const id = newId()
      const { error } = await client.from('tenants').insert({ id, slug: input.slug, name })
      if (error) return failed(writeError(error.code, 'Există deja un client cu acest identificator. Alege altul.', 'Clientul nu a putut fi creat. Reîncearcă.'))
      return ready({ id })
    },

    async renameClient(id, name) {
      const n = validName(name)
      if (!n) return failed('Numele clientului trebuie să aibă între 2 și 120 de caractere.')
      const { error } = await client.from('tenants').update({ name: n }).eq('id', id)
      return error ? failed(writeError(error.code, '', 'Numele nu a putut fi schimbat. Reîncearcă.')) : ready(null)
    },

    async createSpace(tenantId, input) {
      const name = validName(input.name)
      if (!name) return failed('Numele site-ului trebuie să aibă între 2 și 120 de caractere.')
      if (!SLUG_PATTERN.test(input.slug)) return failed('Identificatorul poate conține doar litere mici, cifre și cratime.')
      const domain = input.domain === null ? null : normalizeDomain(input.domain)
      if (domain === undefined) return failed('Domeniul nu pare valid. Exemplu: exemplu.ro')
      const id = newId()
      const { error } = await client.from('brands').insert({ id, tenant_id: tenantId, slug: input.slug, name, domain })
      if (error) return failed(writeError(error.code, 'Clientul are deja un site cu acest identificator. Alege altul.', 'Site-ul nu a putut fi creat. Reîncearcă.'))
      return ready({ id })
    },

    async updateSpace(id, patch: SpacePatch) {
      const update: Record<string, unknown> = {}
      if (patch.name !== undefined) {
        const n = validName(patch.name)
        if (!n) return failed('Numele site-ului trebuie să aibă între 2 și 120 de caractere.')
        update.name = n
      }
      if (patch.domain !== undefined) {
        const d = patch.domain === null ? null : normalizeDomain(patch.domain)
        if (d === undefined) return failed('Domeniul nu pare valid. Exemplu: exemplu.ro')
        update.domain = d
      }
      if (patch.status !== undefined) update.status = patch.status
      if (Object.keys(update).length === 0) return ready(null)
      const { error } = await client.from('brands').update(update).eq('id', id)
      return error ? failed(writeError(error.code, '', 'Site-ul nu a putut fi modificat. Reîncearcă.')) : ready(null)
    },
  }
}
