import type { PaidBudget, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import type { AsyncState } from '../../data/useAsync'
import { formatCurrency, formatDate, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

function Bar({ label, valueText, pct, tone }: { label: string; valueText: string; pct: number; tone: 'accent' | 'neutral' }) {
  const width = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="flex-1" />
        <span className="tabular-nums text-text-2">{valueText}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={valueText} className="h-2 overflow-hidden rounded-full bg-neutral-soft">
        <div className={tone === 'accent' ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-c1'} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/**
 * Buget și pacing: spend cumulat față de bugetul aprobat și zilele trecute față de zilele planificate.
 * Progresul liniar e un reper, nu un verdict: cele două procente se arată separat, fără o judecată automată.
 */
export function BudgetSection({ state, onRetry }: { state: AsyncState<ProviderResult<PaidBudget>>; onRetry: () => void }) {
  return (
    <Section id="budget" title="Buget și pacing" description="Spend cumulat față de bugetul aprobat încărcat de agenție. Progresul liniar e un reper, nu un verdict.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă bugetul" skeletonClass="h-32">
        {(b) =>
          b.approved_budget === null ? (
            <EmptyState compact title="Fără buget aprobat" text="Agenția nu a încărcat încă un buget pentru acest interval, deci nu putem arăta pacing-ul." />
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] text-text-2">
                Plan: <span className="font-mono text-[12px] text-text">{formatDate(b.plan_from)} - {formatDate(b.plan_to)}</span>
                {b.plan_note && <> · {b.plan_note}</>}
              </p>
              <Bar
                label="Spend față de buget"
                tone="accent"
                pct={b.spend_pct ?? 0}
                valueText={`${formatCurrency(b.spent, b.currency) ?? 'Fără date'} din ${formatCurrency(b.approved_budget, b.currency)} (${formatMetricValue(b.spend_pct, 'percent') ?? 'Fără date'})`}
              />
              <Bar label="Zile trecute din plan" tone="neutral" pct={b.time_pct} valueText={`${b.elapsed_days} din ${b.planned_days} zile (${formatMetricValue(b.time_pct, 'percent')})`} />
            </div>
          )
        }
      </Resolved>
    </Section>
  )
}
