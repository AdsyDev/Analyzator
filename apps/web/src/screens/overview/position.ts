import type { CompetitionMatrix, CompetitionRow } from '../../contracts'
import { POSITION_DIMENSIONS } from './slots'

export interface PositionRow {
  dimension: (typeof POSITION_DIMENSIONS)[number]
  title: string
  source: string | null
  row: CompetitionRow
  /** Locul brandului printre entitățile care au valoare pe acest rând; `null` când nu se poate stabili. */
  rank: { place: number; of: number } | null
  /** De ce lipsește locul (brand fără valoare, un singur rezultat, metrică fără direcție „bună"). */
  rankReason: string | null
}

/**
 * Alege câte un rând pe dimensiune din matricea de Concurență și stabilește locul brandului în set. Nu calculează
 * metrici: ordonează valorile venite de la server, după direcția din registru. Valorile lipsă nu intră în clasament
 * (nu sunt zero), iar o egalitate dă același loc.
 */
export function positionRows(m: CompetitionMatrix): PositionRow[] {
  const brand = m.entities.find((e) => e.kind === 'brand')
  const out: PositionRow[] = []
  for (const dimension of POSITION_DIMENSIONS) {
    const group = m.groups.find((g) => g.dimension === dimension)
    const row = group?.rows[0]
    if (!group || !row) continue
    const values = m.entities.map((e) => ({ id: e.id, value: row.cells[e.id]?.value ?? null })).filter((v): v is { id: string; value: number } => v.value !== null)
    const own = brand ? values.find((v) => v.id === brand.id) : undefined
    let rank: PositionRow['rank'] = null
    let rankReason: string | null = null
    if (row.direction === 'neutral') rankReason = 'Indicator fără direcție „bună”: nu se face clasament.'
    else if (!own) rankReason = 'Brandul nu are valoare pe acest indicator.'
    else if (values.length < 2) rankReason = 'Niciun competitor nu are valoare pe acest indicator.'
    else {
      const better = values.filter((v) => (row.direction === 'higher_is_better' ? v.value > own.value : v.value < own.value)).length
      rank = { place: better + 1, of: values.length }
    }
    out.push({ dimension, title: group.title, source: group.source, row, rank, rankReason })
  }
  return out
}
