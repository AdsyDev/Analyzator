/** Dată calendaristică ISO `YYYY-MM-DD`, în Europe/Bucharest (regula 9). */
export type IsoDate = string
/** Moment ISO 8601 cu offset. Se afișează în Europe/Bucharest. */
export type IsoDateTime = string
export type BrandId = string
export type TenantId = string

/**
 * Rezultatul unei interogări de listă sau de entitate. Cele trei stări sunt distincte (regula 8):
 * lipsa sursei, eroarea și datele (inclusiv lista goală, care e o stare `ready`).
 */
export type ProviderResult<T> =
  | { kind: 'ready'; data: T }
  | { kind: 'not_connected'; reason: string }
  | { kind: 'error'; message: string }

export const ready = <T>(data: T): ProviderResult<T> => ({ kind: 'ready', data })
export const notConnected = <T>(reason: string): ProviderResult<T> => ({ kind: 'not_connected', reason })
export const failed = <T>(message: string): ProviderResult<T> => ({ kind: 'error', message })
