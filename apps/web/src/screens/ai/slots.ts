import type { KpiSlot } from '../shared/slots'

/**
 * KPI-urile din spec cap. 13, din registrul de metrici (D-15). Recommendation Rate nu are observații (SEOmonitor nu dă
 * recomandarea explicită) și apare indisponibil, fără valoare estimată.
 */
export const AI_KPI_SLOTS: readonly KpiSlot[] = [
  { key: 'ai_mention_rate', label: 'Mention Rate' },
  { key: 'ai_recommendation_rate', label: 'Recommendation Rate' },
  { key: 'ai_owned_citation_rate', label: 'Owned Citation Rate' },
  { key: 'ai_sov', label: 'SoV în setul urmărit' },
  { key: 'ai_valid_answers', label: 'Răspunsuri valide' },
]

export const AI_KPI_KEYS: readonly string[] = AI_KPI_SLOTS.map((s) => s.key)
