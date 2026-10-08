import { describe, expect, it } from 'vitest'
import { METRIC_STATUSES } from '../contracts'
import { metric, warning } from '../test/factories'
import { changeDirection, formatAbsoluteChange, formatMetricValue, formatRange, formatRelativeChange } from './format'
import { coveragePercent, coverageStateFor, isGoodChange, metricView } from './metricView'
import { sparkPaths } from './spark'
import { notesFor, reasonFor } from './warnings'

describe('formatare', () => {
  it('null nu devine niciodată 0', () => {
    expect(formatMetricValue(null, 'count')).toBeNull()
    expect(formatMetricValue(0, 'count')).toBe('0')
  })
  it('folosește format ro-RO pentru fiecare unitate din registru', () => {
    expect(formatMetricValue(12345, 'count')).toBe('12.345')
    expect(formatMetricValue(12.4, 'percent')).toBe('12,4 %')
    expect(formatMetricValue(3.25, 'seconds')).toBe('3,3 s')
    expect(formatMetricValue(7.4, 'position')).toBe('7,4')
    expect(formatMetricValue(7.04, 'position')).toBe('7')
    expect(formatMetricValue(48.5, 'score')).toBe('48,5')
  })
  it('exprimă diferențele dintre procente în puncte procentuale', () => {
    expect(formatAbsoluteChange(2.5, 'percent')).toBe('+2,5 p.p.')
    expect(formatAbsoluteChange(-1, 'percent')).toBe('−1 p.p.')
  })
  it('o variație care rotunjită e zero nu are semn și nu are direcție (nu „−0 p.p." cu săgeată)', () => {
    expect(formatAbsoluteChange(-0.04, 'percent')).toBe('0\u00a0p.p.')
    expect(formatAbsoluteChange(0.04, 'percent')).toBe('0\u00a0p.p.')
    expect(formatAbsoluteChange(-0.4, 'count')).toBe('0')
    expect(formatRelativeChange(-0.04)).toBe('0\u00a0%')
    expect(changeDirection(-0.04)).toBe('flat')
    expect(changeDirection(-0.06)).toBe('down')
    expect(changeDirection(0.4, 0)).toBe('flat')
    expect(changeDirection(0.6, 0)).toBe('up')
    const v = metricView(metric({ unit: 'percent', value: 30, absolute_change: -0.04, relative_change: -0.1 }))
    expect(v.deltaDirection).toBe('flat')
    expect(v.deltaText).toBe('0\u00a0p.p.')
  })

  it('variația relativă vine în procente, nu fracție', () => {
    expect(formatRelativeChange(12.7)).toBe('+12,7 %')
    expect(formatRelativeChange(-3)).toBe('−3 %')
  })
  it('datele sunt în Europe/Bucharest, fără deplasare de zi', () => {
    expect(formatRange('2026-09-08', '2026-10-05')).toMatch(/8 sept\.?\s-\s5 oct\.?\s2026/)
  })
})

describe('acoperire', () => {
  it('coverage e fracție 0-1; afișarea e în procente întregi', () => {
    expect(coveragePercent(0.82)).toBe(82)
    expect(coveragePercent(1)).toBe(100)
    expect(coveragePercent(0)).toBe(0)
    expect(coveragePercent(null)).toBeNull()
  })
})

