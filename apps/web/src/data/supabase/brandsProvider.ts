import { failed, ready, type BrandsProvider, type Competitor, type CompetitorSet } from '../../contracts'
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
      // Nu există încă o categorie în schemă: `null`, nu un text presupus.
      return ready(rows.map((r) => ({ id: r.id, tenant_id: r.tenant_id, name: r.name, category: null, domain: r.domain })))
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
      if (!s) return failed('Brandul nu are încă un set de competitori în vigoare.')
      const members = await client.from('competitor_set_members').select('id, name, sort_order').eq('competitor_set_id', s.id).order('sort_order')
      if (members.error) return failed(QUERY_FAILED)
      const competitors = ((members.data ?? []) as unknown as Array<{ id: string; name: string }>).map<Competitor>((m, i) => ({ id: m.id, name: m.name, label: `C${i + 1}` }))
      return ready<CompetitorSet>({ brand_id: brandId, version: s.version, effective_from: s.effective_from, competitors })
    },
  }
}
