import { ArrowDownRightIcon, ArrowUpRightIcon, ClockIcon, MinusIcon, PlugsIcon, WarningCircleIcon, WarningIcon } from '@phosphor-icons/react'
import type { MetricDirection, MetricResponse, TrendPoint } from '../contracts'
import { formatDate } from '../lib/format'
import { cn } from '../lib/cn'
import { coveragePercent, isGoodChange, metricView, type DeltaDirection } from '../lib/metricView'
import { sourceName } from '../lib/sources'
import { sparkPaths } from '../lib/spark'
import { CoverageBadge } from './CoverageBadge'
import { Button } from './ui/Button'
import { InfoTip } from './ui/InfoTip'

export interface KpiCardProps {
  label: string
  /** Tooltipul „Ce înseamnă", din registrul de metrici. */
  definition: string
  /** `null` cât timp se încarcă. */
  metric: MetricResponse | null
  loading?: boolean
  /** Mesajul unei erori de încărcare; diferit de lipsa sursei. */
  error?: string | null
  spark?: readonly TrendPoint[]
  /** `direction` din registru. `lower_is_better` inversează culorile; `neutral` nu colorează variația. */
  direction?: MetricDirection
  /** `aggregation_label` din registru (de ex. „medie în perioadă"), afișat lângă etichetă. */
  qualifier?: string | null
  compareLabel?: string
  onOpen: () => void
  onRetry?: () => void
}

function deltaTone(dir: DeltaDirection, direction: MetricDirection): string {
  const good = isGoodChange(direction, dir)
  if (good === null) return 'text-text-2'
  return good ? 'text-pos-text' : 'text-neg-text'
}

const DELTA_ICON: Record<DeltaDirection, typeof ArrowUpRightIcon> = {
  up: ArrowUpRightIcon,
  down: ArrowDownRightIcon,
  flat: MinusIcon,
}

export function KpiCard({ label, definition, metric, loading = false, error = null, spark, direction = 'higher_is_better', qualifier = null, compareLabel, onOpen, onRetry }: KpiCardProps) {
  const view = metric ? metricView(metric) : null
  const paths = spark ? sparkPaths(spark) : { line: '', area: '' }
  const state = loading ? 'loading' : error ? 'error' : 'ready'

  return (
    <article
      aria-label={label}
      data-state={state}
      data-status={metric?.status}
      className="group relative flex h-full flex-col gap-3 rounded-xl border border-border bg-surface px-4 pb-3 pt-4 shadow-1 transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-2"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Deschide dovezile pentru ${label}`}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2"
      />
      <div className="pointer-events-none relative flex min-h-5 items-center gap-1.5">
        <span className="text-[13px] font-semibold leading-snug text-text-2">{label}</span>
        {qualifier && <span className="text-[11.5px] leading-snug text-text-3">{qualifier}</span>}
        <span className="pointer-events-auto relative z-10">
          <InfoTip>{definition}</InfoTip>
        </span>
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col gap-3">
        {state === 'loading' && (
          <div role="status" aria-label="Se încarcă" className="flex flex-1 flex-col gap-2.5">
            <div className="h-8 w-1/2 rounded-md bg-skeleton" />
            <div className="h-3 w-2/5 rounded bg-skeleton" />
            <div className="h-[34px] w-full rounded-md bg-skeleton" />
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-1 flex-col justify-center gap-2">
            <div className="flex items-center gap-2 font-display text-[15px] font-semibold text-text">
              <WarningCircleIcon size={18} className="text-neg-text" aria-hidden="true" />
              Nu am putut încărca datele
            </div>
            <p className="text-[13px] leading-snug text-text-2">{error}</p>
            {onRetry && (
              <span className="pointer-events-auto relative z-10 self-start">
                <Button onClick={onRetry}>Reîncearcă</Button>
              </span>
            )}
          </div>
        )}

        {state === 'ready' && view && !view.hasValue && (
          <div className="flex flex-1 flex-col justify-center gap-1.5 py-1">
            <div className="flex items-center gap-2 font-display text-[15px] font-semibold text-text">
              <PlugsIcon size={18} className="text-text-2" aria-hidden="true" />
              {view.emptyTitle}
            </div>
            {view.emptyReason && <p className="text-[13px] leading-snug text-text-2">{view.emptyReason}</p>}
            {view.notes.map((n) => (
              <p key={n} className="text-[12px] leading-snug text-text-2">{n}</p>
            ))}
          </div>
        )}

        {state === 'ready' && view?.hasValue && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <span className="font-display text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-text">{view.valueText}</span>
                {view.deltaText && view.deltaDirection && (() => {
                  const Icon = DELTA_ICON[view.deltaDirection]
                  return (
                    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-semibold leading-none tabular-nums', deltaTone(view.deltaDirection, direction))}>
                      <Icon size={12} weight="bold" aria-hidden="true" />
                      {view.deltaText}
                    </span>
                  )
                })()}
              </div>
              {compareLabel && view.deltaText && <span className="text-[12px] leading-tight text-text-2">{compareLabel}</span>}
            </div>
            {paths.line && (
              <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true" className="block h-[34px] w-full overflow-visible">
                <path d={paths.area} className="fill-accent opacity-[0.08]" />
                <path d={paths.line} vectorEffect="non-scaling-stroke" className="fill-none stroke-accent" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            )}
            {view.caveat && (
              <div
                className={cn(
                  'flex items-start gap-1.5 text-[12px] leading-snug',
                  metric?.status === 'stale' || metric?.status === 'base_zero' ? 'text-text-2' : 'text-warn-text',
                )}
              >
                {metric?.status === 'stale' ? <ClockIcon size={13} className="mt-px flex-none" aria-hidden="true" /> : <WarningIcon size={13} className="mt-px flex-none" aria-hidden="true" />}
                <span>{view.caveat}</span>
              </div>
            )}
            {view.notes.map((n) => (
              <p key={n} className="text-[12px] leading-snug text-text-2">{n}</p>
            ))}
          </>
        )}
      </div>

      <div className="pointer-events-none relative mt-auto flex min-w-0 items-center gap-2 whitespace-nowrap border-t border-border pt-2.5 text-[11.5px] text-text-2">
        {metric?.source && <span className="flex-none font-semibold text-text">{sourceName(metric.source)}</span>}
        {metric?.data_as_of && (
          <span className="min-w-0 overflow-hidden text-ellipsis">
            Date până la <span className="font-mono text-[11px]">{formatDate(metric.data_as_of)}</span>
          </span>
        )}
        <span className="flex-1" />
        {state === 'ready' && view && <CoverageBadge state={view.coverage} pct={coveragePercent(metric?.coverage ?? null)} />}
      </div>
    </article>
  )
}
