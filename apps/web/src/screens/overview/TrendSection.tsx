import { useState } from 'react'
import type { TrendSeries } from '../../contracts'
import { Tabs } from '../../components/ui/Tabs'
import { TrendChart } from '../../components/TrendChart'
import type { AsyncState } from '../../data/useAsync'
import { toChartSeries, type ChartFormat, type ChartSeries } from '../../lib/chartData'
import { trendReason } from '../../lib/warnings'
import { Section } from './Section'
import { TREND_SLOTS } from './slots'

const FORMAT: Record<string, ChartFormat> = { count: 'int', percent: 'pct' }

interface Props {
  trends: AsyncState<TrendSeries[]>
  labels: Map<string, string>
  onRetry: () => void
}

/**
 * Evoluția celor patru serii (AI, search, trafic, mențiuni), una câte una: fiecare are unitatea ei, deci nu
 * se pun pe aceeași axă și nu se normalizează în UI (regula 4). Linia punctată e perioada de comparație.
 */
export function TrendSection({ trends, labels, onRetry }: Props) {
  const [tab, setTab] = useState(TREND_SLOTS[0]?.key ?? '')
  const slot = TREND_SLOTS.find((s) => s.key === tab) ?? TREND_SLOTS[0]
  const series = trends.status === 'done' ? trends.value.find((t) => t.metric_key === tab) : undefined

  let chart: { labels: string[]; series: ChartSeries[] } = { labels: [], series: [] }
  if (series) {
    const main = toChartSeries([series])
    chart = { labels: main.labels, series: main.series.map((s) => ({ ...s, name: labels.get(series.metric_key) ?? s.name })) }
    if (series.comparison_points) {
      chart.series.push({ key: `${series.metric_key}:cmp`, name: 'Perioada de comparație', color: 'var(--c1)', dashed: true, values: series.comparison_points.map((p) => p.value) })
    }
  }
  const hasGaps = !!series?.points.some((p) => p.value === null) && series.points.some((p) => p.value !== null)
  const title = labels.get(tab) ?? slot?.tab ?? ''

  return (
    <Section id="trend" title="Evoluție" description="Fiecare serie își păstrează unitatea. Apasă pe un tab ca să schimbi seria; linia punctată e perioada de comparație.">
      <Tabs label="Seria afișată" value={tab} onChange={setTab} items={TREND_SLOTS.map((s) => ({ id: s.key, label: s.tab }))} />
      <TrendChart
        key={tab}
        title={`Evoluție: ${title}`}
        labels={chart.labels}
        series={chart.series}
        format={series ? (FORMAT[series.unit] ?? 'idx') : 'int'}
        loading={trends.status === 'loading'}
        error={trends.status === 'failed' ? trends.message : null}
        onRetry={onRetry}
        unavailableReason={series ? trendReason(series.status) : null}
        note={hasGaps ? 'Zilele fără date apar hașurate; nu sunt zero.' : undefined}
      />
    </Section>
  )
}
