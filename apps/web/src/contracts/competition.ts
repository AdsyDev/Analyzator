import type { IsoDate } from './common'
import type { Page } from './mention'
import type { MetricDirection, MetricStatus, MetricUnit } from './metric'

/**
 * Competiție (spec cap. 20). Nu există încă un contract de server; tipurile sunt cerințele UI-ului
 * (`docs/design/ui-data-needs.md`). Comparația folosește aceleași definiții, aceleași surse și aceleași
 * intervale pentru brand și competitori; ce sursa nu oferă rămâne N/A, nu zero. C1-C3 sunt sloturi până
 * când numele, domeniile și advertiserii sunt confirmați.
 */
export type CompetitionDimension = 'ai' | 'seo' | 'social' | 'listening' | 'ads'

export interface CompetitionEntity {
  id: string
  name: string
  kind: 'brand' | 'competitor'
  /** C1, C2, C3 pentru competitori; stabilă. */
  label: string
}

/** O celulă a matricei. `value: null` = lipsă (cu `reason` când sursa nu oferă metrica), nu zero. */
export interface CompetitionCell {
  value: number | null
  unit: MetricUnit
  status: MetricStatus
  /** Fracție 0-1; `null` când nu se aplică. */
  coverage: number | null
  reason: string | null
}

export interface CompetitionRow {
  key: string
  label: string
  /** Definiția, în tooltip („metrici explicate"). */
  definition: string
  direction: MetricDirection
  /** `cells[entity.id]`. */
  cells: Record<string, CompetitionCell>
}

export interface CompetitionGroup {
  dimension: CompetitionDimension
  title: string
  source: string | null
  rows: CompetitionRow[]
}

export interface CompetitionMatrix {
  entities: CompetitionEntity[]
  groups: CompetitionGroup[]
  /** Versiunea setului de competitori și data efectivă (spec 2.4). */
  set_version: number
  effective_from: IsoDate
  data_as_of: IsoDate | null
}

/** „Unde apare competiția și noi lipsim": subiecte în care un competitor e prezent, iar brandul lipsește sau e mai slab. */
export interface CompetitionGap {
  id: string
  dimension: Exclude<CompetitionDimension, 'social' | 'listening' | 'ads'>
  subject: string
  competitors: Array<{ label: string; name: string; detail: string }>
  /** Situația brandului pe același subiect, în text (de ex. „Fără rank pe mobil"). */
  brand: string
}

/**
 * O reclamă a unui competitor din Google Ads Transparency Center (deciziile Y): ce Google declară despre afișarea ei în
 * România. Nu conține cost, clickuri sau performanță și nu se folosește pentru a le estima (spec cap. 08).
 */
export interface CompetitorAd {
  id: string
  competitor_id: string
  competitor_name: string
  /** C1, C2, C3, ca în matrice. */
  competitor_label: string
  advertiser_id: string
  /** Numele declarat de advertiser; `null` când Google nu îl dă. */
  advertiser_name: string | null
  ad_id: string
  format: 'text' | 'image' | 'video' | 'unknown'
  region: string
  /** Prima și ultima zi de afișare în regiune, declarate de Google; `null` = nedeclarat. */
  first_shown: IsoDate | null
  last_shown: IsoDate | null
  /** Prima afișare cade în perioada aleasă. */
  new_in_period: boolean
  /** Numărul de afișări, ca interval publicat de Google; `null` când nu e publicat. */
  times_shown_lower: number | null
  times_shown_upper: number | null
  /** Pagina reclamei în Ads Transparency Center (acolo se vede creația). */
  source_url: string | null
}

export interface CompetitorAdsPage extends Page<CompetitorAd> {
  /** Ziua până la care Google a fost interogat (cea mai veche dintre advertiserii setului). */
  data_as_of: IsoDate | null
}
