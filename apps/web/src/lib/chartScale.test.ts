import { describe, expect, it } from 'vitest'
import { niceScale } from './chartScale'

describe('niceScale', () => {
  it('o serie constantă la 100% nu dă axa 99–101 cu etichete repetate și nu trece de 100', () => {
    const s = niceScale([100, 100, 100], 'pct')
    expect(s.max).toBe(100)
    expect(s.min).toBeLessThan(100)
    expect(new Set(s.ticks).size).toBe(s.ticks.length)
    expect(s.ticks).toEqual([90, 95, 100])
    expect(s.decimals).toBe(0)
  })

  it('capete și grilă pe valori rotunde care cuprind datele', () => {
    const s = niceScale([12.3, 15.8], 'pct')
    expect(s.min).toBeLessThanOrEqual(12.3)
    expect(s.max).toBeGreaterThanOrEqual(15.8)
    for (const t of s.ticks) expect(Number.isInteger(t / s.step)).toBe(true)
  })

  it('valorile pozitive nu coboară axa sub 0; indicii pot fi negativi', () => {
    expect(niceScale([0, 3], 'int').min).toBe(0)
    expect(niceScale([-5, 5], 'idx').min).toBeLessThan(-5)
  })

  it('pașii fracționari cer zecimale, ca etichetele să rămână distincte', () => {
    const s = niceScale([1, 1.4], 'pct')
    expect(s.decimals).toBeGreaterThan(0)
  })
})
