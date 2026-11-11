import { AI_REPLY_STATUSES, failed, ready, type AiAnswer, type AiEvidenceRef, type AiReply, type AiReplyStatus, type AiSettings, type AssistantProvider } from '../../contracts'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'
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

function parseAnswer(v: unknown): AiAnswer {
  const a = v as Record<string, unknown> | null
  const period = a?.period as { start?: unknown; end?: unknown } | undefined
  if (!a || typeof a.summary !== 'string' || typeof a.limitations !== 'string' || !Array.isArray(a.evidence) || a.requires_review !== true || typeof period?.start !== 'string' || typeof period.end !== 'string') throw new Error(CONTRACT)
  const evidence = a.evidence.map((e): AiEvidenceRef => {
    const o = e as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.label !== 'string' || (o.kind !== 'metric' && o.kind !== 'insight')) throw new Error(CONTRACT)
    return { id: o.id, kind: o.kind, label: o.label, ...(typeof o.metric_key === 'string' ? { metric_key: o.metric_key } : {}), ...(typeof o.insight_id === 'string' ? { insight_id: o.insight_id } : {}) }
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
      const d = data as { policy?: Record<string, unknown>; preference?: Record<string, unknown>; effective?: Record<string, unknown>; can_edit_policy?: unknown; month_tokens?: unknown } | null
      const p = d?.policy
      const pref = d?.preference
      const eff = d?.effective
      if (!p || !pref || !eff || !bool(p.chat) || !bool(p.generation) || !bool(p.display) || !bool(pref.chat) || !bool(pref.display) || !bool(eff.chat) || !bool(eff.generation) || !bool(eff.display) || !bool(d?.can_edit_policy)) return failed(CONTRACT)
      const out: AiSettings = {
        policy: { chat: p.chat, generation: p.generation, display: p.display, monthly_token_cap: num(p.monthly_token_cap), updated_at: typeof p.updated_at === 'string' ? p.updated_at : null },
        preference: { chat: pref.chat, display: pref.display },
        effective: { chat: eff.chat, generation: eff.generation, display: eff.display },
        can_edit_policy: d.can_edit_policy as boolean,
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
  }
}
