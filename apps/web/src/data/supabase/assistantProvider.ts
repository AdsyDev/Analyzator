import { AI_DRAFT_STATUSES, AI_REPLY_STATUSES, DOCUMENT_STATUSES, DOCUMENT_TYPES, failed, ready, type AiAnswer, type AiDraftResult, type AiDraftStatus, type BrandDocument, type AiEvidenceRef, type AiReply, type AiReplyStatus, type AiSettings, type AssistantProvider } from '../../contracts'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'
import { splitIntoFragments, MAX_FRAGMENTS } from '../../lib/fragments'
import { functionError } from './sourcesProvider'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const FUNCTION = 'adsy-ai'
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

function writeError(e: { code?: string }, fallback: string): string {
  if (e.code === '42501') return 'Nu ai dreptul să schimbi această setare.'
  if (e.code === '23514') return 'Plafonul lunar trebuie să fie un număr întreg mai mare ca zero.'
  return fallback
}

/** Mesajele triggerelor de pe `brand_documents` (reguli de aprobare) ajung la utilizator; erorile de schemă rămân generice. */
function documentError(e: { code?: string; message?: string }, fallback: string): string {
  if (e.code === '42501') return e.message && /aprobă|retrage|editează|ciornă/.test(e.message) ? e.message : 'Nu ai dreptul să schimbi acest document.'
  if (e.code === '23514' && e.message && /Aprobarea|fără text|Tranziție/.test(e.message)) return e.message
  if (e.code === '23514') return 'Datele documentului nu sunt valide: verifică tipul, țara (două litere), limba (două litere) și valabilitatea.'
  return fallback
}

function parseAnswer(v: unknown): AiAnswer {
  const a = v as Record<string, unknown> | null
  const period = a?.period as { start?: unknown; end?: unknown } | undefined
  if (!a || typeof a.summary !== 'string' || typeof a.limitations !== 'string' || !Array.isArray(a.evidence) || a.requires_review !== true || typeof period?.start !== 'string' || typeof period.end !== 'string') throw new Error(CONTRACT)
  const evidence = a.evidence.map((e): AiEvidenceRef => {
    const o = e as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.label !== 'string' || (o.kind !== 'metric' && o.kind !== 'insight' && o.kind !== 'document')) throw new Error(CONTRACT)
    return { id: o.id, kind: o.kind, label: o.label, ...(typeof o.metric_key === 'string' ? { metric_key: o.metric_key } : {}), ...(typeof o.insight_id === 'string' ? { insight_id: o.insight_id } : {}), ...(typeof o.document_id === 'string' ? { document_id: o.document_id } : {}) }
  })
  return { summary: a.summary, evidence, limitations: a.limitations, proposed_action: typeof a.proposed_action === 'string' ? a.proposed_action : null, period: { start: period.start, end: period.end }, requires_review: true }
}

/**
 * AdSy AI prin sesiunea utilizatorului: setările din `brand_ai_settings` (RLS), scrierile direct în tabele (RLS decide
 * cine poate), iar întrebările prin funcția server. Interfața nu cheamă niciun model și nu are nicio cheie.
 */
