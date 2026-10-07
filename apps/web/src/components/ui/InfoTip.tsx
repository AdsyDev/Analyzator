import { useEffect, useId, useState, type ReactNode } from 'react'

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
        className="grid size-[18px] cursor-help place-items-center rounded-full border border-border-strong text-[10px] font-semibold leading-none text-text-2"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="glass-strong absolute left-[-14px] top-[26px] z-30 w-64 rounded-xl px-3 py-2.5 text-[12.5px] font-normal leading-normal text-text"
        >
          {children}
        </span>
      )}
    </span>
  )
}
