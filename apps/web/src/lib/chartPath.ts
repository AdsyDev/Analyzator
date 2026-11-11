export interface PathPoint {
  x: number
  y: number
}

const f = (n: number) => n.toFixed(1)

/**
 * Traseul SVG al unei porțiuni continue de puncte. `smooth` desenează o curbă monotonă: trece prin fiecare punct și nu
 * urcă sau coboară dincolo de valorile vecine, deci nu sugerează vârfuri pe care datele nu le au.
 */
export function linePath(points: readonly PathPoint[], smooth: boolean): string {
  if (points.length === 0) return ''
  const first = points[0]!
  if (points.length === 1) return `M${f(first.x)} ${f(first.y)}`
  if (!smooth) return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join(' ')

  const n = points.length
  const h: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1]!.x - points[i]!.x)
    slope.push(h[i] === 0 ? 0 : (points[i + 1]!.y - points[i]!.y) / h[i]!)
  }
  // Tangenta în fiecare punct: zero la un extrem local, altfel media armonică ponderată a pantelor vecine.
  const t: number[] = [slope[0]!]
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!
    const b = slope[i]!
    if (a * b <= 0) t.push(0)
    else t.push((3 * (h[i - 1]! + h[i]!)) / ((2 * h[i]! + h[i - 1]!) / a + (h[i]! + 2 * h[i - 1]!) / b))
  }
  t.push(slope[n - 2]!)

  let d = `M${f(first.x)} ${f(first.y)}`
  for (let i = 0; i < n - 1; i++) {
    const p = points[i]!
    const q = points[i + 1]!
    const third = h[i]! / 3
    d += ` C${f(p.x + third)} ${f(p.y + t[i]! * third)} ${f(q.x - third)} ${f(q.y - t[i + 1]! * third)} ${f(q.x)} ${f(q.y)}`
  }
  return d
}

/** Porțiunile continue ale unei serii: indicii consecutivi cu valoare. Un `null` întrerupe linia, nu o coboară la zero. */
export function continuousRuns(values: ReadonlyArray<number | null | undefined>): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) {
      if (run.length) runs.push(run)
      run = []
    } else run.push(i)
  })
  if (run.length) runs.push(run)
  return runs
}
