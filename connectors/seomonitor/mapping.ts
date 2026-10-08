// Maparea grupurilor SEOmonitor pe branduri (tabela seomonitor_group_mappings, administrată de agenție).
// - Versiunea curentă = cea mai mare versiune cu effective_from <= ziua rulării.
// - Grup descoperit fără mapare → coadă (`unmapped`); nu intră în niciun brand.
// - Grup multi-brand → coadă (`multi_brand`); rezultatele lui nu se atribuie automat niciunui brand.
// - Grup mapat care nu mai apare în SEOmonitor → coadă (`mapped_group_missing`) și brandul devine partial.

import type { Group } from './schemas.ts'

export type MappingRow = {
  id: string
  tenant_id: string
  source_id: string
  campaign_id: string
  group_id: string
  version: number
  effective_from: string
  mapping_kind: 'brand' | 'multi_brand' | 'excluded'
  brand_id: string | null
  brand_type: 'branded' | 'nonbranded' | null
  is_primary_visibility: boolean
}

export type FlatGroup = { campaign_id: string; group_id: string; name: string; type: string; parent_group_id: string | null }

export type QueueItem = {
  campaign_id: string
  group_id: string
  group_name: string | null
  group_type: string | null
  reason: 'unmapped' | 'multi_brand' | 'mapped_group_missing'
}

export type BrandGroup = { group: FlatGroup; mapping: MappingRow & { brand_id: string } }

const key = (campaignId: string, groupId: string) => `${campaignId}|${groupId}`

/** Versiunea curentă per (campanie, grup). */
export function currentMappings(rows: MappingRow[], day: string): Map<string, MappingRow> {
  const current = new Map<string, MappingRow>()
  for (const row of rows) {
    if (row.effective_from > day) continue
    const k = key(row.campaign_id, row.group_id)
    const prev = current.get(k)
    if (!prev || row.version > prev.version) current.set(k, row)
  }
  return current
}

export function flattenGroups(campaignId: string, groups: Group[], parent: string | null = null): FlatGroup[] {
  const out: FlatGroup[] = []
  for (const g of groups) {
    const groupId = String(g.group_id)
    out.push({ campaign_id: campaignId, group_id: groupId, name: g.name ?? '', type: g.type ?? 'group', parent_group_id: parent })
    if (g.subgroups?.length) out.push(...flattenGroups(campaignId, g.subgroups, groupId))
  }
  return out
}

export type Resolution = {
  byBrand: Map<string, BrandGroup[]>
  queue: QueueItem[]
  notes: string[]
}

export function resolveGroups(discovered: FlatGroup[], mappings: Map<string, MappingRow>): Resolution {
  const byBrand = new Map<string, BrandGroup[]>()
  const queue: QueueItem[] = []
  const notes: string[] = []
  const seen = new Set<string>()

  for (const group of discovered) {
    const k = key(group.campaign_id, group.group_id)
    seen.add(k)
    const mapping = mappings.get(k)
    if (!mapping) {
      queue.push({ campaign_id: group.campaign_id, group_id: group.group_id, group_name: group.name, group_type: group.type, reason: 'unmapped' })
      continue
    }
    if (mapping.mapping_kind === 'excluded') continue
    if (mapping.mapping_kind === 'multi_brand' || !mapping.brand_id) {
      queue.push({ campaign_id: group.campaign_id, group_id: group.group_id, group_name: group.name, group_type: group.type, reason: 'multi_brand' })
      continue
    }
    const list = byBrand.get(mapping.brand_id) ?? []
    list.push({ group, mapping: mapping as MappingRow & { brand_id: string } })
    byBrand.set(mapping.brand_id, list)
  }

  for (const [k, mapping] of mappings) {
    if (seen.has(k) || mapping.mapping_kind !== 'brand') continue
    queue.push({ campaign_id: mapping.campaign_id, group_id: mapping.group_id, group_name: null, group_type: null, reason: 'mapped_group_missing' })
    notes.push(`grupul mapat ${mapping.group_id} (campania ${mapping.campaign_id}) nu mai apare în SEOmonitor`)
  }

  for (const [brandId, groups] of byBrand) {
    const primaries = groups.filter((g) => g.mapping.is_primary_visibility)
    if (primaries.length > 1) {
      notes.push(`brandul ${brandId} are ${primaries.length} grupuri principale de visibility; se folosește doar ${primaries[0]!.group.group_id}`)
      for (const extra of primaries.slice(1)) extra.mapping = { ...extra.mapping, is_primary_visibility: false }
    }
  }

  return { byBrand, queue, notes }
}

/** Brandurile cu cel puțin un grup mapat curent (inclusiv grupurile dispărute), pentru sync_runs. */
export function mappedBrands(mappings: Map<string, MappingRow>): string[] {
  return [...new Set([...mappings.values()].filter((m) => m.mapping_kind === 'brand' && m.brand_id).map((m) => m.brand_id!))]
}
