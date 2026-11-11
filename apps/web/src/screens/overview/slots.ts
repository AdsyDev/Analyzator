/**
 * Overview, după macheta din propunere („Imaginea completă a brandului”): șase indicatori pe primul rând, fiecare cu
 * detaliul lui. Eticheta rămâne numele exact al metricii din registru; `label` e doar rezerva pentru o cheie fără definiție.
 *
 * Patru carduri sunt metrici din registru. Două nu sunt și o spun:
 * - „Sentiment” arată ponderea pozitivă din mențiunile revizuite de om (`brand_mention_sentiment`), cu numărul lor;
 * - „Poziție competitivă” arată locul brandului în setul de competitori pe AI, din matricea de Concurență.
 * Macheta mai arată „Scor SEO” și „Mențiuni AI”; aplicația nu are un scor SEO compus și nici un număr de mențiuni AI în
 * registru, deci în locul lor stau Visibility SEOmonitor și AI Mention Rate, cu numele lor adevărat.
 */
import type { KpiSlot } from '../shared/slots'

interface CardBase {
  category: string
  /** Segmentul modulului de detaliu (`/brands/:id/<module>`). */
  module: string
  detailLabel: string
}
export interface OverviewMetricCard extends KpiSlot, CardBase {
  kind: 'metric'
}
export interface OverviewSentimentCard extends CardBase {
  kind: 'sentiment'
  key: 'sentiment_positive'
}
export interface OverviewPositionCard extends CardBase {
  kind: 'position'
  key: 'competitive_position'
}
export type OverviewCard = OverviewMetricCard | OverviewSentimentCard | OverviewPositionCard

export const OVERVIEW_CARDS: readonly OverviewCard[] = [
  { kind: 'metric', key: 'ai_sov', label: 'AI Share of Voice', category: 'AI Share of Voice', module: 'ai', detailLabel: 'Engine-uri și topicuri' },
  { kind: 'metric', key: 'ai_mention_rate', label: 'AI Mention Rate', category: 'Mențiuni în AI', module: 'ai', detailLabel: 'Răspunsuri AI' },
  { kind: 'metric', key: 'seomonitor_visibility_latest', label: 'Visibility SEOmonitor', category: 'Vizibilitate SEO', module: 'seo', detailLabel: 'Keywords și pagini' },
  { kind: 'sentiment', key: 'sentiment_positive', category: 'Sentiment pozitiv', module: 'listening', detailLabel: 'Mention feed' },
  { kind: 'metric', key: 'gsc_clicks', label: 'Clicks (Search Console)', category: 'Trafic organic', module: 'seo', detailLabel: 'Landing pages' },
  { kind: 'position', key: 'competitive_position', category: 'Poziție competitivă', module: 'competition', detailLabel: 'Toată comparația' },
]

/** Cardurile care sunt metrici din registru, în ordinea afișării. */
export const KPI_SLOTS: readonly OverviewMetricCard[] = OVERVIEW_CARDS.filter((c): c is OverviewMetricCard => c.kind === 'metric')

/** Metricile din cardurile de sub primul rând: „SEO și trafic” și „Social listening”. */
export const BOARD_KEYS = ['seomonitor_keywords_top10', 'gsc_ctr', 'ga4_sessions', 'mentions_count'] as const

/** Toate metricile din registru de pe Overview: după ele se numără acoperirea și se caută „Ce s-a schimbat”. */
export const KPI_KEYS: readonly string[] = [...KPI_SLOTS.map((s) => s.key), ...BOARD_KEYS]

/** Seria din „Evoluția vizibilității AI” și seria zilnică din „SEO și trafic”. */
export const AI_TREND_KEY = 'ai_sov'
export const ORGANIC_TREND_KEY = 'gsc_clicks'
export const TREND_KEYS: readonly string[] = [...new Set([...KPI_KEYS, AI_TREND_KEY, ORGANIC_TREND_KEY])]

/** Rândul din matricea de Concurență folosit pentru „Poziție competitivă” și pentru cardul „Competitori”. */
export const POSITION_DIMENSIONS = ['ai', 'seo', 'listening'] as const
