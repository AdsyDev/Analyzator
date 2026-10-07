import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface MenuOption {
  value: string
  label: string
  /** Rând secundar (de ex. intervalul unei perioade). */
  hint?: string
  disabled?: boolean
  disabledReason?: string
}

interface MenuProps {
  /** Eticheta accesibilă a butonului. */
  label: string
  trigger: ReactNode
  options: readonly MenuOption[]
  value: string
  onSelect: (value: string) => void
  align?: 'left' | 'right'
  /** Conținut suplimentar sub opțiuni (de ex. date personalizate). */
  footer?: ReactNode
  triggerClassName?: string
}

/** Meniu cu selecție unică (menuitemradio). Esc și click în afară îl închid; săgețile mută focusul. */
export function Menu({ label, trigger, options, value, onSelect, align = 'left', footer, triggerClassName }: MenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open) return
    const checked = root.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]:not([disabled])')
    ;(checked ?? root.current?.querySelector<HTMLElement>('[role="menuitemradio"]:not([disabled])'))?.focus()
  }, [open])

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
      return
    }
    if (!open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled])') ?? [])]
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
    e.preventDefault()
    items[next]?.focus()
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex items-center gap-2', triggerClassName)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={cn('glass-strong absolute top-[calc(100%+6px)] z-40 min-w-56 rounded-xl p-1.5', align === 'right' ? 'right-0' : 'left-0')}
        >
          {options.map((o) => {
            const checked = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                disabled={o.disabled}
                title={o.disabled ? o.disabledReason : undefined}
                onClick={() => {
                  onSelect(o.value)
                  setOpen(false)
                  button.current?.focus()
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50',
                  checked ? 'bg-accent-soft text-accent-text' : 'text-text hover:bg-neutral-soft',
                )}
              >
                <span className="flex-1">
                  <span className="block font-medium">{o.label}</span>
                  {o.hint && <span className="block font-mono text-[11px] text-text-2">{o.hint}</span>}
                </span>
                {checked && <span aria-hidden="true">✓</span>}
              </button>
            )
          })}
          {footer}
        </div>
      )}
    </div>
  )
}
