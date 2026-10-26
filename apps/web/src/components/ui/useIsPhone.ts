import { useSyncExternalStore } from 'react'

/** Același prag ca varianta `max-sm` din Tailwind: sub 40rem (640 px) e telefon. */
const PHONE_QUERY = 'not all and (min-width: 40rem)'

function phoneQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null
}

function subscribe(onChange: () => void): () => void {
  const q = phoneQuery()
  if (!q || typeof q.addEventListener !== 'function') return () => {}
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

/**
 * Ecran de telefon, pentru conținut cu altă structură (carduri în loc de tabel). Ce diferă doar ca așezare rămâne
 * în CSS (`max-sm:`). Fără `matchMedia` (de ex. în teste), răspunsul e „nu", deci vederea de desktop.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => phoneQuery()?.matches ?? false, () => false)
}
