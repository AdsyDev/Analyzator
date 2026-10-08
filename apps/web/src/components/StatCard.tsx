import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon, PlugsIcon, WarningIcon } from '@phosphor-icons/react'
import type { MetricStatus } from '../contracts'
import { cn } from '../lib/cn'
import { CoverageBadge } from './CoverageBadge'
import { InfoTip } from './ui/InfoTip'
import { coverageStateFor } from '../lib/metricView'

export interface StatCardProps {
  label: string
  /** Definiția din tooltip: fiecare card își arată definiția (spec cap. 15). */
  definition: string
  /** Valoarea deja formatată de apelant (monedă, număr, procent); `null` = lipsă, nu zero. */
  valueText: string | null
  /** Variația deja formatată, cu direcția ei. */
  deltaText?: string | null
  deltaDirection?: 'up' | 'down' | 'flat' | null
  /** Direcția „bună" pentru culoarea variației; `neutral` (implicit) nu colorează. */
  goodWhen?: 'up' | 'down' | 'neutral'
  status: MetricStatus
  note?: string | null
  compareLabel?: string
  loading?: boolean
}

const ICON = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: MinusIcon }

/**
 * Card pentru indicatori care nu sunt metrici din registru (Paid, Social): date importate, calculate de server.
 * Nu are EvidenceDrawer; arată definiția, valoarea sau lipsa explicată, variația și starea.
 */
export function StatCard({ label, definition, valueText, deltaText = null, deltaDirection = null, goodWhen = 'neutral', status, note = null, compareLabel, loading = false }: StatCardProps) {
  const empty = valueText === null
  const tone =
    !deltaDirection || deltaDirection === 'flat' || goodWhen === 'neutral' ? 'text-text-2' : (deltaDirection === goodWhen ? 'text-pos-text' : 'text-neg-text')
  const Icon = deltaDirection ? ICON[deltaDirection] : null

  return (
    <article aria-label={label} data-status={status} className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface px-4 pb-3 pt-4 shadow-1">
      <div className="flex min-h-5 items-center gap-1.5">
        <span className="text-[13px] font-semibold leading-snug text-text-2">{label}</span>
        <InfoTip>{definition}</InfoTip>
      </div>
      {loading ? (
        <div role="status" aria-label="Se încarcă" className="flex flex-1 flex-col gap-2.5">
          <div className="h-8 w-1/2 rounded-md bg-skeleton" />
          <div className="h-3 w-2/5 rounded bg-skeleton" />
        </div>
      ) : empty ? (
        <div className="flex flex-1 flex-col justify-center gap-1.5 py-1">
          <div className="flex items-center gap-2 font-display text-[15px] font-semibold">
            <PlugsIcon size={18} className="text-text-2" aria-hidden="true" />
            Fără date pentru interval
          </div>
          {note && <p className="text-[13px] leading-snug text-text-2">{note}</p>}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{valueText}</span>
            {deltaText && Icon && (
              <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-[13px] font-semibold leading-none tabular-nums', tone)}>
                <Icon size={12} weight="bold" aria-hidden="true" />
                {deltaText}
              </span>
            )}
          </div>
          {compareLabel && deltaText && <span className="text-[12px] leading-tight text-text-2">{compareLabel}</span>}
          {note && (
            <p className="flex items-start gap-1.5 text-[12px] leading-snug text-text-2">
              {status === 'partial' && <WarningIcon size={13} className="mt-px flex-none text-warn-text" aria-hidden="true" />}
              <span>{note}</span>
            </p>
          )}
        </div>
      )}
      <div className="mt-auto flex items-center border-t border-border pt-2.5">
        <span className="flex-1" />
        <CoverageBadge state={coverageStateFor(status)} />
      </div>
    </article>
  )
}
