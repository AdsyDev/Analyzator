import type { IsoDate } from './common'

/**
 * SEO și Search: seturile de date ale ecranului (spec cap. 14). Ca la `ai.ts`, nu există încă un contract
 * de server; tipurile sunt cerințele UI-ului (`docs/design/ui-data-needs.md`). Valorile vin calculate de server.
 */
export interface SearchCompetitor {
  label: string
  name: string
  /** Poziția competitorului pentru keyword. */
  position: number
}

export interface SearchKeyword {
  id: string
  keyword: string
  /** Calea paginii țintă. */
  url: string
  /** Volumul furnizorului; `null` când nu e raportat. */
  volume: number | null
  volume_as_of: IsoDate | null
  /** `null` = fără rank (nu 100): rank absent nu primește o poziție artificială (spec 2.2). */
  rank_mobile: number | null
  rank_desktop: number | null
  /** Poziții câștigate (+) sau pierdute (-) pe mobil; `null` fără comparație. */
  change_mobile: number | null
  is_brand: boolean
  competitor: SearchCompetitor | null
  /** URL folosit și de alte branduri (spec cap. 14: se marchează shared). */
  shared: boolean
}

export interface LandingPage {
  url: string
  clicks: number | null
  impressions: number | null
  /** Procent calculat de server din totalurile paginii. */
  ctr: number | null
  position: number | null
  /** `null` când maparea GA4 pentru pagină nu e validată. */
  key_events: number | null
  shared: boolean
}

export interface ContentGap {
  id: string
  keyword: string
  volume: number | null
  competitor: { label: string; name: string }
  position: number
}

export interface SearchFilters {
  /** `null` = toate; `brand` sau `nonbrand`. */
  keywordType: 'brand' | 'nonbrand' | null
}
