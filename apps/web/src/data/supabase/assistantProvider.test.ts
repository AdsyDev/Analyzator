import { describe, expect, it } from 'vitest'
import type { Brand, QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseAssistant } from './assistantProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-10-14', to: '2026-11-10' }, comparison: 'year_ago', filters: {} }
const brand = { id: 'b1', tenant_id: 't1' } as Brand
const settings = { tenant_id: 't1', policy: { chat: true, generation: false, display: true, monthly_token_cap: '2000000', updated_at: '2026-11-11T09:00:00+00:00' }, preference: { chat: true, display: false }, effective: { chat: true, generation: false, display: false }, can_edit_policy: true, month_tokens: 1500 }
const answer = { summary: 'Sesiunile au fost 21.611.', evidence: [{ id: 'metric:ga4_sessions', kind: 'metric', label: 'Sesiuni', metric_key: 'ga4_sessions' }, { id: 'insight:i1', kind: 'insight', label: 'Analiză', insight_id: 'i1' }], metric_keys: ['ga4_sessions'], limitations: 'Fără conversii.', proposed_action: null, period: { start: '2026-10-14', end: '2026-11-10' }, requires_review: true }

describe('createSupabaseAssistant', () => {
  it('setările vin din brand_ai_settings; starea efectivă e cea calculată de server', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: settings }) })
    const r = await createSupabaseAssistant(client).settings('b1')
    expect(rpcs[0]).toEqual({ fn: 'brand_ai_settings', args: { p_brand_id: 'b1' } })
    expect(r.kind === 'ready' && r.data).toEqual({ policy: { chat: true, generation: false, display: true, monthly_token_cap: 2000000, updated_at: '2026-11-11T09:00:00+00:00' }, preference: { chat: true, display: false }, effective: { chat: true, generation: false, display: false }, can_edit_policy: true, month_tokens: 1500 })
  })

  it('setări incomplete încalcă contractul; fără acces, mesajul de acces', async () => {
    const bad = fakeDataClient({ rpc: () => ({ data: { ...settings, effective: { chat: 'da' } } }) })
    expect((await createSupabaseAssistant(bad.client).settings('b1')).kind).toBe('error')
    const denied = fakeDataClient({ rpc: () => ({ error: { code: '42501', message: 'x' } }) })
    expect(await createSupabaseAssistant(denied.client).settings('b1')).toEqual({ kind: 'error', message: 'Nu ai acces la acest spațiu de brand.' })
  })

  it('politica: prima salvare inserează, cu autorul din sesiune', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u1' })
    expect((await createSupabaseAssistant(client).savePolicy(brand, { chat: true, generation: false, display: true, monthly_token_cap: 500000.4 })).kind).toBe('ready')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ table: 'ai_brand_policies', op: 'insert', payload: { tenant_id: 't1', brand_id: 'b1', chat_enabled: true, generation_enabled: false, display_enabled: true, monthly_token_cap: 500000, updated_by: 'u1' } })
  })

  it('politica existentă se actualizează pe rândul brandului; refuzul RLS are mesajul lui', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u1', errors: { 'ai_brand_policies:insert': { code: '23505', message: 'dup' } } })
    expect((await createSupabaseAssistant(client).savePolicy(brand, { chat: false, generation: false, display: false, monthly_token_cap: 1 })).kind).toBe('ready')
    expect(calls[1]).toMatchObject({ table: 'ai_brand_policies', op: 'update', filters: [['tenant_id', 'eq', 't1'], ['brand_id', 'eq', 'b1']], payload: { chat_enabled: false, updated_by: 'u1' } })
    const rls = fakeDataClient({ userId: 'u1', errors: { ai_brand_policies: { code: '42501', message: 'rls' } } })
    expect(await createSupabaseAssistant(rls.client).savePolicy(brand, { chat: true, generation: true, display: true, monthly_token_cap: 1 })).toEqual({ kind: 'error', message: 'Nu ai dreptul să schimbi această setare.' })
  })

  it('preferința se scrie doar pe rândul utilizatorului din sesiune', async () => {
    const first = fakeDataClient({ userId: 'u1' })
    await createSupabaseAssistant(first.client).savePreference(brand, { chat: false, display: true })
    expect(first.calls[0]).toMatchObject({ table: 'ai_user_preferences', op: 'insert', payload: { tenant_id: 't1', brand_id: 'b1', user_id: 'u1', chat_enabled: false, display_enabled: true } })
    const again = fakeDataClient({ userId: 'u1', errors: { 'ai_user_preferences:insert': { code: '23505', message: 'dup' } } })
    await createSupabaseAssistant(again.client).savePreference(brand, { chat: true, display: true })
    expect(again.calls[1]).toMatchObject({ op: 'update', filters: [['tenant_id', 'eq', 't1'], ['brand_id', 'eq', 'b1'], ['user_id', 'eq', 'u1']] })
    expect(Object.keys(again.calls[1]!.payload as object)).toEqual(['chat_enabled', 'display_enabled'])
    const anon = fakeDataClient({ userId: null })
    expect((await createSupabaseAssistant(anon.client).savePreference(brand, { chat: true, display: true })).kind).toBe('error')
    expect(anon.calls).toHaveLength(0)
  })

  it('întrebarea pleacă la funcția server cu brandul, perioada și comparația; răspunsul e validat', async () => {
    const { client, invocations } = fakeDataClient({ invoke: () => ({ data: { status: 'ok', answer, cached: true, model_id: 'model-x', prompt_version: 'chat-v1' } }) })
    const r = await createSupabaseAssistant(client).ask(ctx, 'Cum au mers sesiunile?')
    expect(invocations[0]).toEqual({ name: 'adsy-ai', body: { action: 'chat', brand_id: 'b1', question: 'Cum au mers sesiunile?', period: { start: '2026-10-14', end: '2026-11-10' }, comparison: 'year_ago' } })
    if (r.kind !== 'ready') throw new Error('așteptam răspuns')
    expect([r.data.status, r.data.cached, r.data.model_id]).toEqual(['ok', true, 'model-x'])
    expect(r.data.answer?.evidence).toEqual([{ id: 'metric:ga4_sessions', kind: 'metric', label: 'Sesiuni', metric_key: 'ga4_sessions' }, { id: 'insight:i1', kind: 'insight', label: 'Analiză', insight_id: 'i1' }])
    expect(r.data.answer?.requires_review).toBe(true)
  })

  it('stările fără răspuns trec ca atare; o stare necunoscută sau un răspuns fără revizuire obligatorie încalcă contractul', async () => {
    const off = fakeDataClient({ invoke: () => ({ data: { status: 'ai_off', blocked_by: 'policy' } }) })
    expect(await createSupabaseAssistant(off.client).ask(ctx, 'q?')).toEqual({ kind: 'ready', data: { status: 'ai_off', answer: null, blocked_by: 'policy', cached: false, model_id: null, prompt_version: null } })
    for (const data of [{ status: 'inventat' }, { status: 'ok', answer: { ...answer, requires_review: false } }, { status: 'ok', answer: { ...answer, evidence: [{ id: 'x', kind: 'altceva', label: 'y' }] } }]) {
      const bad = fakeDataClient({ invoke: () => ({ data }) })
      expect((await createSupabaseAssistant(bad.client).ask(ctx, 'q?')).kind).toBe('error')
    }
  })

  it('eroarea funcției server ajunge ca mesaj; starea serverului spune doar dacă e configurat', async () => {
    const err = fakeDataClient({ invoke: () => ({ error: { context: { json: async () => ({ error: 'Nu ai acces la acest spațiu de brand.' }) } } }) })
    expect(await createSupabaseAssistant(err.client).ask(ctx, 'q?')).toEqual({ kind: 'error', message: 'Nu ai acces la acest spațiu de brand.' })
    const st = fakeDataClient({ invoke: () => ({ data: { configured: false, model_id: null, prompt_version: 'chat-v1' } }) })
    expect(await createSupabaseAssistant(st.client).serverStatus('b1')).toEqual({ kind: 'ready', data: { configured: false, model_id: null, prompt_version: 'chat-v1' } })
    expect(st.invocations[0]).toEqual({ name: 'adsy-ai', body: { action: 'status', brand_id: 'b1' } })
  })
})
