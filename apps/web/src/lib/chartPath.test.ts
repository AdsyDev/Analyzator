import { describe, expect, it } from 'vitest'
import { continuousRuns, linePath } from './chartPath'

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)

describe('chartPath', () => {
  it('linia dreaptă leagă punctele în ordine', () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 100, y: 0 }, { x: 200, y: 5 }], false)).toBe('M0.0 10.0 L100.0 0.0 L200.0 5.0')
  })

  it('un singur punct e doar o mutare; fără puncte nu există traseu', () => {
    expect(linePath([{ x: 5, y: 7 }], true)).toBe('M5.0 7.0')
    expect(linePath([], true)).toBe('')
  })

  it('curba netedă trece prin fiecare punct și nu iese din intervalul valorilor', () => {
    const pts = [{ x: 0, y: 50 }, { x: 100, y: 10 }, { x: 200, y: 90 }, { x: 300, y: 90 }, { x: 400, y: 20 }]
    const d = linePath(pts, true)
    // Fiecare segment se termină exact în punctul următor.
    const ends = d.split(' C').slice(1).map((s) => numbers(s).slice(4))
    expect(ends).toEqual(pts.slice(1).map((p) => [p.x, p.y]))
    // Punctele de control rămân între minimul și maximul seriei: fără vârfuri inventate.
    const ys = d.split(' C').slice(1).flatMap((s) => { const v = numbers(s); return [v[1]!, v[3]!] })
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...ys)).toBeLessThanOrEqual(90)
  })

  it('porțiunile continue se rup la null, care nu e tratat ca zero', () => {
    expect(continuousRuns([1, 2, null, 0, undefined, 5])).toEqual([[0, 1], [3], [5]])
    expect(continuousRuns([null, null])).toEqual([])
  })
})
