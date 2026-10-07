import { CheckCircleIcon, ClockIcon, CircleHalfIcon, PlugsIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { SourceProviderId, SourceState, SourceStatusInfo } from '../contracts'
import { formatDate, formatDateTime } from '../lib/format'
import { PROVIDER_LABELS } from '../lib/sources'
import { StatusChip, type ChipTone } from './ui/Chip'
import { Button } from './ui/Button'

const STATE: Record<SourceState, { label: string; tone: ChipTone; icon: ReactNode }> = {
  connected: { label: 'Conectat', tone: 'pos', icon: <CheckCircleIcon size={11} weight="bold" aria-hidden="true" /> },
  partial: { label: 'Parțial', tone: 'warn', icon: <CircleHalfIcon size={11} weight="bold" aria-hidden="true" /> },
  stale: { label: 'Învechit', tone: 'neutral', icon: <ClockIcon size={11} weight="bold" aria-hidden="true" /> },
  error: { label: 'Eroare', tone: 'neg', icon: <WarningCircleIcon size={11} weight="bold" aria-hidden="true" /> },
  not_connected: { label: 'Neconectat', tone: 'neutral', icon: <PlugsIcon size={11} weight="bold" aria-hidden="true" /> },
}

export type SourceAction = 'retry' | 'reconnect' | 'connect'

interface SourceStatusProps {
  info: SourceStatusInfo
  /** Acțiunile pe sursă apar doar pentru agenție. */
  canManage?: boolean
  onAction?: (action: SourceAction, provider: SourceProviderId) => void
}

export function SourceStatus({ info, canManage = false, onAction }: SourceStatusProps) {
  const { name, mono } = PROVIDER_LABELS[info.provider]
  const st = STATE[info.state]
  const actions: Array<{ id: SourceAction; label: string; primary?: boolean }> =
    info.state === 'not_connected'
      ? [{ id: 'connect', label: 'Conectează', primary: true }]
      : info.state === 'error' || info.state === 'stale'
        ? [{ id: 'retry', label: 'Reîncearcă' }, { id: 'reconnect', label: 'Reconectează' }]
        : []

  return (
    <article aria-label={name} data-state={info.state} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-1">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent-soft font-mono text-[11px] font-semibold text-accent-text">
          {mono}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[14.5px] font-semibold leading-tight">{name}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">{info.description}</p>
        </div>
        <StatusChip tone={st.tone} icon={st.icon}>
          {st.label}
        </StatusChip>
      </div>

      {info.state === 'not_connected' ? (
        <p className="text-[12.5px] leading-snug text-text-2">Sursa nu e conectată. Indicatorii care depind de ea apar ca indisponibili.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 text-[12px]">
          <div>
            <dt className="text-text-3">Date până la</dt>
            <dd className="font-mono text-[11.5px] text-text">{info.data_as_of ? formatDate(info.data_as_of) : '—'}</dd>
          </div>
          <div>
            <dt className="text-text-3">Importat la</dt>
            <dd className="font-mono text-[11.5px] text-text">{info.imported_at ? formatDateTime(info.imported_at) : '—'}</dd>
          </div>
        </dl>
      )}

      {info.note && <p className="text-[12.5px] leading-snug text-text-2">{info.note}</p>}

      {canManage && actions.length > 0 && (
        <div className="flex gap-2">
          {actions.map((a) => (
            <Button key={a.id} variant={a.primary ? 'primary' : 'secondary'} onClick={() => onAction?.(a.id, info.provider)}>
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </article>
  )
}
