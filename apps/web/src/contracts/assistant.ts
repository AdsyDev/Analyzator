import type { IsoDate, IsoDateTime } from './common'

/**
 * AdSy AI (Etapa 4, deciziile M). Contractul serverului: `brand_ai_settings` și funcția `adsy-ai`
 * (`docs/contracts/adsy-ai.md`). Starea efectivă o calculează serverul; interfața doar o arată.
 */
export interface AiControls {
  chat: boolean
  /** Generarea de analize de către AdSy AI; nu are preferință personală. */
  generation: boolean
  /** Afișarea conținutului generat de AdSy AI. */
  display: boolean
}

export interface AiSettings {
  /** Politica brandului; fără politică salvată, toate sunt oprite. */
  policy: AiControls & { monthly_token_cap: number | null; updated_at: IsoDateTime | null }
  /** Preferința utilizatorului curent; poate doar să restrângă politica. */
  preference: { chat: boolean; display: boolean }
  /** Politica și preferința împreună: ce e pornit de fapt pentru acest utilizator. */
  effective: AiControls
  can_edit_policy: boolean
  /** Utilizatorul poate cere o ciornă de analiză (rolurile care scriu analize). Controalele se verifică separat. */
  can_generate: boolean
  /** Tokenii consumați de brand în luna curentă; `null` pentru cine nu vede consumul brandului. */
  month_tokens: number | null
}

export type AiPolicyInput = AiControls & { monthly_token_cap: number }
export type AiPreferenceInput = { chat: boolean; display: boolean }

/** Dacă serverul are cheia și modelul configurate. Cheia nu ajunge niciodată în interfață. */
export interface AiServerStatus {
  configured: boolean
  model_id: string | null
  prompt_version: string
}

export interface AiEvidenceRef {
  id: string
  /** `document` = fragment dintr-un document aprobat de brand: ce afirmă brandul, nu o măsurătoare. */
  kind: 'metric' | 'insight' | 'document'
  label: string
  metric_key?: string
  insight_id?: string
  document_id?: string
}

export interface AiAnswer {
  /** Gol când răspunsul nu a trecut verificarea dovezilor. */
  summary: string
  evidence: AiEvidenceRef[]
  limitations: string
  proposed_action: string | null
  period: { start: IsoDate; end: IsoDate }
  /** Mereu adevărat: răspunsul e o ipoteză pentru echipă, nu o analiză validată. */
  requires_review: true
}

export const AI_REPLY_STATUSES = ['ok', 'insufficient_evidence', 'out_of_scope', 'rejected', 'ai_off', 'not_configured', 'budget_exhausted', 'rate_limited', 'model_error'] as const
export type AiReplyStatus = (typeof AI_REPLY_STATUSES)[number]

export interface AiReply {
  status: AiReplyStatus
  /** Prezent la `ok`, `insufficient_evidence`, `out_of_scope` și `rejected`. */
  answer: AiAnswer | null
  /** La `ai_off`: cine a oprit chatul. */
  blocked_by: 'policy' | 'preference' | null
  cached: boolean
  model_id: string | null
  prompt_version: string | null
}

export const AI_DRAFT_STATUSES = ['ok', 'insufficient_evidence', 'rejected', 'ai_off', 'not_configured', 'budget_exhausted', 'rate_limited', 'model_error'] as const
export type AiDraftStatus = (typeof AI_DRAFT_STATUSES)[number]

/**
 * Rezultatul cererii de ciornă. La `ok`, ciorna e deja în lista de analize, marcată ca generată; textul ei nu vine pe
 * aici. Orice alt status înseamnă că nu s-a salvat nimic.
 */
export interface AiDraftResult {
  status: AiDraftStatus
  insight_id: string | null
  /** Pe aceleași date exista deja o ciornă generată: s-a întors aceea, fără o cerere nouă către model. */
  existing: boolean
  blocked_by: 'policy' | 'preference' | null
}

export const DOCUMENT_TYPES = ['product_info', 'claims', 'brand_guidelines', 'faq', 'other'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const DOCUMENT_STATUSES = ['draft', 'approved', 'retired'] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]

/**
 * Un document al brandului din baza de context AdSy AI (deciziile P). Intră în context doar cât e `approved` și valabil
 * la data întrebării. Clientul primește doar documentele aprobate (RLS).
 */
export interface BrandDocument {
  id: string
  title: string
  doc_type: DocumentType
  product: string | null
  country: string
  language: string
  version: string
  /** Cine răspunde de document la brand. */
  owner: string | null
  status: DocumentStatus
  approved_at: IsoDateTime | null
  valid_from: IsoDate | null
  valid_to: IsoDate | null
  /** Numărul de fragmente în care a fost împărțit textul. */
  fragments: number
  created_at: IsoDateTime
}

export interface NewBrandDocument {
  title: string
  doc_type: DocumentType
  product: string | null
  country: string
  language: string
  version: string
  owner: string | null
  valid_from: IsoDate | null
  valid_to: IsoDate | null
  /** Textul documentului; se împarte în fragmente la salvare. Un rând care începe cu „#” e titlu de secțiune. */
  text: string
}
