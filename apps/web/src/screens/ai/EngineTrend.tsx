import type { AiEngineTrend, ProviderResult } from '../../contracts'
import { TrendChart } from '../../components/TrendChart'
import type { AsyncState } from '../../data/useAsync'
import type { ChartSeries } from '../../lib/chartData'
import { formatDayMonth } from '../../lib/format'
import { AI_ENGINE_LABELS } from '../../lib/ai'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const COLORS = ['var(--accent)', 'var(--lav)', 'var(--s3)', 'var(--s4)']

interface Props {
  state: AsyncState<ProviderResult<AiEngineTrend[]>>
  onRetry: () => void
}

/** Serii separate pe engine (spec cap. 13). Zilele necolectate sunt goluri în linie, nu zero. */
export function EngineTrend({ state, onRetry }: Props) {
  return (
    <Section id="engine-trend" title="Trenduri pe engine" description="Mention Rate zilnic, pe engine. Zilele fără răspunsuri colectate apar ca gol în linie.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă trendurile" skeletonClass="h-60">
        {(trends) => {
          const withData = trends.filter((t) => t.points.length > 0)
          const labels = (withData[0]?.points ?? []).map((p) => formatDayMonth(p.date))
          const series: ChartSeries[] = withData.map((t, i) => ({ key: t.engine, name: AI_ENGINE_LABELS[t.engine], color: COLORS[i % COLORS.length] ?? 'var(--accent)', values: t.points.map((p) => p.value) }))
          return <TrendChart title="Mention Rate pe engine" labels={labels} series={series} format="pct" note={withData.length < trends.length ? 'Engine-urile fără răspunsuri valide în perioadă nu apar în grafic.' : undefined} />
        }}
      </Resolved>
    </Section>
  )
}
