import type { BrandId, IsoDateTime } from './common'

export type Sentiment = 'positive' | 'neutral' | 'negative'

export interface Mention {
  id: string
  brand_id: BrandId
  source_name: string
  author: string | null
  published_at: IsoDateTime
  text: string
  url: string | null
  /** Null până la revizuirea umană; UI-ul nu deduce sentimentul. */
  sentiment: Sentiment | null
  reviewed_by: string | null
  pv_flag: PvFlag | null
}

/** Obiectul care poate fi marcat pentru farmacovigilență: o mențiune sau un răspuns AI. */
export interface PvItemRef {
  kind: 'mention' | 'ai_answer'
  id: string
}

export type PvStatus = 'pending' | 'notified' | 'acknowledged'

export interface PvFlag {
  id: string
  item: PvItemRef
  flagged_at: IsoDateTime
  flagged_by: string
  notified: boolean
  status: PvStatus
}

/** Exact ce se înregistrează la marcare; se afișează în dialogul de confirmare. */
export interface PvSnapshot {
  item: PvItemRef
  at: IsoDateTime
  user: string
  link: string | null
  text: string
  /** Destinatarii notificării, din configurarea clientului. */
  notify: string[]
}

export interface MentionQuery {
  sentiment: Sentiment | null
  source: string | null
  page: number
  page_size: number
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface SentimentDistribution {
  total: number
  positive: number
  neutral: number
  negative: number
}