describe('metricView', () => {
  it('maparea statusurilor la acoperire acoperă toate cele opt', () => {
    const map = Object.fromEntries(METRIC_STATUSES.map((s) => [s, coverageStateFor(s)]))
    expect(map).toEqual({
      ok: 'complete',
      partial: 'partial',
      stale: 'stale',
      insufficient_sample: 'partial',
      base_zero: 'complete',
      cannot_compute: 'unavailable',
      unavailable: 'unavailable',
      not_connected: 'unavailable',
    })
  })

  it('zero real este o cifră', () => {
    const v = metricView(metric({ value: 0, absolute_change: 0, relative_change: 0 }))
    expect(v.hasValue).toBe(true)
    expect(v.valueText).toBe('0')
    expect(v.deltaDirection).toBe('flat')
  })

  it.each(['cannot_compute', 'unavailable', 'not_connected'] as const)('%s nu are cifră', (status) => {
    const v = metricView(metric({ status, value: null }))
    expect(v.hasValue).toBe(false)
    expect(v.valueText).toBeNull()
    expect(v.emptyReason).toBeTruthy()
  })

  it('absența se decide după value: partial cu value null nu are cifră și păstrează acoperirea parțială', () => {
    const v = metricView(metric({ status: 'partial', value: null, coverage: 0.4, warnings: [warning('zero_not_confirmed')] }))
    expect(v.hasValue).toBe(false)
    expect(v.emptyTitle).toBe('Valoare neconfirmată')
    expect(v.coverage).toBe('partial')
  })

  it('un status „ok" cu value null nu produce cifră', () => {
    expect(metricView(metric({ status: 'ok', value: null })).hasValue).toBe(false)
  })

  it('base_zero nu arată variație relativă', () => {
    const v = metricView(metric({ status: 'base_zero', comparison_value: 0, relative_change: null, absolute_change: 40 }))
    expect(v.caveat).toMatch(/baza de comparație e 0/)
    expect(v.deltaText).toBe('+40')
  })

  it('pentru rate folosește puncte procentuale, nu variația relativă', () => {
    const v = metricView(metric({ unit: 'percent', value: 30, absolute_change: 2, relative_change: 7 }))
    expect(v.deltaText).toBe('+2 p.p.')
  })

  it('fără comparație (variații null) nu apare nicio variație', () => {
    const v = metricView(metric({ comparison_value: null, absolute_change: null, relative_change: null }))
    expect(v.deltaText).toBeNull()
    expect(v.deltaDirection).toBeNull()
  })
})

describe('direcția din registru', () => {
  it('higher/lower inversează culoarea; neutral nu colorează', () => {
    expect(isGoodChange('higher_is_better', 'up')).toBe(true)
    expect(isGoodChange('higher_is_better', 'down')).toBe(false)
    expect(isGoodChange('lower_is_better', 'down')).toBe(true)
    expect(isGoodChange('lower_is_better', 'up')).toBe(false)
    expect(isGoodChange('neutral', 'up')).toBeNull()
    expect(isGoodChange('higher_is_better', 'flat')).toBeNull()
  })
})

describe('motive din avertismente', () => {
  it.each([
    ['query_failed', /Sursa nu a răspuns la interogare/],
    ['duplicate_observations', /observații duplicate/],
    ['interval_report_missing', /raportul pe intervalul întreg/],
    ['no_observation', /nicio observație/],
    ['no_confirmed_data', /Nicio zi din interval/],
  ])('unavailable + %s', (code, text) => {
    expect(reasonFor(metric({ status: 'unavailable', value: null, warnings: [warning(code)] }))).toMatch(text)
  })

  it('unavailable fără cod cunoscut spune doar ce se știe', () => {
    expect(reasonFor(metric({ status: 'unavailable', value: null, warnings: [warning('cod_nou')] }))).toBe('Nu există date confirmate pentru interval.')
  })

  it('ok nu are motiv', () => {
    expect(reasonFor(metric())).toBeNull()
  })

  it('notele sunt doar avertismente secundare, fără motivul principal sau codurile interne', () => {
    const m = metric({
      status: 'stale',
      warnings: [warning('stale'), warning('partial'), warning('incomplete_period', { severity: 'info' }), warning('aggregation_label', { severity: 'info', detail: 'medie în perioadă' }), warning('cod_necunoscut')],
    })
    expect(notesFor(m)).toEqual(['Date parțiale.', 'Perioadă incompletă.'])
  })

  it('definiția draft apare cu nota ei', () => {
    expect(notesFor(metric({ warnings: [warning('definition_draft', { severity: 'info', detail: 'Unitatea se confirmă.' })] }))).toEqual(['Definiție provizorie: Unitatea se confirmă.'])
  })
})

describe('sparkPaths', () => {
  it('întrerupe linia la null, nu coboară la zero', () => {
    const { line } = sparkPaths([
      { date: '2026-10-01', value: 1 },
      { date: '2026-10-02', value: 2 },
      { date: '2026-10-03', value: null },
      { date: '2026-10-04', value: 3 },
      { date: '2026-10-05', value: 4 },
    ])
    expect(line.match(/M/g)).toHaveLength(2)
  })
  it('nu desenează nimic fără cel puțin două puncte', () => {
    expect(sparkPaths([{ date: '2026-10-01', value: 1 }]).line).toBe('')
  })
})
