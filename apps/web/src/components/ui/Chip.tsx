import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type ChipTone = 'neutral' | 'pos' | 'warn' | 'neg' | 'accent' | 'lav'

const TONES: Record<ChipTone, string> = {
  neutral: 'bg-neutral-soft text-text-2',
  pos: 'bg-pos-soft text-pos-text',
  warn: 'bg-warn-soft text-warn-text',
  neg: 'bg-neg-soft text-neg-text',
  accent: 'bg-accent-soft text-accent-text',
  lav: 'bg-lav-soft text-lav-text',
}

/** Chip de status (informativ, nu interactiv). Sensul stă în text; culoarea îl întărește. */
export function StatusChip({ tone = 'neutral', icon, children }: { tone?: ChipTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium', TONES[tone])}>
      {icon}
      {children}
    </span>
  )
}

/** Chip de filtru: activ = fundal `--text`, text `--bg`. `aria-pressed` comunică starea. */
export function FilterChip({ active, onClick, onRemove, children }: { active?: boolean; onClick?: () => void; onRemove?: () => void; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-[10px] border text-[12.5px] font-medium',
        active ? 'border-transparent bg-text text-bg' : 'border-border bg-surface text-text',
      )}
    >
      <button type="button" aria-pressed={active} onClick={onClick} className="h-full rounded-[10px] px-2.5">
        {children}
      </button>
      {onRemove && (
        <button type="button" aria-label={`Elimină filtrul ${typeof children === 'string' ? children : ''}`.trim()} onClick={onRemove} className="h-full pr-2 opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </span>
  )
}
