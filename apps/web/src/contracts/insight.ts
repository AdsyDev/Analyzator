import type { BrandId, IsoDate, IsoDateTime } from './common'
import type { EvidenceQuery } from './metric'
import type { DateRange } from './period'

export const INSIGHT_STATUSES = ['draft', 'in_review', 'published', 'superseded'] as const
export type InsightStatus = (typeof INSIGHT_STATUSES)[number]

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

export interface Person {
  id: string
  name: string
  /** Rolul și organizația, de ex. „Strateg, AdSymphony". */
  role: string
}

export interface EvidenceLink {
  label: string
  /** Cheia pentru EvidenceDrawer (`MetricsProvider.evidence`), neschimbată. */
  evidence_query: EvidenceQuery
}

export interface InsightAction {
  id: string
  title: string
  owner: Person
  due: IsoDate | null
  status: ActionStatus
}

export interface Insight {
  id: string
  brand_id: BrandId
  title: string
  summary: string
  author: Person
  period: DateRange
  /** Clientul primește doar `published`; filtrarea se face în server (RLS), nu în UI. */
  status: InsightStatus
  evidence: EvidenceLink[]
  /** „Limite": ce nu arată analiza. */
  limits: string | null
  actions: InsightAction[]
  updated_at: IsoDateTime
  published_at: IsoDateTime | null
}
