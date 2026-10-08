import type { PaidKpi, PaidKpiKey, QueryContext } from '../../contracts'
import { StatCard } from '../../components/StatCard'
import { changeDirection, formatAbsoluteChange, formatCurrency, formatInteger, formatMetricValue, formatRange, formatRelativeChange } from '../../lib/format'
import { comparisonRange } from '../../lib/period'

/** Direcția „bună" a variației: costul nu are una (depinde de plan); CPC și CPA mai mici sunt mai bune. */
const GOOD: Record<PaidKpiKey, 'up' | 'down' | 'neutral'> = { spend: 'neutral', impressions: 'up', clicks: 'up', ctr: 'up', cpc: 'down', conversions: 'up', cpa: 'down' }

function valueText(k: PaidKpi): string | null {
  if (k.value === null) return null
  if (k.unit === 'currency') return formatCurrency(k.value, k.currency ?? '', k.key === 'spend' ? 0 : 2)
  if (k.unit === 'percent') return formatMetricValue(k.value, 'percent')
  return formatInteger(k.value)
}

export function PaidKpis({ kpis, ctx }: { kpis: PaidKpi[]; ctx: QueryContext }) {
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="paid-kpis">
      {kpis.map((k) => {
        const change = k.change
        const text = change === null ? null : k.unit === 'percent' ? formatAbsoluteChange(change, 'percent') : formatRelativeChange(change)
        return (
          <StatCard
            key={k.key}
            label={k.label}
            definition={k.definition}
            valueText={valueText(k)}
            deltaText={text}
            deltaDirection={change === null ? null : changeDirection(change)}
            goodWhen={GOOD[k.key]}
            status={k.status}
            note={k.note ?? (k.value === null ? (k.key === 'conversions' || k.key === 'cpa' ? 'Campaniile din filtre nu raportează conversii.' : 'Nicio zi importată în perioada aleasă.') : null)}
            compareLabel={`față de ${formatRange(cmp.from, cmp.to)}`}
          />
        )
      })}
    </div>
  )
}
