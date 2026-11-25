import type { BrandId, IsoDate, IsoDateTime } from './common'
import type { CompetitionCell } from './competition'

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
  /** „Cont propriu” (D-22): autorul e o pagină a brandului; `null` = necunoscut. Calculat la colectare, nu în UI. */
  owned_account: boolean | null
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

/** Filtrul de autor: doar autorii externi (inclusiv necunoscuți), doar conturile proprii, sau `null` = toți. */
export type AuthorFilter = 'external' | 'owned'

/** Limba mențiunilor: `all` = toate limbile (doar agenția, pentru farmacovigilență); `null` = implicit, doar română. */
export type LanguageFilter = 'all'

export interface MentionQuery {
  sentiment: SentimentFilter | null
  source: string | null
  author: AuthorFilter | null
  language?: LanguageFilter | null
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
 * O pagină din feed-ul de mențiuni. `items` și `total` cuprind doar mențiunile cu conținut (link sau text);
 * `without_content` numără, pe aceeași perioadă, sursă și autor, mențiunile pe care sursa le-a trimis fără niciunul
 * (mențiunile web din Planable). Acestea nu au ce afișa și nu pot fi revizuite, dar sunt numărate la „Mențiuni”.
 * `other_language` numără mențiunile cu conținut lăsate deoparte pentru că sunt în altă limbă decât româna (deciziile AC).
 */
export interface MentionPage extends Page<Mention> {
  without_content: number
  other_language: number
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
  /** Mențiuni eligibile încă fără etichetă umană, dintre cele care pot fi revizuite (au link sau text). */
  unreviewed: number
  /** Mențiuni externe venite de la sursă fără link și fără text: nu pot fi revizuite și nu intră în procente. */
  without_content: number
  /** Postări din conturile proprii, excluse din distribuție (D-22). */
  owned_excluded: number
  /** Mențiuni externe cu conținut în altă limbă decât româna, excluse din Listening (deciziile AC). */
  other_language: number
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

/**
 * Sentimentul dat AUTOMAT de sursă (Planable), neverificat de un om (deciziile AH). Se arată separat de distribuția revizuită
 * și etichetat ca atare; nu o înlocuiește. `total` = mențiunile cu sentiment pozitiv, neutru sau negativ; `unknown` = cele
 * fără sentiment de la sursă. Procentele și `net` (100 × (pozitive − negative) / total) vin calculate de server.
 */
export interface AutoSentiment {
  total: number
  positive: number
  neutral: number
  negative: number
  unknown: number
  /** Postări din conturile proprii, lăsate deoparte (D-22). */
  owned_excluded: number
  shares: { positive: number | null; neutral: number | null; negative: number | null }
  net: number | null
}

/** O rețea din Listening: mențiunile ei în perioadă, ponderea și seria pe zile (aceleași zile ca `ListeningOverview.days`). */
export interface ListeningPlatform {
  platform: string
  mentions: number
  share: number | null
  /** `null` = zi necitită sau citită incomplet de colectare (lipsă), nu zero. */
  values: Array<number | null>
}

/** Interacțiunile mențiunilor, cum le raportează sursa. `value: null` = nicio mențiune cu interacțiuni raportate (nu zero). */
export interface ListeningEngagement {
  value: number | null
  mentions_with_value: number
  mentions: number
  comparison: { start: IsoDate; end: IsoDate; value: number | null }
  change: { relative_change: number | null; absolute_change: number | null; base_zero: boolean }
}

/** O voce principală: un autor extern (nume și username, cum le trimite sursa) cu mențiunile și interacțiunile lui. */
export interface TopVoice {
  name: string | null
  username: string | null
  platform: string
  mentions: number
  engagement: number | null
}

/** Un topic urmărit în Planable Listening (cuvânt de tip „topic”), citit cel puțin o zi din perioadă. */
export interface ListeningTopic {
  id: string
  label: string
  mentions: number
  status: 'ok' | 'partial'
  /** Fracția zilelor din perioadă citite pentru topic (0-1). */
  coverage: number
  reason: string | null
  engagement: number | null
  sentiment: Omit<AutoSentiment, 'owned_excluded'>
  platforms: Array<{ platform: string; mentions: number }>
}

/** Brandul sau un competitor, în comparația din Listening. `mentions` și `share_of_voice` sunt celulele matricei de Competiție. */
export interface ListeningCompetitionEntity {
  id: string
  name: string
  /** C1, C2… pentru competitori; numele pentru brand. */
  label: string
  kind: 'brand' | 'competitor'
  mentions: CompetitionCell | null
  share_of_voice: CompetitionCell | null
  sentiment: AutoSentiment | null
  /** Competitorul are cel puțin un cuvânt Planable de tip „competitor” atribuit; brandul e mereu `true`. */
  tracked: boolean
}

export interface ListeningCompetition {
  set_version: number
  effective_from: IsoDate
  entities: ListeningCompetitionEntity[]
  /** Pe rețea: mențiunile fiecărei entități (`counts[entity.id]`) și cota brandului, doar când share of voice-ul are valoare. */
  platforms: Array<{ platform: string; counts: Record<string, number>; total: number; brand_share: number | null }>
}

/**
 * Tot ce arată ecranul Listening în afară de feed și de distribuția revizuită (deciziile AH), calculat de server. Volumul
 * folosește regula indicatorului „Mențiuni” (fără mențiunile clar în altă limbă); sentimentul automat și vocile, doar autorii externi.
 */
export interface ListeningOverview {
  days: IsoDate[]
  total: number
  /** Mențiunile pe zi; `null` = zi necitită de colectare, nu zero. */
  series: Array<number | null>
  platforms: ListeningPlatform[]
  engagement: ListeningEngagement
  auto_sentiment: AutoSentiment
  top_voices: TopVoice[]
  /** Câte mențiuni externe sunt și câte au autor: explică o listă de voci goală (de ex. mențiuni colectate înainte de AH). */
  voices_basis: { external: number; with_author: number }
  topics: ListeningTopic[]
  /** Brandul are cel puțin un topic urmărit (în orice perioadă). */
  topics_tracked: boolean
  /** `null` = brandul nu are set de competitori în vigoare la sfârșitul perioadei. */
  competition: ListeningCompetition | null
}
