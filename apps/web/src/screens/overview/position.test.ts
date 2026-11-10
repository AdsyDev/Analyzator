import { describe, expect, it } from 'vitest'
import type { CompetitionCell, CompetitionMatrix, MetricDirection } from '../../contracts'
import { positionRows } from './position'

const cell = (value: number | null): CompetitionCell => ({ value, unit: 'percent', status: value === null ? 'unavailable' : 'ok', coverage: null, reason: value === null ? 'Fără sursă.' : null })
const matrix = (direction: MetricDirection, values: Array<number | null>): CompetitionMatrix => ({
  entities: [
    { id: 'b', name: 'Proenzi', kind: 'brand', label: 'Proenzi' },
    { id: 'c1', name: 'A', kind: 'competitor', label: 'C1' },
    { id: 'c2', name: 'B', kind: 'competitor', label: 'C2' },
    { id: 'c3', name: 'C', kind: 'competitor', label: 'C3' },
  ],
  groups: [
    { dimension: 'social', title: 'Social public', source: null, rows: [{ key: 's', label: 'S', definition: '', direction, cells: {} }] },
    {
      dimension: 'ai',
      title: 'AI',
      source: 'SEOmonitor',
      rows: [
        { key: 'first', label: 'Mention Rate', definition: '', direction, cells: { b: cell(values[0] ?? null), c1: cell(values[1] ?? null), c2: cell(values[2] ?? null), c3: cell(values[3] ?? null) } },
        { key: 'second', label: 'Alt rând', definition: '', direction, cells: {} },
      ],
    },
  ],
  set_version: 1,
  effective_from: '2026-09-15',
  data_as_of: '2026-11-09',
})

describe('poziția față de competitori', () => {
  it('ia primul rând al fiecărei dimensiuni cerute (AI, SEO, conversații) și sare dimensiunile absente', () => {
    const rows = positionRows(matrix('higher_is_better', [41.3, 52.7, 33.2, 18.5]))
    expect(rows.map((r) => [r.dimension, r.row.key])).toEqual([['ai', 'first']])
  })

  it('locul în set: mai mare e mai bine; valorile lipsă nu intră în clasament și nu sunt zero', () => {
    expect(positionRows(matrix('higher_is_better', [41.3, 52.7, 33.2, 18.5]))[0]?.rank).toEqual({ place: 2, of: 4 })
    expect(positionRows(matrix('higher_is_better', [41.3, 52.7, null, null]))[0]?.rank).toEqual({ place: 2, of: 2 })
  })

  it('mai mic e mai bine (poziție): ordinea se inversează; egalitatea dă același loc', () => {
    expect(positionRows(matrix('lower_is_better', [4.6, 3.5, 1, 9]))[0]?.rank).toEqual({ place: 3, of: 4 })
    expect(positionRows(matrix('higher_is_better', [50, 50, 20, 10]))[0]?.rank).toEqual({ place: 1, of: 4 })
  })

  it('fără loc, cu motiv: brand fără valoare, un singur rezultat, indicator neutru', () => {
    expect(positionRows(matrix('higher_is_better', [null, 52.7, 33.2, 18.5]))[0]).toMatchObject({ rank: null, rankReason: 'Brandul nu are valoare pe acest indicator.' })
    expect(positionRows(matrix('higher_is_better', [41.3, null, null, null]))[0]).toMatchObject({ rank: null, rankReason: 'Niciun competitor nu are valoare pe acest indicator.' })
    expect(positionRows(matrix('neutral', [41.3, 52.7, 33.2, 18.5]))[0]?.rank).toBeNull()
  })
})
