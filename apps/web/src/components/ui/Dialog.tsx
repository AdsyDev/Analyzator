import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  /** `center`: modal; `right`: drawer lateral (EvidenceDrawer). */
  placement?: 'center' | 'right'
  children: ReactNode
  footer?: ReactNode
}

/** Modal/drawer: scrim, Esc, click pe scrim, focus capturat și restituit. Sticlă doar pe panou. */
export function Dialog({ open, onClose, title, placement = 'center', children, footer }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const previous = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    previous.current = document.activeElement
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => {
      if (previous.current instanceof HTMLElement) previous.current.focus()
    }
  }, [open])

  if (!open) return null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (nodes.length === 0) {
      e.preventDefault()
      return
    }
    const firstNode = nodes[0]
    const lastNode = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === firstNode) {
      e.preventDefault()
      lastNode?.focus()
    } else if (!e.shiftKey && document.activeElement === lastNode) {
      e.preventDefault()
      firstNode?.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div data-testid="scrim" className="absolute inset-0" style={{ background: 'var(--scrim)' }} onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'glass-strong absolute flex max-h-full flex-col outline-none',
          placement === 'center'
            ? 'left-1/2 top-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-drawer'
            : 'inset-y-0 right-0 w-[min(480px,100vw)] rounded-l-2xl shadow-drawer',
        )}
      >
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <h2 id={titleId} className="flex-1 font-display text-[16px] font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          <button type="button" aria-label="Închide" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-text-2 hover:bg-neutral-soft">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
