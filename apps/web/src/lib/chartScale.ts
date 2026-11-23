import type { ChartFormat } from './chartData'

export interface ChartScale {
  min: number
  max: number
  /** Valorile liniilor de grilă, de jos în sus, toate multipli de `step`. */
  ticks: number[]
  step: number
  /** Zecimalele necesare ca etichetele axei să fie distincte (0 pentru pași întregi). */
  decimals: number
}

/** Pasul „rotund” cel mai apropiat: 1, 2, 2,5 sau 5 × 10^k. */
function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw))
  const base = 10 ** exp
  const f = raw / base
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nice * base
}

/**
 * Axa verticală a unui grafic: capete și grilă pe valori rotunde, cu puțin spațiu în jurul datelor. Nu e o formulă de
 * metrică: doar alege unde se desenează liniile. O serie constantă primește o fereastră de ±10% (minimum 1), ca linia
 * să nu stea pe o axă de 99–101 cu etichete repetate. Seriile fără valori negative nu coboară axa sub 0, iar
 * procentele din 0–100 nu o urcă peste 100.
 */
export function niceScale(values: readonly number[], format: ChartFormat, targetTicks = 4): ChartScale {
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1
  let lo = dataMin
  let hi = dataMax
  if (lo === hi) {
    const d = Math.abs(lo) * 0.1 || 1
    lo -= d
    hi += d
  } else {
    const pad = (hi - lo) * 0.08
    lo -= pad
    hi += pad
  }
  if (dataMin >= 0 && lo < 0) lo = 0
  if (format === 'pct' && dataMax <= 100 && hi > 100) hi = 100

  const step = niceStep((hi - lo) / (targetTicks - 1))
  const round = (v: number) => Number(v.toFixed(10))
  const min = round(Math.floor(lo / step) * step)
  const max = round(Math.ceil(hi / step) * step)
  const ticks: number[] = []
  for (let k = 0; min + k * step <= max + step / 1e6; k++) ticks.push(round(min + k * step))
  let decimals = 0
  while (decimals < 3 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-9) decimals++
  return { min, max, ticks, step, decimals }
}
