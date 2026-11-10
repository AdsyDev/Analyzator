import type { QueryContext, TrendSeries } from '../../contracts'
import { TrendChart } from '../../components/TrendChart'
import type { AsyncState } from '../../data/useAsync'
import { toChartSeries, type ChartFormat, type ChartSeries } from '../../lib/chartData'
import { formatRange } from '../../lib/format'
import { trendReason } from '../../lib/warnings'
import { Section } from '../shared/Section'
import { TREND_SLOTS } from './slots'

const FORMAT: Record<string, ChartFormat> = { count: 'int', percent: 'pct' }

interface Props {
  ctx: QueryContext
  trends: AsyncState<TrendSeries[]>
  labels: Map<string, string>
  onRetry: () => void
}

/**
 * „Evoluția brandului" (propunerea din 10 nov. 2026): patru grafice pe aceeași perioadă, pentru AI, search, trafic
 * și mențiuni. Fiecare are scara și unitatea ei; nu se suprapun scări diferite într-o singură curbă și nu se
 * normalizează nimic în UI (regula 4). Linia punctată e perioada de comparație; zilele fără date rămân goluri.
 */
export function TrendSection({ ctx, trends, labels, onRetry }: Props) {
  return (
    <Section
      id="trend"
      title="Evoluția brandului"
      description={`Aceeași perioadă pentru toate graficele: ${formatRange(ctx.period.from, ctx.period.to)}. Fiecare grafic își păstrează scara; linia punctată e perioada de comparație.`}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
        {TREND_SLOTS.map((slot) => {
          const series = trends.status === 'done' ? trends.value.find((t) => t.metric_key === slot.key) : undefined
          let chart: { labels: string[]; series: ChartSeries[] } = { labels: [], series: [] }
          if (series) {
            const main = toChartSeries([series])
            chart = { labels: main.labels, series: main.series.map((s) => ({ ...s, name: labels.get(series.metric_key) ?? s.name })) }
            if (series.comparison_points) {
              chart.series.push({ key: `${series.metric_key}:cmp`, name: 'Perioada de comparație', color: 'var(--c1)', dashed: true, values: series.comparison_points.map((p) => p.value) })
            }
          }
          const hasGaps = !!series?.points.some((p) => p.value === null) && series.points.some((p) => p.value !== null)
          const title = labels.get(slot.key) ?? slot.tab
          return (
            <div key={slot.key} className="flex min-w-0 flex-col gap-2" data-testid={`trend-${slot.key}`}>
              <h3 className="text-[13px] font-semibold text-text">
                <span className="text-text-3">{slot.tab}</span> · {title}
              </h3>
              <TrendChart
                title={`Evoluție: ${title}`}
                labels={chart.labels}
                series={chart.series}
                height={170}
                format={series ? (FORMAT[series.unit] ?? 'idx') : 'int'}
                loading={trends.status === 'loading'}
                error={trends.status === 'failed' ? trends.message : null}
                onRetry={onRetry}
                unavailableReason={series ? trendReason(series.status) : trends.status === 'done' ? 'Seria nu a venit de la server pentru acest interval.' : null}
                note={hasGaps ? 'Zilele fără date apar hașurate; nu sunt zero.' : undefined}
              />
            </div>
          )
        })}
      </div>
    </Section>
  )
}
