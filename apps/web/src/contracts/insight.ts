import type { BrandId, IsoDate, IsoDateTime } from './common'
import type { EvidenceQuery } from './metric'
import type { DateRange } from './period'

export const INSIGHT_STATUSES = ['draft', 'in_review', 'published', 'superseded'] as const
export type InsightStatus = (typeof INSIGHT_STATUSES)[number]

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled'

/** Stadiul exact din `actions.status`; `status` de mai sus e forma scurtă afișată clientului. */
export const ACTION_STAGES = ['proposed', 'agreed', 'in_progress', 'done', 'measured', 'cancelled'] as const
export type ActionStage = (typeof ACTION_STAGES)[number]

export interface Person {
  id: string
  name: string
  /** Rolul și organizația, de ex. „Strateg, AdSymphony". */
  role: string
}

export interface EvidenceLink {
  /** ID-ul legăturii (`evidence_links.id`), când vine de la server. */
  id?: string
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
  /** Efortul estimat, în text (de ex. „2 zile"); `null` sau absent când nu a fost completat. */
  effort?: string | null
  /** Indicatorul din registru urmărit după implementare; absent când nu a fost ales. */
  tracked_metric?: { metric_key: string; label: string } | null
  /** Stadiul exact; vizibil echipei, care îl schimbă prin tranziții. */
  stage?: ActionStage
  /** Rezultatul observat, completat la măsurare. */
  result_note?: string | null
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
  /** Interpretarea echipei (separată de constatare); obligatorie la trimiterea în review. */
  interpretation?: string
  version?: number
  /** „Limite": ce nu arată analiza. */
  limits: string | null
  actions: InsightAction[]
  updated_at: IsoDateTime
  published_at: IsoDateTime | null
}

/** Textele și dovezile unei ciorne. Statusul nu se scrie de aici: se schimbă doar prin tranziții. */
export interface InsightDraft {
  title: string
  period: DateRange
  /** Constatarea. */
  summary: string
  interpretation: string
  limits: string
  /** Metricile din registru citate ca dovezi; se îngheață la publicare. */
  evidence_keys: string[]
}

export type InsightTransition = 'in_review' | 'draft' | 'published'

export interface NewAction {
  title: string
  due: IsoDate | null
  effort: string | null
  tracked_metric_key: string | null
}

export interface ActionTransition {
  to: Exclude<ActionStage, 'proposed'>
  /** Obligatoriu la anulare. */
  reason?: string
  /** Obligatoriu la măsurare: rezultatul observat. */
  result_note?: string
}

/** Tranzițiile permise din fiecare stadiu, ca în `private.apply_action_transition`; serverul rămâne autoritatea. */
export const ACTION_NEXT: Record<ActionStage, ReadonlyArray<ActionTransition['to']>> = {
  proposed: ['agreed', 'cancelled'],
  agreed: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: ['measured'],
  measured: [],
  cancelled: [],
}
