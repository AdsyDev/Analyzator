import type { BrandId, IsoDateTime } from './common'
import type { PvFlag } from './mention'
import type { MetricStatus, TrendPoint } from './metric'

/**
 * AI Visibility: seturile de date de care are nevoie ecranul (spec cap. 13).
 *
 * ATENȚIE: nu există încă un contract de server pentru ele (registrul are doar metrici agregate, iar
 * `ai_answers` din spec cap. 25 nu e încă în baza de date). Tipurile de mai jos sunt cerințele UI-ului,
 * documentate în `docs/design/ui-data-needs.md`; se aliniază la contractul real când există.
 * Ratele, numărătorile și clasificările vin gata calculate de server: UI-ul nu le recalculează (regula 4).
 */
export const AI_ENGINES = ['chatgpt', 'gemini', 'perplexity', 'aio'] as const
export type AiEngine = (typeof AI_ENGINES)[number]

/**
 * Rezultatul unui răspuns colectat. Refuzul motorului, eroarea tehnică și răspunsul necolectat sunt stări
 * diferite de „brandul nu e menționat" și nu intră în numitorul ratelor (spec 2.2).
 */
export type AnswerOutcome = 'recommended' | 'mentioned' | 'not_mentioned' | 'refused' | 'error' | 'not_collected'

export const VALID_OUTCOMES: ReadonlySet<AnswerOutcome> = new Set<AnswerOutcome>(['recommended', 'mentioned', 'not_mentioned'])

/** Un filtru aplicat de URL: `null` = toate. Cheile sunt allowlist-ul ecranului. */
export interface AiFilters {
  engine: AiEngine | null
  group: string | null
}

export interface AiEngineStat {
  engine: AiEngine
  /** Procent, calculat de server din răspunsurile valide ale engine-ului. */
  mention_rate: number | null
  /** Variația în puncte procentuale față de perioada de comparație. */
  delta_pp: number | null
  valid_answers: number
  total_answers: number
  status: MetricStatus
}

export interface AiEngineTrend {
  engine: AiEngine
  points: TrendPoint[]
  status: MetricStatus
}

export interface AiMatrixEntity {
  id: BrandId | string
  name: string
  kind: 'brand' | 'competitor'
  /** C1, C2, C3 pentru competitori; stabilă. */
  label: string
}

export interface AiMatrixTopic {
  topic: string
  group: string
  /** Răspunsuri valide din care s-a calculat rândul. */
  n: number
  /** Fracție 0-1, ca la `MetricResponse.coverage`. */
  coverage: number | null
}

export interface AiMatrixCell {
  /** Procent; `null` fără răspunsuri valide (nu 0). */
  value: number | null
  numerator: number | null
  denominator: number | null
  status: MetricStatus
}

export interface AiTopicMatrix {
  entities: AiMatrixEntity[]
  topics: AiMatrixTopic[]
  /** `cells[topic][entity.id]`. */
  cells: Record<string, Record<string, AiMatrixCell>>
}

export interface AiCitedSource {
  domain: string
  kind: 'owned' | 'third_party'
  /** Numărul de răspunsuri valide în care apare domeniul. */
  count: number
  /** Brandul asociat (pentru `owned`). */
  brand_id: string | null
}

export interface AiAnswerSummary {
  id: string
  question: string
  engine: AiEngine
  group: string
  collected_at: IsoDateTime
  outcome: AnswerOutcome
  pv_flag: PvFlag | null
}

/** Segmentele răspunsului sanitizat, deja marcate de server: UI-ul nu detectează branduri în text. */
export type AnswerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'brand'; text: string; entity_id: string }
  | { kind: 'cite'; n: number }

export interface AiCitation {
  n: number
  domain: string
  title: string
  /** URL original; se validează înainte de a deveni link. */
  url: string | null
  owned: boolean
}

export interface AiAnswerDetail extends AiAnswerSummary {
  /** Ruta de colectare, de ex. eticheta furnizorului pentru suprafața „AI Mode". */
  collection_note: string | null
  /** Gol pentru `refused`, `error` și `not_collected`: nu se afișează text inventat. */
  segments: AnswerSegment[]
  citations: AiCitation[]
  /** Entitățile prezente și cele recomandate (id-uri din `AiMatrixEntity`). */
  entities_present: string[]
  entities_recommended: string[]
}
