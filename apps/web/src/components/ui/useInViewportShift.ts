import { useLayoutEffect, useState, type RefObject } from 'react'

const MARGIN = 8

/**
 * Deplasarea pe orizontală (px) care ține un popover deschis în ecran. Pe telefon, un meniu aliniat la
 * butonul lui poate ieși prin dreapta; se mută înăuntru, cu o margine de 8 px. Fără deplasare pe desktop.
 */
export function useInViewportShift(ref: RefObject<HTMLElement | null>, open: boolean): number {
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    if (!open) {
      setShift(0)
      return
    }
    const el = ref.current
    const viewport = document.documentElement.clientWidth
    if (!el || viewport === 0) return
    const r = el.getBoundingClientRect()
    let dx = 0
    if (r.right > viewport - MARGIN) dx = viewport - MARGIN - r.right
    if (r.left + dx < MARGIN) dx = MARGIN - r.left
    setShift(dx)
  }, [ref, open])
  return shift
}
