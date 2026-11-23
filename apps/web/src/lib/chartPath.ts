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

/**
 * Porțiunile continue ale unei serii: indicii cu valoare aflați la cel mult `maxStep` poziții unul de altul. Pe o serie
 * zilnică (`maxStep = 1`) orice `null` întrerupe linia; pe o serie colectată săptămânal, zilele dintre două colectări nu
 * sunt lipsă, deci linia unește colectările consecutive și se rupe doar când lipsește o colectare. Niciodată nu coboară
 * la zero.
 */
export function continuousRuns(values: ReadonlyArray<number | null | undefined>, maxStep = 1): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  values.forEach((v, i) => {
    if (v === null || v === undefined) return
    const prev = run[run.length - 1]
    if (prev !== undefined && i - prev > maxStep) {
      runs.push(run)
      run = []
    }
    run.push(i)
  })
  if (run.length) runs.push(run)
  return runs
}

const observedIdx = (values: ReadonlyArray<number | null | undefined>) => values.flatMap((v, i) => (v === null || v === undefined ? [] : [i]))

/**
 * Distanța maximă, în zile, dintre două valori ale aceleiași serii unite de linie. Ritmul seriei e mediana (inferioară)
 * distanțelor dintre valorile ei, plafonată la `cadenceDays` (ritmul declarat al sursei); fără două valori, e chiar
 * `cadenceDays`. Toleranța de 50% lasă o colectare întârziată să nu rupă linia. Astfel, pe același grafic, un engine
 * colectat zilnic se rupe la prima zi lipsă, iar unul săptămânal doar când lipsește o săptămână. `cadenceDays = 1`
 * (seriile zilnice) dă mereu 1.
 */
export function seriesMaxStep(values: ReadonlyArray<number | null | undefined>, cadenceDays: number): number {
  if (cadenceDays <= 1) return 1
  const idx = observedIdx(values)
  const diffs = idx.slice(1).map((v, k) => v - idx[k]!).sort((a, b) => a - b)
  const cadence = diffs.length ? Math.min(cadenceDays, diffs[Math.floor((diffs.length - 1) / 2)]!) : cadenceDays
  return cadence > 1 ? Math.ceil(cadence * 1.5) : 1
}

/**
 * Zilele pe care o serie le acoperă: zilele cu valoare, zilele dintre două valori aflate la cel mult `maxStep` una de
 * alta și capetele perioadei mai scurte decât `maxStep` (colectarea următoare încă nu era datorată). Restul sunt goluri.
 */
export function coveredDays(values: ReadonlyArray<number | null | undefined>, maxStep: number): boolean[] {
  const n = values.length
  const cov = new Array<boolean>(n).fill(false)
  const idx = observedIdx(values)
  if (idx.length === 0) return cov
  const fill = (from: number, to: number) => {
    for (let i = Math.max(0, from); i <= Math.min(n - 1, to); i++) cov[i] = true
  }
  for (const i of idx) cov[i] = true
  const first = idx[0]!
  const last = idx[idx.length - 1]!
  if (first < maxStep) fill(0, first)
  for (let k = 0; k < idx.length - 1; k++) if (idx[k + 1]! - idx[k]! <= maxStep) fill(idx[k]!, idx[k + 1]!)
  if (n - 1 - last < maxStep) fill(last, n - 1)
  return cov
}
