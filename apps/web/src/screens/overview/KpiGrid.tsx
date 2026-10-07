import type { MetricDefinition, MetricsBundle, TrendSeries } from '../../contracts'
import { KpiCard } from '../../components/KpiCard'
import type { AsyncState } from '../../data/useAsync'
import { formatRange } from '../../lib/format'
import { sparkPoints } from './sparks'
import { KPI_SLOTS, MISSING_DEFINITION } from './slots'
import type { EvidenceTarget } from './EvidenceHost'

interface Props {
  metrics: AsyncState<MetricsBundle>
  definitions: Map<string, MetricDefinition>
  trends: AsyncState<TrendSeries[]>
  onRetry: () => void
  onOpen: (target: EvidenceTarget) => void
}

/** Cele 6 KpiCards. Fiecare slot își păstrează starea: lipsa unei definiții sau a unei serii nu blochează cardul. */
export function KpiGrid({ metrics, definitions, trends, onRetry, onOpen }: Props) {
  const items = metrics.status === 'done' ? metrics.value.items : []
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="kpi-grid">
      {KPI_SLOTS.map((slot) => {
        const item = items.find((i) => i.metric_key === slot.key) ?? null
        const def = definitions.get(slot.key) ?? null
        const label = def?.label ?? slot.label
        const cmp = item?.evidence_query.comparison_period
        return (
          <KpiCard
            key={slot.key}
            label={label}
            definition={def?.formula ?? MISSING_DEFINITION}
            metric={item}
            loading={metrics.status === 'loading'}
            error={metrics.status === 'failed' ? metrics.message : null}
            spark={sparkPoints(trends, slot.key)}
            direction={def?.direction ?? 'neutral'}
            qualifier={def?.aggregation_label ?? null}
            compareLabel={cmp ? `față de ${formatRange(cmp.start, cmp.end)}` : undefined}
            onOpen={() => item && onOpen({ page: 'Overview', label, query: item.evidence_query, item, definition: def })}
            onRetry={onRetry}
          />
        )
      })}
    </div>
  )
}
