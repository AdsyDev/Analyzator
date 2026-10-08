import type { TrendPoint, TrendSeries } from '../../contracts'
import type { AsyncState } from '../../data/useAsync'

/** Punctele sparkline-ului unui card, din seria aceleiași metrici; `undefined` cât timp seria nu e disponibilă. */
export function sparkPoints(trends: AsyncState<TrendSeries[]>, key: string): TrendPoint[] | undefined {
  if (trends.status !== 'done') return undefined
  return trends.value.find((s) => s.metric_key === key)?.points
}
