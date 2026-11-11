import type { IsoDate, IsoDateTime } from './common'

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

/** Indexare (Etapa 3, L): starea unui URL după ultima inspecție Search Console. Clasificarea o face serverul. */
export const INDEX_STATES = ['indexed', 'not_indexed', 'unknown'] as const
export type IndexState = (typeof INDEX_STATES)[number]

export interface IndexedUrl {
  url: string
  /** URL din lista agenției; `false` = inspectat pentru că e printre paginile cu cele mai multe clickuri. */
  priority: boolean
  state: IndexState
  /** Câmpurile Google, neschimbate; `null` = absent din răspuns. */
  verdict: string | null
  coverage_state: string | null
  indexing_state: string | null
  robots_txt_state: string | null
  page_fetch_state: string | null
  crawled_as: string | null
  last_crawl_time: IsoDateTime | null
  google_canonical: string | null
  user_canonical: string | null
  /** `null` când Google sau pagina nu declară un canonical: necunoscut, nu „diferit”. */
  canonical_matches: boolean | null
  inspected_on: IsoDate
}

export interface PriorityUrl {
  id: string
  url: string
  /** `false` = adăugat, dar încă neinspectat (următoarea rulare îl ia). */
  inspected: boolean
}

export interface IndexStatus {
  /** Ziua ultimei inspecții a brandului; `null` = nicio inspecție încă. */
  inspected_on: IsoDate | null
  /** Numere de URL-uri din lista inspectată, nu din tot site-ul. */
  summary: { total: number; indexed: number; not_indexed: number; unknown: number; canonical_mismatch: number }
  urls: IndexedUrl[]
  priority_urls: PriorityUrl[]
}

