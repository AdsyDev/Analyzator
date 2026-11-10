/**
 * Cardurile din Overview (propunerea din 10 nov. 2026, „Overview pentru decizii rapide"): maximum șase, fiecare
 * răspunde la o întrebare (`category`) și duce la detaliul ei (`module`). Eticheta rămâne numele exact al metricii
 * din registru; `label` e doar rezerva pentru o cheie fără definiție.
 *
 * Două carduri nu au încă metrica din propunere și o spun explicit, fără valori estimate:
 * - „Performanță socială" arată interacțiunile din `brand_social` (calculate în SQL); engagement rate nu are încă
 *   definiție în registru (numitorul diferă pe platforme).
 * - „Acțiuni importante" arată numărul de key events; rata sesiunilor cu key event nu se colectează încă.
 */
import type { KpiSlot } from '../shared/slots'

export interface OverviewMetricCard extends KpiSlot {
  kind: 'metric'
  category: string
  /** Segmentul modulului de detaliu (`/brands/:id/<module>`). */
  module: string
  detailLabel: string
  /** Ce lipsește față de indicatorul din propunere, afișat sub valoare. */
  gap?: string
}
export interface OverviewSocialCard {
  kind: 'social'
  key: 'social_interactions'
  category: string
  module: string
  detailLabel: string
  gap: string
}
export type OverviewCard = OverviewMetricCard | OverviewSocialCard

export const OVERVIEW_CARDS: readonly OverviewCard[] = [
  { kind: 'metric', key: 'ai_mention_rate', label: 'AI Mention Rate', category: 'Vizibilitate AI', module: 'ai', detailLabel: 'Engine-uri și topicuri' },
  { kind: 'metric', key: 'seomonitor_visibility_latest', label: 'Visibility SEOmonitor', category: 'Vizibilitate organică', module: 'seo', detailLabel: 'Keywords și pagini' },
  { kind: 'metric', key: 'mentions_count', label: 'Mențiuni', category: 'Conversații relevante', module: 'listening', detailLabel: 'Mention feed' },
  {
    kind: 'social',
    key: 'social_interactions',
    category: 'Performanță socială',
    module: 'social',
    detailLabel: 'Postări',
    gap: 'Engagement rate nu are încă definiție în registru; până atunci arătăm interacțiunile.',
  },
  { kind: 'metric', key: 'ga4_sessions', label: 'Sesiuni', category: 'Trafic pe site', module: 'traffic', detailLabel: 'Canale și landing pages' },
  {
    kind: 'metric',
    key: 'ga4_key_events',
    label: 'Key events',
    category: 'Acțiuni importante',
    module: 'traffic',
    detailLabel: 'Trafic și conversii',
    gap: 'Număr de evenimente, nu de sesiuni: rata sesiunilor cu key event nu se colectează încă.',
  },
]

/** Cardurile care sunt metrici din registru, în ordinea afișării. */
export const KPI_SLOTS: readonly OverviewMetricCard[] = OVERVIEW_CARDS.filter((c): c is OverviewMetricCard => c.kind === 'metric')
export const KPI_KEYS: readonly string[] = KPI_SLOTS.map((s) => s.key)

/** Cele patru grafice din „Evoluția brandului": AI, search, trafic, mențiuni; fiecare cu scara ei. */
export interface TrendSlot {
  key: string
  tab: string
}

export const TREND_SLOTS: readonly TrendSlot[] = [
  { key: 'ai_mention_rate', tab: 'AI' },
  { key: 'gsc_clicks', tab: 'Search' },
  { key: 'ga4_sessions', tab: 'Trafic' },
  { key: 'mentions_count', tab: 'Mențiuni' },
]

/** „Poziția față de competitori": primul rând al fiecărei dimensiuni din matricea de Concurență, în această ordine. */
export const POSITION_DIMENSIONS = ['ai', 'seo', 'listening'] as const
