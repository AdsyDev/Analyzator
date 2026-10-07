import type { TrendPoint } from '../contracts'

/** Geometria sparkline-ului (viewBox 100x32). Punctele `null` întrerup linia; nu coboară la zero. */
export function sparkPaths(points: readonly TrendPoint[]): { line: string; area: string } {
  const n = points.length
  const nums = points.map((p) => p.value).filter((v): v is number => v !== null)
  if (nums.length < 2) return { line: '', area: '' }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50)
  const y = (v: number) => (max === min ? 16 : 30 - ((v - min) / (max - min)) * 26)

  let line = ''
  let area = ''
  let seg: Array<[number, number]> = []
  const flush = () => {
    if (seg.length > 1) {
      line += seg.map((p, j) => `${j ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ') + ' '
      const first = seg[0]
      const last = seg[seg.length - 1]
      if (first && last) {
        area += `M${first[0].toFixed(2)} 32 ${seg.map((p) => `L${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ')} L${last[0].toFixed(2)} 32 Z `
      }
    }
    seg = []
  }
  points.forEach((p, i) => {
    if (p.value === null) flush()
    else seg.push([x(i), y(p.value)])
  })
  flush()
  return { line: line.trim(), area: area.trim() }
}
