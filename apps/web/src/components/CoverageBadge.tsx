import { CheckIcon, CircleHalfIcon, ClockIcon, PlugsIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { CoverageState } from '../lib/metricView'
import { cn } from '../lib/cn'

const CONFIG: Record<CoverageState, { label: string; icon: ReactNode; cls: string; title: (pct: number | null) => string }> = {
  complete: {
    label: 'Complet',
    icon: <CheckIcon size={10} weight="bold" aria-hidden="true" />,
    cls: 'bg-pos-soft text-pos-text',
    title: () => 'Date complete pentru perioada selectată',
  },
  partial: {
    label: 'Parțial',
    icon: <CircleHalfIcon size={10} weight="bold" aria-hidden="true" />,
    cls: 'bg-warn-soft text-warn-text',
    title: (pct) => (pct === null ? 'Date parțiale pentru perioada selectată' : `Date parțiale: ${Math.round(pct)}% din zile acoperite`),
  },
  stale: {
    label: 'Învechit',
    icon: <ClockIcon size={10} weight="bold" aria-hidden="true" />,
    cls: 'bg-neutral-soft text-text-2',
    title: () => 'Datele nu au mai fost actualizate de la ultimul import',
  },
  unavailable: {
    label: 'Indisponibil',
    icon: <PlugsIcon size={10} weight="bold" aria-hidden="true" />,
    cls: 'border border-border-strong bg-transparent text-text-2',
    title: () => 'Nu există valoare pentru această perioadă',
  },
}

/** Starea de acoperire a unui indicator. Textul și iconița poartă sensul, nu doar culoarea. */
export function CoverageBadge({ state, pct = null }: { state: CoverageState; pct?: number | null }) {
  const c = CONFIG[state]
  return (
    <span title={c.title(pct)} className={cn('inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium', c.cls)}>
      {c.icon}
      {c.label}
      {state === 'partial' && pct !== null && <span className="font-mono text-[10.5px]">{Math.round(pct)}%</span>}
    </span>
  )
}
