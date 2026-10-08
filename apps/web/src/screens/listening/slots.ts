import type { KpiSlot } from '../shared/slots'

/**
 * KPI-urile din spec cap. 18 care sunt metrici. Cheile `listening_*` nu sunt încă în registru: cardurile rămân
 * „Sursă neconectată", fără definiție inventată. Distribuția sentimentului și lista vin din `MentionsProvider`.
 */
export const LISTENING_KPI_SLOTS: readonly KpiSlot[] = [
  { key: 'listening_mentions', label: 'Mențiuni eligibile' },
  { key: 'listening_sov', label: 'Listening SoV' },
  { key: 'listening_negative_share', label: 'Pondere mențiuni negative' },
]
export const LISTENING_KPI_KEYS: readonly string[] = LISTENING_KPI_SLOTS.map((s) => s.key)
