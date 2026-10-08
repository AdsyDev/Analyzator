import type { KpiSlot } from '../shared/slots'

/**
 * KPI-urile din spec cap. 16. `ga4_engagement_rate` nu e în registru: nu se calculează în UI din sesiuni cu
 * implicare și sesiuni (regula 4); cardul rămâne „Sursă neconectată" până intră în registru.
 */
export const TRAFFIC_KPI_SLOTS: readonly KpiSlot[] = [
  { key: 'ga4_sessions', label: 'Sesiuni' },
  { key: 'ga4_active_users', label: 'Utilizatori activi' },
  { key: 'ga4_engaged_sessions', label: 'Sesiuni cu implicare' },
  { key: 'ga4_engagement_rate', label: 'Engagement rate' },
  { key: 'ga4_key_events', label: 'Key events' },
]
export const TRAFFIC_KPI_KEYS: readonly string[] = TRAFFIC_KPI_SLOTS.map((s) => s.key)

/** Metricile Clarity din registru, în ordinea tabelului „Comportament". */
export const CLARITY_KEYS = ['clarity_rage_click_sessions', 'clarity_dead_click_sessions', 'clarity_quickback_sessions', 'clarity_scroll_depth'] as const
