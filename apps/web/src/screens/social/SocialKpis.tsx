import type { QueryContext, SocialKpi } from '../../contracts'
import { StatCard } from '../../components/StatCard'
import { changeDirection, formatInteger, formatRange, formatRelativeChange } from '../../lib/format'
import { comparisonRange } from '../../lib/period'

export function SocialKpis({ kpis, ctx }: { kpis: SocialKpi[]; ctx: QueryContext }) {
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5" data-testid="social-kpis">
      {kpis.map((k) => (
        <StatCard
          key={k.key}
          label={k.label}
          definition={k.definition}
          valueText={k.value === null ? null : (k.key === 'net_growth' && k.value > 0 ? '+' : '') + formatInteger(k.value)}
          deltaText={k.change === null ? null : formatRelativeChange(k.change)}
          deltaDirection={k.change === null ? null : changeDirection(k.change)}
          goodWhen="up"
          status={k.status}
          note={k.note}
          compareLabel={`față de ${formatRange(cmp.from, cmp.to)}`}
        />
      ))}
    </div>
  )
}
