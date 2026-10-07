import type { TrendSeries } from '../contracts'
import { formatDayMonth } from './format'

export type ChartFormat = 'int' | 'pct' | 'idx'

export interface ChartSeries {
  key: string
  name: string
  color: string
  dashed?: boolean
  /** `null` = zi fără date (gol în linie), nu zero. */
  values: Array<number | null>
}

const PALETTE = ['var(--accent)', 'var(--lav)', 'var(--s3)', 'var(--s4)']

/** Adaptează seriile din provider la grafic. Seriile unui răspuns au aceleași date, în aceeași ordine. */
export function toChartSeries(trends: readonly TrendSeries[]): { labels: string[]; series: ChartSeries[] } {
  const first = trends.find((t) => t.points.length > 0)
  const labels = first ? first.points.map((p) => formatDayMonth(p.date)) : []
  const series = trends.map<ChartSeries>((t, i) => ({
    key: t.metric_key,
    name: t.label,
    color: PALETTE[i % PALETTE.length] ?? 'var(--accent)',
    values: t.points.map((p) => p.value),
  }))
  return { labels, series }
}
