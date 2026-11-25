import type { KpiSlot } from '../shared/slots'

/**
 * KPI-ul din registru al paginii Listening: „Mențiuni” (`mentions_count`, versiunea 2: fără mențiunile clar în altă limbă), cu
 * variația și evoluția din registru. Celelalte carduri de pe rând (interacțiunile și sentimentul automat) și share of voice-ul
 * vin din `brand_listening_overview` (deciziile AH), calculate de server; nu sunt metrici din registru.
 */
export const LISTENING_KPI_SLOTS: readonly KpiSlot[] = [{ key: 'mentions_count', label: 'Mențiuni', sources: ['planable'] }]
export const LISTENING_KPI_KEYS: readonly string[] = LISTENING_KPI_SLOTS.map((s) => s.key)
