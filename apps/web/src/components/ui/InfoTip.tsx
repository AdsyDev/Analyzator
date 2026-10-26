import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useInViewportShift } from './useInViewportShift'

/**
 * Tooltipul „?" din indicatori. Se deschide la hover, la focus și la click (alternativă pentru
 * tastatură și touch); Esc îl închide. Popoverul e singura parte de sticlă a componentei.
 */
export function InfoTip({ label = 'Ce înseamnă indicatorul', children }: { label?: string; children: ReactNode }) {
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [pinned, setPinned] = useState(false)
  const id = useId()
  const open = hover || focus || pinned
  const tip = useRef<HTMLSpanElement>(null)
  const shift = useInViewportShift(tip, open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHover(false)
        setFocus(false)
        setPinned(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <span className="relative inline-flex" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setPinned((p) => !p)}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false)
          setPinned(false)
        }}
        className="relative grid size-[18px] cursor-help place-items-center rounded-full border border-border-strong text-[10px] font-semibold leading-none text-text-2 after:absolute after:-inset-3 after:content-['']"
      >
        ?
      </button>
      {open && (
        <span
          ref={tip}
          id={id}
          role="tooltip"
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className="glass-strong absolute left-[-14px] top-[26px] z-30 w-64 max-w-[calc(100vw-16px)] rounded-xl px-3 py-2.5 text-[12.5px] font-normal leading-normal text-text"
        >
          {children}
        </span>
      )}
    </span>
  )
}
