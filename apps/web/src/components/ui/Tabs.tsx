import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'

export interface TabItem<T extends string> {
  id: T
  label: string
}

/** Taburi segmentate. Săgețile mută selecția (tablist cu activare automată). */
export function Tabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef(new Map<T, HTMLButtonElement>())

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((t) => t.id === value)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    const target = items[next]
    if (!target) return
    onChange(target.id)
    refs.current.get(target.id)?.focus()
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="inline-flex gap-1 rounded-xl bg-neutral-soft p-1">
      {items.map((t) => {
        const active = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el)
              else refs.current.delete(t.id)
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'h-8 rounded-[9px] px-3 text-[13px] font-medium transition-colors',
              active ? 'bg-surface text-text shadow-1' : 'text-text-2 hover:text-text',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