export function createSupabaseAssistant(client: DataClient): AssistantProvider {
  const me = async () => (await client.auth.getSession()).data.session?.user.id ?? null

  return {
    async settings(brandId) {
      const { data, error } = await client.rpc('brand_ai_settings', { p_brand_id: brandId })
      if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
      const d = data as { policy?: Record<string, unknown>; preference?: Record<string, unknown>; effective?: Record<string, unknown>; can_edit_policy?: unknown; can_generate?: unknown; month_tokens?: unknown } | null
      const p = d?.policy
      const pref = d?.preference
      const eff = d?.effective
      if (!p || !pref || !eff || !bool(p.chat) || !bool(p.generation) || !bool(p.display) || !bool(pref.chat) || !bool(pref.display) || !bool(eff.chat) || !bool(eff.generation) || !bool(eff.display) || !bool(d?.can_edit_policy)) return failed(CONTRACT)
      const out: AiSettings = {
        policy: { chat: p.chat, generation: p.generation, display: p.display, monthly_token_cap: num(p.monthly_token_cap), updated_at: typeof p.updated_at === 'string' ? p.updated_at : null },
        preference: { chat: pref.chat, display: pref.display },
        effective: { chat: eff.chat, generation: eff.generation, display: eff.display },
        can_edit_policy: d.can_edit_policy as boolean,
        // Un server mai vechi nu trimite câmpul: fără el, generarea nu se oferă.
        can_generate: d.can_generate === true,
        month_tokens: num(d.month_tokens),
      }
      return ready(out)
    },

    async serverStatus(brandId) {
      const { data, error } = await client.functions.invoke(FUNCTION, { body: { action: 'status', brand_id: brandId } })
      if (error) return failed(await functionError(error))
      const d = data as { configured?: unknown; model_id?: unknown; prompt_version?: unknown } | null
      if (!d || !bool(d.configured) || typeof d.prompt_version !== 'string') return failed(CONTRACT)
      return ready({ configured: d.configured, model_id: typeof d.model_id === 'string' ? d.model_id : null, prompt_version: d.prompt_version })
    },

    async savePolicy(brand, policy) {
      const user = await me()
      if (!user) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const values = { chat_enabled: policy.chat, generation_enabled: policy.generation, display_enabled: policy.display, monthly_token_cap: Math.round(policy.monthly_token_cap), updated_by: user }
      const inserted = await client.from('ai_brand_policies').insert({ tenant_id: brand.tenant_id, brand_id: brand.id, ...values })
      if (!inserted.error) return ready(null)
      // Politica există deja: se actualizează rândul brandului.
      if (inserted.error.code !== '23505') return failed(writeError(inserted.error, 'Politica nu a putut fi salvată. Reîncearcă.'))
      const { error } = await client.from('ai_brand_policies').update(values).eq('tenant_id', brand.tenant_id).eq('brand_id', brand.id)
      return error ? failed(writeError(error, 'Politica nu a putut fi salvată. Reîncearcă.')) : ready(null)
    },

    async savePreference(brand, preference) {
      const user = await me()
      if (!user) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const values = { chat_enabled: preference.chat, display_enabled: preference.display }
      const inserted = await client.from('ai_user_preferences').insert({ tenant_id: brand.tenant_id, brand_id: brand.id, user_id: user, ...values })
      if (!inserted.error) return ready(null)
      if (inserted.error.code !== '23505') return failed(writeError(inserted.error, 'Preferința nu a putut fi salvată. Reîncearcă.'))
      const { error } = await client.from('ai_user_preferences').update(values).eq('tenant_id', brand.tenant_id).eq('brand_id', brand.id).eq('user_id', user)
      return error ? failed(writeError(error, 'Preferința nu a putut fi salvată. Reîncearcă.')) : ready(null)
    },

    async ask(ctx, question) {
      const { data, error } = await client.functions.invoke(FUNCTION, {
        body: { action: 'chat', brand_id: ctx.brandId, question, period: { start: ctx.period.from, end: ctx.period.to }, comparison: ctx.comparison },
      })
      if (error) return failed(await functionError(error))
      const d = data as Record<string, unknown> | null
      if (!d || !(AI_REPLY_STATUSES as readonly string[]).includes(String(d.status))) return failed(CONTRACT)
      try {
        const reply: AiReply = {
          status: d.status as AiReplyStatus,
          answer: d.answer === undefined || d.answer === null ? null : parseAnswer(d.answer),
          blocked_by: d.blocked_by === 'policy' || d.blocked_by === 'preference' ? d.blocked_by : null,
          cached: d.cached === true,
          model_id: typeof d.model_id === 'string' ? d.model_id : null,
          prompt_version: typeof d.prompt_version === 'string' ? d.prompt_version : null,
        }
        return ready(reply)
      } catch {
        return failed(CONTRACT)
      }
    },

    async generateInsight(ctx) {
      const { data, error } = await client.functions.invoke(FUNCTION, {
        body: { action: 'generate_insight', brand_id: ctx.brandId, period: { start: ctx.period.from, end: ctx.period.to }, comparison: ctx.comparison },
      })
      if (error) return failed(await functionError(error))
      const d = data as Record<string, unknown> | null
      if (!d || !(AI_DRAFT_STATUSES as readonly string[]).includes(String(d.status))) return failed(CONTRACT)
      // `ok` fără id-ul ciornei ar însemna o ciornă pe care interfața nu o poate arăta: e în afara contractului.
      if (d.status === 'ok' && typeof d.insight_id !== 'string') return failed(CONTRACT)
      const result: AiDraftResult = {
        status: d.status as AiDraftStatus,
        insight_id: typeof d.insight_id === 'string' ? d.insight_id : null,
        existing: d.existing === true,
        blocked_by: d.blocked_by === 'policy' || d.blocked_by === 'preference' ? d.blocked_by : null,
      }
      return ready(result)
    },

    async documents(brandId) {
      const { data, error } = await client
        .from('brand_documents')
        .select('id, title, doc_type, product, country, language, version, owner, status, approved_at, valid_from, valid_to, created_at, brand_document_fragments(count)')
        .eq('brand_id', brandId)
        .order('created_at', { ascending: false })
      if (error) return failed(QUERY_FAILED)
      if (!Array.isArray(data)) return failed(CONTRACT)
      const out: BrandDocument[] = []
      for (const row of data as unknown as Array<Record<string, unknown>>) {
        if (typeof row.id !== 'string' || typeof row.title !== 'string' || !(DOCUMENT_TYPES as readonly unknown[]).includes(row.doc_type) || !(DOCUMENT_STATUSES as readonly unknown[]).includes(row.status)) return failed(CONTRACT)
        const count = Array.isArray(row.brand_document_fragments) ? num((row.brand_document_fragments[0] as { count?: unknown } | undefined)?.count) : null
        const text = (v: unknown) => (typeof v === 'string' ? v : null)
        out.push({
          id: row.id, title: row.title, doc_type: row.doc_type as BrandDocument['doc_type'], product: text(row.product), country: String(row.country ?? ''), language: String(row.language ?? ''),
          version: String(row.version ?? ''), owner: text(row.owner), status: row.status as BrandDocument['status'], approved_at: text(row.approved_at), valid_from: text(row.valid_from), valid_to: text(row.valid_to),
          fragments: count ?? 0, created_at: String(row.created_at ?? ''),
        })
      }
      return ready(out)
    },

    async addDocument(brand, doc) {
      const user = await me()
      if (!user) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const fragments = splitIntoFragments(doc.text)
      if (fragments.length === 0) return failed('Documentul nu are text.')
      if (fragments.length > MAX_FRAGMENTS) return failed('Documentul e prea lung pentru o singură intrare. Împarte-l în două documente.')
      const base = { tenant_id: brand.tenant_id, brand_id: brand.id }
      const { data, error } = await client
        .from('brand_documents')
        .insert({ ...base, title: doc.title.trim(), doc_type: doc.doc_type, product: doc.product?.trim() || null, country: doc.country.trim().toUpperCase(), language: doc.language.trim().toLowerCase(), version: doc.version.trim(), owner: doc.owner?.trim() || null, valid_from: doc.valid_from, valid_to: doc.valid_to, created_by: user })
        .select('id')
        .single()
      if (error) return failed(documentError(error, 'Documentul nu a putut fi salvat. Reîncearcă.'))
      const id = (data as { id?: string } | null)?.id
      if (!id) return failed(CONTRACT)
      const written = await client.from('brand_document_fragments').insert(fragments.map((f, i) => ({ ...base, document_id: id, position: i + 1, section_ref: f.section_ref, content: f.content })))
      if (written.error) {
        // Fără text, documentul nu are rost: ciorna goală se șterge, ca să nu rămână pe jumătate.
        await client.from('brand_documents').delete().eq('id', id).eq('brand_id', brand.id)
        return failed(documentError(written.error, 'Textul documentului nu a putut fi salvat. Reîncearcă.'))
      }
      return ready({ id })
    },

    async setDocumentStatus(brand, id, status) {
      const { data, error } = await client.from('brand_documents').update({ status }).eq('id', id).eq('brand_id', brand.id).select('id')
      if (error) return failed(documentError(error, 'Statusul documentului nu a putut fi schimbat. Reîncearcă.'))
      // RLS nu oferă rândul la scriere celui fără drept: zero rânduri schimbate înseamnă refuz, nu reușită.
      return Array.isArray(data) && data.length === 1 ? ready(null) : failed('Nu ai dreptul să schimbi acest document.')
    },

    async deleteDocument(brand, id) {
      const { data, error } = await client.from('brand_documents').delete().eq('id', id).eq('brand_id', brand.id).select('id')
      if (error) return failed(documentError(error, 'Documentul nu a putut fi șters. Reîncearcă.'))
      return Array.isArray(data) && data.length === 1 ? ready(null) : failed('Doar o ciornă se poate șterge.')
    },
  }
}
