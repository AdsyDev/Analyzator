import type { Brand, MetricItem, QueryContext } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import { formatDate, formatRange } from '../../lib/format'
import { comparisonRange } from '../../lib/period'
import { metricView, type CoverageState } from '../../lib/metricView'

const ORDER: CoverageState[] = ['complete', 'partial', 'stale', 'unavailable']

/**
 * Bara de context (spec cap. 12): brand, țară, perioadă, comparație, „Date până la" și acoperirea
 * indicatorilor. Datele vin din metricile cerute; fiecare card își păstrează propriul `data_as_of`.
 */
export function ContextBar({ brand, ctx, items }: { brand: Brand; ctx: QueryContext; items: MetricItem[] | null }) {
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  const counts = new Map<CoverageState, number>()
  for (const i of items ?? []) {
    const c = metricView(i).coverage
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  const dates = (items ?? []).map((i) => i.data_as_of).filter((d): d is string => !!d).sort()
  const oldest = dates[0] ?? null

  return (
    <section aria-label="Context" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px] text-text-2 shadow-1">
      <span>
        Brand <strong className="font-semibold text-text">{brand.name}</strong>
      </span>
      <span>
        Țară <strong className="font-semibold text-text">România</strong>
      </span>
      <span>
        Perioadă <span className="font-mono text-[12px] text-text">{formatRange(ctx.period.from, ctx.period.to)}</span>
      </span>
      <span>
        Comparație <span className="font-mono text-[12px] text-text">{formatRange(cmp.from, cmp.to)}</span>
      </span>
      {oldest && (
        <span>
          Cele mai vechi date <span className="font-mono text-[12px] text-text">{formatDate(oldest)}</span>
        </span>
      )}
      <span className="flex-1" />
      <span className="flex flex-wrap items-center gap-2" aria-label="Acoperirea indicatorilor">
        <span className="font-semibold">Acoperirea indicatorilor</span>
        {items === null ? (
          <span className="h-5 w-24 rounded bg-skeleton" role="status" aria-label="Se încarcă acoperirea" />
        ) : (
          ORDER.filter((s) => counts.has(s)).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <CoverageBadge state={s} />
              <span className="font-mono text-[12px] text-text" data-testid={`cov-${s}`}>{counts.get(s)}</span>
            </span>
          ))
        )}
      </span>
    </section>
  )
}
