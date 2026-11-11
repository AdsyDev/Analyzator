import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon, type Icon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { MetricStatus } from '../contracts'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import { InfoTip } from './ui/InfoTip'

export interface KpiTileProps {
  icon: Icon
  /** Întrebarea la care răspunde cardul, cu formularea din machetă (de ex. „Trafic organic”). */
  title: string
  /** Numele exact al indicatorului (din registru, unde există); apare sub titlu și e numele accesibil al cardului. */
  label: string
  /** Definiția din tooltip. */
  definition: string
  /** Valoarea deja formatată; `null` = lipsă, nu zero. */
  valueText: string | null
  deltaText?: string | null
  deltaDirection?: 'up' | 'down' | 'flat' | null
  /** `true` = variație favorabilă, `false` = nefavorabilă, `null` = fără direcție „bună”. */
  deltaGood?: boolean | null
  /** Rândul de sub valoare: cu ce se compară sau din ce e compusă cifra. */
  sub?: string | null
  /** Avertismentul stării (parțial, învechit, eșantion mic). */
  caveat?: string | null
  state: 'loading' | 'error' | 'ready'
  status?: MetricStatus
  error?: string | null
  /** Titlul și motivul stării fără valoare. */
  emptyTitle?: string | null
  emptyReason?: string | null
  /** Deschide dovezile indicatorului; fără el, cardul nu e apăsabil. */
  onOpen?: () => void
  onRetry?: () => void
  /** Legătura spre modulul de detaliu. */
  detail?: ReactNode
}

const DELTA_ICON = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: MinusIcon }

/**
 * Indicator compact pentru primul rând din Overview (macheta din propunere): pictogramă, nume, valoare și variație.
 * Aceleași reguli ca la KpiCard: o valoare lipsă e explicată, nu înlocuită cu zero; starea datelor rămâne vizibilă;
 * tot cardul deschide dovezile, iar definiția stă în tooltip.
 */
export function KpiTile({ icon: Glyph, title, label, definition, valueText, deltaText, deltaDirection, deltaGood = null, sub, caveat, state, status, error, emptyTitle, emptyReason, onOpen, onRetry, detail }: KpiTileProps) {
  const DeltaIcon = deltaDirection ? DELTA_ICON[deltaDirection] : null
  return (
    <article
      aria-label={label}
      data-state={state}
      data-status={status}
      className={cn('group relative flex h-full min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 pb-3 pt-3.5 shadow-1', onOpen && 'transition-colors hover:border-border-strong')}
    >
      {onOpen && <button type="button" onClick={onOpen} aria-label={`Deschide dovezile pentru ${label}`} className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2" />}
      <div className="pointer-events-none relative flex items-start gap-2">
        <Glyph size={18} aria-hidden="true" className="mt-px flex-none text-accent-text" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12.5px] font-semibold leading-snug">{title}</span>
          {label !== title && <span className="text-[11px] leading-snug text-text-3">{label}</span>}
        </span>
        <span className="pointer-events-auto relative z-10 flex-none">
          <InfoTip>{definition}</InfoTip>
        </span>
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col gap-1">
        {state === 'loading' && (
          <div role="status" aria-label="Se încarcă" className="flex flex-col gap-2">
            <div className="h-7 w-2/3 rounded-md bg-skeleton" />
            <div className="h-3 w-1/2 rounded bg-skeleton" />
          </div>
        )}
        {state === 'error' && (
          <>
            <p className="font-display text-[14px] font-semibold">Nu am putut încărca datele</p>
            {error && <p className="text-[12px] leading-snug text-text-2">{error}</p>}
            {onRetry && (
              <span className="pointer-events-auto relative z-10 self-start">
                <Button onClick={onRetry}>Reîncearcă</Button>
              </span>
            )}
          </>
        )}
        {state === 'ready' && valueText === null && (
          <>
            <p className="font-display text-[14px] font-semibold leading-snug">{emptyTitle ?? 'Fără date pentru interval'}</p>
            {emptyReason && <p className="text-[12px] leading-snug text-text-2">{emptyReason}</p>}
          </>
        )}
        {state === 'ready' && valueText !== null && (
          <>
            <p className="font-display text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{valueText}</p>
            {deltaText && DeltaIcon && (
              <p className={cn('inline-flex items-center gap-0.5 text-[12.5px] font-semibold tabular-nums', deltaGood === true ? 'text-pos-text' : deltaGood === false ? 'text-neg-text' : 'text-text-2')}>
                <DeltaIcon size={12} weight="bold" aria-hidden="true" />
                {deltaText}
              </p>
            )}
            {sub && <p className="text-[11.5px] leading-snug text-text-2">{sub}</p>}
            {caveat && <p className="text-[11.5px] leading-snug text-warn-text">{caveat}</p>}
          </>
        )}
      </div>
      {detail && <div className="pointer-events-auto relative z-10 mt-auto">{detail}</div>}
    </article>
  )
}
