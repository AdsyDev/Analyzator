/**
 * Cele 6 indicatori din Overview (spec cap. 12). `label` e eticheta slotului din spec, folosită doar când
 * metrica nu are definiție în registru; altfel eticheta e `name_ro` din registru. Cheile din afara registrului
 * (încă: `ai_mention_rate`, `paid_spend`, `listening_mentions`) nu au definiție inventată: providerul le
 * întoarce `not_connected`, iar tooltipul spune că definiția nu e încă în registru.
 */
export interface KpiSlot {
  key: string
  label: string
}

export const KPI_SLOTS: readonly KpiSlot[] = [
  { key: 'ai_mention_rate', label: 'AI Mention Rate' },
  { key: 'gsc_clicks', label: 'Clicks organic' },
  { key: 'ga4_sessions', label: 'Sesiuni' },
  { key: 'ga4_key_events', label: 'Key events' },
  { key: 'paid_spend', label: 'Cost paid' },
  { key: 'listening_mentions', label: 'Mențiuni eligibile' },
]

export const KPI_KEYS: readonly string[] = KPI_SLOTS.map((s) => s.key)

/** Seriile din graficul „Evoluție": AI, search, trafic, mențiuni; fiecare cu unitatea ei. */
export interface TrendSlot {
  key: string
  tab: string
}

export const TREND_SLOTS: readonly TrendSlot[] = [
  { key: 'ai_mention_rate', tab: 'AI' },
  { key: 'gsc_clicks', tab: 'Search' },
  { key: 'ga4_sessions', tab: 'Trafic' },
  { key: 'listening_mentions', tab: 'Mențiuni' },
]

export const MISSING_DEFINITION = 'Definiția acestui indicator nu este încă în registrul de metrici.'
