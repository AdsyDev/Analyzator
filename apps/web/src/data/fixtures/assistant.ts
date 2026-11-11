import { failed, ready, type AiControls, type AiReply, type AssistantProvider, type MetricsProvider, type Role } from '../../contracts'
import { formatMetricValue } from '../../lib/format'

interface Options {
  allowed: Set<string>
  getRole: () => Role
  metrics: MetricsProvider
}

/**
 * AdSy AI în previzualizarea de design: controalele trăiesc în memorie, iar „răspunsul” e compus din metricile fictive ale
 * brandului, fără niciun model. Servește doar la a vedea ecranul; verificarea reală a dovezilor e în funcția server.
 */
export function createAssistantFixtures({ allowed, getRole, metrics }: Options): AssistantProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const policies = new Map<string, AiControls & { monthly_token_cap: number; updated_at: string }>()
  const preferences = new Map<string, { chat: boolean; display: boolean }>()
  const policyOf = (brandId: string) => policies.get(brandId) ?? { chat: true, generation: false, display: true, monthly_token_cap: 2_000_000, updated_at: '2026-11-03T09:00:00+02:00' }
  const preferenceOf = (brandId: string) => preferences.get(brandId) ?? { chat: true, display: true }
  const effectiveOf = (brandId: string): AiControls => {
    const p = policyOf(brandId)
    const u = preferenceOf(brandId)
    return { chat: p.chat && u.chat, generation: p.generation, display: p.display && u.display }
  }

  return {
    settings: async (brandId) => {
      if (!allowed.has(brandId)) return denied
      const admin = getRole() === 'agency_admin'
      return ready({ policy: policyOf(brandId), preference: preferenceOf(brandId), effective: effectiveOf(brandId), can_edit_policy: admin, month_tokens: admin ? 184_300 : null })
    },

    serverStatus: async (brandId) => (allowed.has(brandId) ? ready({ configured: true, model_id: 'previzualizare', prompt_version: 'chat-v1' }) : denied),

    savePolicy: async (brand, policy) => {
      if (!allowed.has(brand.id)) return denied
      if (getRole() !== 'agency_admin') return failed('Nu ai dreptul să schimbi această setare.')
      policies.set(brand.id, { ...policy, updated_at: new Date().toISOString() })
      return ready(null)
    },

    savePreference: async (brand, preference) => {
      if (!allowed.has(brand.id)) return denied
      preferences.set(brand.id, { ...preference })
      return ready(null)
    },

    ask: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const off: AiReply = { status: 'ai_off', answer: null, blocked_by: policyOf(ctx.brandId).chat ? 'preference' : 'policy', cached: false, model_id: null, prompt_version: null }
      if (!effectiveOf(ctx.brandId).chat) return ready(off)
      const keys = ['ga4_sessions', 'gsc_clicks']
      const [bundle, defs] = await Promise.all([metrics.metrics(ctx, keys), metrics.definitions(keys)])
      const label = (key: string) => (defs.kind === 'ready' ? defs.data.find((d) => d.metric_key === key)?.label : undefined) ?? key
      const withValue = bundle.items.filter((m) => m.value !== null)
      const base = { period: { start: ctx.period.from, end: ctx.period.to }, requires_review: true as const }
      if (withValue.length === 0) {
        return ready({ status: 'insufficient_evidence', answer: { ...base, summary: '', evidence: [], limitations: 'Indicatorii de trafic și de search nu au date în perioada aleasă.', proposed_action: null }, blocked_by: null, cached: false, model_id: 'previzualizare', prompt_version: 'chat-v1' })
      }
      return ready({
        status: 'ok',
        answer: {
          ...base,
          summary: `${withValue.map((m) => `${label(m.metric_key)}: ${formatMetricValue(m.value, m.unit, m.currency)}`).join('. ')}.`,
          evidence: withValue.map((m) => ({ id: `metric:${m.metric_key}`, kind: 'metric' as const, label: label(m.metric_key), metric_key: m.metric_key })),
          limitations: 'Răspuns compus din date fictive, pentru previzualizarea ecranului.',
          proposed_action: null,
        },
        blocked_by: null,
        cached: false,
        model_id: 'previzualizare',
        prompt_version: 'chat-v1',
      })
    },
  }
}
