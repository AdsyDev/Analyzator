import type { IsoDate, IsoDateTime } from './common'
import type { MetricStatus } from './metric'
import type { DateRange } from './period'

/**
 * Social propriu (spec cap. 17). Date din Planable (import). Nu există încă un contract de server; tipurile
 * sunt cerințele UI-ului. Ratele și medianele vin calculate. Concurența publică nu include reach privat.
 */
export const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export const SOCIAL_FORMATS = ['image', 'video', 'carousel', 'story'] as const
export type SocialFormat = (typeof SOCIAL_FORMATS)[number]

export interface SocialFilters {
  platform: SocialPlatform | null
  format: SocialFormat | null
}

export type SocialKpiKey = 'posts' | 'followers' | 'net_growth' | 'interactions' | 'reach'

export interface SocialKpi {
  key: SocialKpiKey
  label: string
  value: number | null
  change: number | null
  status: MetricStatus
  definition: string
  note: string | null
}

export interface SocialSummary {
  kpis: SocialKpi[]
  imported_at: IsoDateTime
  data_as_of: IsoDate
}

export interface SocialPost {
  id: string
  published_at: IsoDateTime
  platform: SocialPlatform
  format: SocialFormat
  topic: string | null
  /** Eticheta de campanie din Planable. */
  label: string | null
  excerpt: string
  /** URL original; se validează înainte de a deveni link. */
  permalink: string | null
  /** Vârsta postării la data observației, în zile. */
  age_days: number
  /** `false` sub fereastra comună de maturizare (7 zile): metricile pot fi incomplete. */
  mature: boolean
  /** `null` = date de performanță indisponibile (nu zero); postarea rămâne în calendar. */
  reach: number | null
  interactions: number | null
}

export interface SocialGroupStat {
  group: string
  /** Numărul de postări din care s-a calculat mediana. */
  n: number
  posts_per_week: number | null
  median_interactions: number | null
}

export interface SocialGroups {
  by_topic: SocialGroupStat[]
  by_format: SocialGroupStat[]
  observed: DateRange
}

export interface SocialCalendarItem {
  date: IsoDate
  post_id: string
  platform: SocialPlatform
  label: string | null
  /** `false` când postarea nu are date de performanță (status „date de performanță indisponibile"). */
  has_performance: boolean
}

export interface SocialCompetitor {
  label: string
  name: string
  posts_per_week: number | null
  followers: number | null
  public_interactions_per_post: number | null
  as_of: IsoDate | null
}
