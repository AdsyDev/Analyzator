import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'

export interface EmptyStateAction {
  label: string
  onClick: () => void
  icon?: ReactNode
}

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  /** Motivul concret și următorul pas. Fără mesaje tehnice despre stack. */
  text: string
  action?: EmptyStateAction
  /** `compact` pentru interiorul unui card sau al unei secțiuni. */
  compact?: boolean
}

export function EmptyState({ icon, title, text, action, compact = false }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 text-center',
        compact ? 'px-4 py-6' : 'rounded-xl border border-border bg-surface px-8 py-16 shadow-1',
      )}
    >
      {icon && <span aria-hidden="true" className="text-text-3">{icon}</span>}
      <h3 className="font-display text-[16px] font-semibold text-text">{title}</h3>
      <p className="max-w-[46ch] text-[13.5px] leading-normal text-text-2">{text}</p>
      {action && (
        <Button variant="primary" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
