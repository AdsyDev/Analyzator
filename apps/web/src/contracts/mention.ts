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

/** Filtrul de sentiment: o valoare, `unreviewed` (încă fără etichetă umană) sau `null` = toate. */
export type SentimentFilter = Sentiment | 'unreviewed'

export interface MentionQuery {
  sentiment: SentimentFilter | null
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

/**
 * Distribuția sentimentului. Doar mențiunile REVIZUITE de un om intră în `total` și în procente; cele
 * nerevizuite se numără separat (`unreviewed`), nu se presupun neutre. Procentele vin calculate de provider.
 */
export interface SentimentDistribution {
  /** Mențiuni cu sentiment revizuit. */
  total: number
  positive: number
  neutral: number
  negative: number
  /** Mențiuni eligibile încă fără etichetă umană. */
  unreviewed: number
  /** Procente din `total`; `null` când `total` e 0. */
  shares: { positive: number | null; neutral: number | null; negative: number | null }
}

/** O intrare din jurnalul de farmacovigilență (doar `agency_admin`): ce s-a marcat, cine, când și cui s-a notificat. */
export interface PvLogEntry {
  id: string
  item: PvItemRef
  flagged_at: IsoDateTime
  /** Numele utilizatorului care a marcat. */
  user: string
  /** Începutul textului marcat (snapshot-ul întreg rămâne în înregistrare). */
  excerpt: string
  link: string | null
  notified: boolean
  notified_to: string[]
  status: PvStatus
}
