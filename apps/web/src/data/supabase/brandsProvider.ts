import { failed, notConnected, ready, type BrandsProvider, type Competitor, type CompetitorSet } from '../../contracts'
import { todayBucharest } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

/** Spațiile de brand și setul de competitori efectiv, citite prin sesiunea utilizatorului (RLS). */
export function createSupabaseBrands(client: DataClient, now: () => Date = () => new Date()): BrandsProvider {
  return {
    async list() {
      const { data, error } = await client.from('brands').select('id, tenant_id, name, domain').eq('status', 'active').order('name')
      if (error) return failed(QUERY_FAILED)
      const rows = (data ?? []) as unknown as Array<{ id: string; tenant_id: string; name: string; domain: string | null }>
      // Numele clientului e doar o etichetă în bara de context: dacă nu se poate citi, brandurile rămân utilizabile.
      const tenants = rows.length === 0 ? { data: [], error: null } : await client.from('tenants').select('id, name').in('id', [...new Set(rows.map((r) => r.tenant_id))])
      const tenantName = new Map((tenants.error ? [] : ((tenants.data ?? []) as unknown as Array<{ id: string; name: string }>)).map((t) => [t.id, t.name]))
      // Nu există încă o categorie în schemă: `null`, nu un text presupus.
      return ready(rows.map((r) => ({ id: r.id, tenant_id: r.tenant_id, tenant_name: tenantName.get(r.tenant_id) ?? null, name: r.name, category: null, domain: r.domain })))
    },

    async competitorSet(brandId) {
      const today = todayBucharest(now())
      const set = await client
        .from('competitor_sets')
        .select('id, version, effective_from')
        .eq('brand_id', brandId)
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (set.error) return failed(QUERY_FAILED)
      const s = set.data as { id: string; version: number; effective_from: string } | null
      // Lipsa setului e o stare de configurare, nu o eroare: fără „Reîncearcă", cu motivul afișat.
      if (!s) return notConnected('Brandul nu are încă un set de competitori în vigoare; comparația apare după configurarea lui.')
      const members = await client.from('competitor_set_members').select('id, name, sort_order').eq('competitor_set_id', s.id).order('sort_order')
      if (members.error) return failed(QUERY_FAILED)
      const competitors = ((members.data ?? []) as unknown as Array<{ id: string; name: string }>).map<Competitor>((m, i) => ({ id: m.id, name: m.name, label: `C${i + 1}` }))
      return ready<CompetitorSet>({ brand_id: brandId, version: s.version, effective_from: s.effective_from, competitors })
    },
  }
}
