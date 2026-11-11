import { describe, expect, it } from 'vitest'
import type { Brand, QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseAssistant } from './assistantProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-10-14', to: '2026-11-10' }, comparison: 'year_ago', filters: {} }
const brand = { id: 'b1', tenant_id: 't1' } as Brand
const settings = { tenant_id: 't1', policy: { chat: true, generation: false, display: true, monthly_token_cap: '2000000', updated_at: '2026-11-11T09:00:00+00:00' }, preference: { chat: true, display: false }, effective: { chat: true, generation: false, display: false }, can_edit_policy: true, can_generate: true, month_tokens: 1500 }
const answer = { summary: 'Sesiunile au fost 21.611.', evidence: [{ id: 'metric:ga4_sessions', kind: 'metric', label: 'Sesiuni', metric_key: 'ga4_sessions' }, { id: 'insight:i1', kind: 'insight', label: 'Analiză', insight_id: 'i1' }], metric_keys: ['ga4_sessions'], limitations: 'Fără conversii.', proposed_action: null, period: { start: '2026-10-14', end: '2026-11-10' }, requires_review: true }

describe('createSupabaseAssistant', () => {
  it('setările vin din brand_ai_settings; starea efectivă e cea calculată de server', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: settings }) })
    const r = await createSupabaseAssistant(client).settings('b1')
    expect(rpcs[0]).toEqual({ fn: 'brand_ai_settings', args: { p_brand_id: 'b1' } })
    expect(r.kind === 'ready' && r.data).toEqual({ policy: { chat: true, generation: false, display: true, monthly_token_cap: 2000000, updated_at: '2026-11-11T09:00:00+00:00' }, preference: { chat: true, display: false }, effective: { chat: true, generation: false, display: false }, can_edit_policy: true, can_generate: true, month_tokens: 1500 })
  })

  it('fără `can_generate` de la server (versiune mai veche), generarea nu se oferă', async () => {
    const { can_generate: _omit, ...old } = settings
    const { client } = fakeDataClient({ rpc: () => ({ data: old }) })
    const r = await createSupabaseAssistant(client).settings('b1')
    expect(r.kind === 'ready' && r.data.can_generate).toBe(false)
  })

  it('ciorna se cere funcției server cu brandul, perioada și comparația; întoarce doar id-ul ciornei, nu textul', async () => {
    const { client, invocations } = fakeDataClient({ invoke: () => ({ data: { status: 'ok', insight_id: 'i-9', existing: false, cached: false, model_id: 'm', prompt_version: 'insight-v1', title: 'nu trebuie să treacă' } }) })
    const r = await createSupabaseAssistant(client).generateInsight(ctx)
    expect(invocations[0]).toEqual({ name: 'adsy-ai', body: { action: 'generate_insight', brand_id: 'b1', period: { start: '2026-10-14', end: '2026-11-10' }, comparison: 'year_ago' } })
    expect(r).toEqual({ kind: 'ready', data: { status: 'ok', insight_id: 'i-9', existing: false, blocked_by: null } })
  })

  it('ciornă: stările fără salvare trec ca atare; `ok` fără id sau o stare necunoscută încalcă contractul', async () => {
    const off = fakeDataClient({ invoke: () => ({ data: { status: 'ai_off', blocked_by: 'preference' } }) })
    expect(await createSupabaseAssistant(off.client).generateInsight(ctx)).toEqual({ kind: 'ready', data: { status: 'ai_off', insight_id: null, existing: false, blocked_by: 'preference' } })
    const existing = fakeDataClient({ invoke: () => ({ data: { status: 'ok', insight_id: 'i-1', existing: true } }) })
    expect(await createSupabaseAssistant(existing.client).generateInsight(ctx)).toEqual({ kind: 'ready', data: { status: 'ok', insight_id: 'i-1', existing: true, blocked_by: null } })
    for (const data of [{ status: 'ok' }, { status: 'out_of_scope' }, { status: 'published', insight_id: 'i-1' }, null]) {
      const bad = fakeDataClient({ invoke: () => ({ data }) })
      expect((await createSupabaseAssistant(bad.client).generateInsight(ctx)).kind).toBe('error')
    }
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

  describe('documente', () => {
    const row = { id: 'd1', brand_id: 'b1', tenant_id: 't1', title: 'Prospect', doc_type: 'product_info', product: null, country: 'RO', language: 'ro', version: '1.0', owner: 'Medical', status: 'approved', approved_at: '2026-11-01T10:00:00+00:00', valid_from: '2026-01-01', valid_to: null, created_at: '2026-10-30T10:00:00+00:00', brand_document_fragments: [{ count: 3 }] }
    const doc = { title: ' Prospect ', doc_type: 'product_info' as const, product: ' ', country: 'ro', language: 'RO', version: ' 2.0 ', owner: ' Medical ', valid_from: '2026-01-01', valid_to: null, text: '# Administrare\nUn comprimat pe zi.\n\n# Păstrare\nLa temperatura camerei.' }

    it('lista se citește doar pentru brandul cerut și numără fragmentele; alt brand nu apare', async () => {
      const { client, calls } = fakeDataClient({ tables: { brand_documents: [row, { ...row, id: 'd2', brand_id: 'b2', title: 'Alt brand' }] } })
      const r = await createSupabaseAssistant(client).documents('b1')
      expect(calls[0]).toMatchObject({ table: 'brand_documents', filters: [['brand_id', 'eq', 'b1']] })
      expect(r.kind === 'ready' && r.data.map((d) => [d.id, d.title, d.status, d.fragments, d.owner, d.valid_to])).toEqual([['d1', 'Prospect', 'approved', 3, 'Medical', null]])
    })

    it('un status sau un tip necunoscut încalcă contractul; eroarea bazei rămâne generică', async () => {
      const bad = fakeDataClient({ tables: { brand_documents: [{ ...row, status: 'publicat' }] } })
      expect((await createSupabaseAssistant(bad.client).documents('b1')).kind).toBe('error')
      const err = fakeDataClient({ errors: { brand_documents: { code: '42P01', message: 'relation "brand_documents" does not exist' } } })
      const r = await createSupabaseAssistant(err.client).documents('b1')
      expect(r.kind === 'error' && r.message).not.toContain('brand_documents')
    })

    it('adăugarea scrie ciorna cu autorul din sesiune, apoi fragmentele cu secțiunile lor; statusul nu se trimite', async () => {
      const { client, calls } = fakeDataClient({ userId: 'u1' })
      const r = await createSupabaseAssistant(client).addDocument(brand, doc)
      expect(r).toEqual({ kind: 'ready', data: { id: 'new-id' } })
      expect(calls[0]).toMatchObject({ table: 'brand_documents', op: 'insert', payload: { tenant_id: 't1', brand_id: 'b1', title: 'Prospect', doc_type: 'product_info', product: null, country: 'RO', language: 'ro', version: '2.0', owner: 'Medical', valid_from: '2026-01-01', valid_to: null, created_by: 'u1' } })
      expect(calls[0]!.payload).not.toHaveProperty('status')
      expect(calls[0]!.payload).not.toHaveProperty('approved_at')
      expect(calls[1]).toMatchObject({ table: 'brand_document_fragments', op: 'insert', payload: [
        { tenant_id: 't1', brand_id: 'b1', document_id: 'new-id', position: 1, section_ref: 'Administrare', content: 'Un comprimat pe zi.' },
        { tenant_id: 't1', brand_id: 'b1', document_id: 'new-id', position: 2, section_ref: 'Păstrare', content: 'La temperatura camerei.' },
      ] })
    })

    it('fără text nu se scrie nimic; dacă fragmentele nu se pot scrie, ciorna se șterge', async () => {
      const empty = fakeDataClient({ userId: 'u1' })
      expect(await createSupabaseAssistant(empty.client).addDocument(brand, { ...doc, text: '# Doar titlu' })).toEqual({ kind: 'error', message: 'Documentul nu are text.' })
      expect(empty.calls).toHaveLength(0)
      const broken = fakeDataClient({ userId: 'u1', errors: { 'brand_document_fragments:insert': { code: '23514', message: 'check' } } })
      expect((await createSupabaseAssistant(broken.client).addDocument(brand, doc)).kind).toBe('error')
      expect(broken.calls.map((c) => [c.table, c.op])).toEqual([['brand_documents', 'insert'], ['brand_document_fragments', 'insert'], ['brand_documents', 'delete']])
      expect(broken.calls[2]!.filters).toEqual([['id', 'eq', 'new-id'], ['brand_id', 'eq', 'b1']])
    })

    it('aprobarea și retragerea schimbă doar statusul, pe rândul brandului; zero rânduri atinse înseamnă refuz', async () => {
      const tables = { brand_documents: [{ ...row, status: 'draft' }] }
      const { client, calls } = fakeDataClient({ tables })
      expect(await createSupabaseAssistant(client).setDocumentStatus(brand, 'd1', 'approved')).toEqual({ kind: 'ready', data: null })
      expect(calls[0]).toMatchObject({ table: 'brand_documents', op: 'update', payload: { status: 'approved' }, filters: [['id', 'eq', 'd1'], ['brand_id', 'eq', 'b1']] })
      // Un document care nu e al acestui brand (sau pe care RLS nu îl oferă): nu se schimbă nimic.
      expect(await createSupabaseAssistant(client).setDocumentStatus(brand, 'altul', 'retired')).toEqual({ kind: 'error', message: 'Nu ai dreptul să schimbi acest document.' })
    })

    it('mesajul regulii de aprobare ajunge la utilizator; o eroare de schemă nu', async () => {
      const rule = fakeDataClient({ errors: { 'brand_documents:update': { code: '23514', message: 'Aprobarea cere responsabilul documentului la brand și data de început a valabilității' } } })
      expect(await createSupabaseAssistant(rule.client).setDocumentStatus(brand, 'd1', 'approved')).toEqual({ kind: 'error', message: 'Aprobarea cere responsabilul documentului la brand și data de început a valabilității' })
      const role = fakeDataClient({ errors: { 'brand_documents:update': { code: '42501', message: 'Doar strategistul sau administratorul agenției aprobă un document' } } })
      expect(await createSupabaseAssistant(role.client).setDocumentStatus(brand, 'd1', 'approved')).toEqual({ kind: 'error', message: 'Doar strategistul sau administratorul agenției aprobă un document' })
      const schema = fakeDataClient({ errors: { 'brand_documents:update': { code: '42703', message: 'column "x" of relation "brand_documents" does not exist' } } })
      const r = await createSupabaseAssistant(schema.client).setDocumentStatus(brand, 'd1', 'approved')
      expect(r.kind === 'error' && r.message).toBe('Statusul documentului nu a putut fi schimbat. Reîncearcă.')
    })

    it('ștergerea: doar ce a șters efectiv baza contează', async () => {
      const { client } = fakeDataClient({ tables: { brand_documents: [{ ...row, status: 'draft' }] } })
      expect(await createSupabaseAssistant(client).deleteDocument(brand, 'd1')).toEqual({ kind: 'ready', data: null })
      expect(await createSupabaseAssistant(client).deleteDocument(brand, 'd1')).toEqual({ kind: 'error', message: 'Doar o ciornă se poate șterge.' })
    })

    it('un răspuns care citează un document păstrează tipul dovezii', async () => {
      const cited = { ...answer, evidence: [{ id: 'doc:f1', kind: 'document', label: 'Prospect · Administrare', document_id: 'd1' }] }
      const { client } = fakeDataClient({ invoke: () => ({ data: { status: 'ok', answer: cited } }) })
      const r = await createSupabaseAssistant(client).ask(ctx, 'Ce spune prospectul?')
      expect(r.kind === 'ready' && r.data.answer?.evidence).toEqual([{ id: 'doc:f1', kind: 'document', label: 'Prospect · Administrare', document_id: 'd1' }])
    })
  })
})
