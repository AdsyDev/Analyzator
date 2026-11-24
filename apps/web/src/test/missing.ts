import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * Mesajul paginii pentru datele lipsă (decizia AG): „Pentru perioada selectată nu avem date pentru …”. Întoarce elementul,
 * ca testul să verifice numele din el; pică dacă mesajul nu apare.
 */
export async function missingNotice(): Promise<HTMLElement> {
  let found: HTMLElement | undefined
  await waitFor(() => {
    found = screen.queryAllByRole('status').find((e) => e.textContent?.startsWith('Pentru perioada selectată nu avem date pentru'))
    expect(found).toBeDefined()
  })
  return found!
}

/** Nicăieri în pagină textul vechi „Sursă neconectată”. */
export function expectNoSourceDisconnected() {
  expect(screen.queryByText(/Sursă neconectată/)).toBeNull()
}

/** Numele din mesajul paginii al cărui motiv (tooltip) se potrivește; pică dacă nu există. */
export async function missingWith(reason: string | RegExp): Promise<HTMLElement> {
  const notice = await missingNotice()
  const match = (t: string | null) => t !== null && (typeof reason === 'string' ? t.includes(reason) : reason.test(t))
  let el: HTMLElement | undefined
  await waitFor(() => {
    el = [...notice.querySelectorAll<HTMLElement>('[title]')].find((e) => match(e.getAttribute('title')))
    expect(el, `niciun nume cu motivul ${String(reason)} în: ${notice.textContent}`).toBeDefined()
  })
  return el!
}
