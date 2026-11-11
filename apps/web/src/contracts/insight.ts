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

export const CLIENT_RESPONSES = ['accepted', 'adjustment_requested'] as const
export type ClientResponseKind = (typeof CLIENT_RESPONSES)[number]

/**
 * Ultimul răspuns al clientului la o recomandare dintr-o analiză publicată (deciziile S). Istoricul rămâne pe server;
 * aici vine doar cel în vigoare. Numele nu se arată (E10): `by` e o etichetă neutră, `own` spune dacă e al utilizatorului curent.
 */
export interface ClientResponse {
  response: ClientResponseKind
  /** Motivul; obligatoriu la cererea de ajustare. */
  comment: string | null
  at: IsoDateTime
  by: string
  own: boolean
}

/** O recomandare: problema, ce propunem și ce ne așteptăm să se schimbe. Se editează doar cât analiza e ciornă. */
export interface InsightRecommendation {
  id: string
  problem: string
  action: string
  expected_benefit: string
  /** 1–3, fără zecimale (spec 2.8); 1 = prioritatea cea mai mare. */
  priority: 1 | 2 | 3
  /** `null` sau absent = clientul nu a răspuns încă. Nu înseamnă acceptare. */
  client_response?: ClientResponse | null
}
export type NewRecommendation = Omit<InsightRecommendation, 'id' | 'client_response'>

/** Un comentariu din discuția de pe o analiză publicată, între client și echipă. Nu se editează și nu se șterge. */
export interface InsightComment {
  id: string
  body: string
  created_at: IsoDateTime
  author_role: 'client' | 'agency'
  /** Etichetă neutră a autorului, fără nume. */
  author: string
  own: boolean
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
  /**
   * Proveniența textului: scris de echipă sau ciornă generată de AdSy AI, apoi revizuită de echipă. Marcajul îl pune
   * serverul și nu se poate șterge; lipsa lui înseamnă `human`.
   */
  origin?: 'human' | 'adsy_ai'
  evidence: EvidenceLink[]
  /** Interpretarea echipei (separată de constatare); obligatorie la trimiterea în review. */
  interpretation?: string
  version?: number
  /** Analiza publicată pe care o înlocuiește această versiune, când e cazul. */
  supersedes_id?: string | null
  /** Recomandările analizei, în ordinea priorității (1 = cea mai mare). */
  recommendations?: InsightRecommendation[]
  /** Discuția de pe analiza publicată, în ordinea scrierii. */
  comments?: InsightComment[]
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
  /** Responsabilul; `null` = utilizatorul curent. Trebuie să fie un membru activ al agenției (verificat de server). */
  owner_id?: string | null
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
