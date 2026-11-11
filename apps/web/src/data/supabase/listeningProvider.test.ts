import { describe, expect, it } from 'vitest'
import type { QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseInsights, createSupabaseMentions } from './listeningProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const mention = { id: 'h:1', brand_id: 'b1', source_name: 'instagram', author: null, published_at: '2026-10-05T12:00:00Z', text: 'bun', url: 'https://x.test/1', sentiment: null, reviewed_by: null, pv_flag: null }

describe('createSupabaseMentions', () => {
  it('lista vine din brand_mentions cu filtrele și paginarea din UI', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { items: [mention], total: 1, page: 1, page_size: 20 } }) })
    const r = await createSupabaseMentions(client).list(ctx, { sentiment: 'unreviewed', source: 'instagram', author: null, page: 1, page_size: 20 })
    expect(r.kind === 'ready' && r.data.items[0]!.sentiment).toBeNull()
    expect(rpcs[0]).toMatchObject({ fn: 'brand_mentions', args: { p_sentiment: 'unreviewed', p_source: 'instagram', p_page: 1 } })
  })

  it('mențiunile fără conținut vin numărate separat; un server mai vechi, care nu trimite câmpul, înseamnă zero', async () => {
    const withCount = fakeDataClient({ rpc: () => ({ data: { items: [mention], total: 1, page: 1, page_size: 20, without_content: 1068 } }) })
    const r = await createSupabaseMentions(withCount.client).list(ctx, { sentiment: null, source: null, author: null, page: 1, page_size: 20 })
    expect(r.kind === 'ready' && [r.data.total, r.data.without_content, r.data.items.length]).toEqual([1, 1068, 1])
    const older = fakeDataClient({ rpc: () => ({ data: { items: [mention], total: 1, page: 1, page_size: 20 } }) })
    const o = await createSupabaseMentions(older.client).list(ctx, { sentiment: null, source: null, author: null, page: 1, page_size: 20 })
    expect(o.kind === 'ready' && o.data.without_content).toBe(0)
    const dist = { connected: true, total: 2, positive: 1, neutral: 1, negative: 0, unreviewed: 3, owned_excluded: 0, shares: { positive: 50, neutral: 50, negative: 0 } }
    const s1 = await createSupabaseMentions(fakeDataClient({ rpc: () => ({ data: { ...dist, without_content: 7 } }) }).client).sentiment(ctx)
    expect(s1.kind === 'ready' && [s1.data.unreviewed, s1.data.without_content]).toEqual([3, 7])
    const s2 = await createSupabaseMentions(fakeDataClient({ rpc: () => ({ data: dist }) }).client).sentiment(ctx)
    expect(s2.kind === 'ready' && s2.data.without_content).toBe(0)
  })

  it('fără Listening conectat: sentimentul e „Sursă neconectată”, nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false, total: 0, positive: 0, neutral: 0, negative: 0, unreviewed: 0, owned_excluded: 0, shares: { positive: null, neutral: null, negative: null } } }) })
    expect((await createSupabaseMentions(client).sentiment(ctx)).kind).toBe('not_connected')
  })

  it('cont propriu (D-22): filtrul de autor ajunge la server; fără owned_excluded, răspunsul încalcă contractul', async () => {
    const fake = fakeDataClient({ rpc: () => ({ data: { items: [], total: 1, page: 1, page_size: 20 } }) })
    await createSupabaseMentions(fake.client).list(ctx, { sentiment: null, source: null, author: 'owned', page: 1, page_size: 20 })
    expect(fake.rpcs[0]).toEqual({ fn: 'brand_mentions', args: expect.objectContaining({ p_author: 'owned' }) })
    const old = fakeDataClient({ rpc: () => ({ data: { connected: true, total: 0, positive: 0, neutral: 0, negative: 0, unreviewed: 0, shares: { positive: null, neutral: null, negative: null } } }) })
    expect((await createSupabaseMentions(old.client).sentiment(ctx)).kind).toBe('error')
  })

  it('marcarea PV trimite doar referința; textul îl completează serverul', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u-12345678' })
    await createSupabaseMentions(client).pvFlag('b1', { kind: 'mention', id: 'h:1' })
    expect(calls.find((c) => c.op === 'insert')).toMatchObject({ table: 'pv_flags', payload: { brand_id: 'b1', entity_type: 'mention', entity_ref: 'h:1' } })
  })
})

describe('createSupabaseInsights', () => {
  it('analizele vin din brand_insights; un status necunoscut încalcă contractul', async () => {
    const ok = fakeDataClient({ rpc: () => ({ data: [{ id: 'i1', status: 'published', evidence: [], actions: [] }] }) })
    expect((await createSupabaseInsights(ok.client).list(ctx)).kind).toBe('ready')
    const bad = fakeDataClient({ rpc: () => ({ data: [{ id: 'i1', status: 'inventat', evidence: [], actions: [] }] }) })
    expect((await createSupabaseInsights(bad.client).list(ctx)).kind).toBe('error')
  })
})

describe('analize: scrieri (Supabase)', () => {
  const brand = { id: 'b1', tenant_id: 't1', tenant_name: 'Client', name: 'Brand', category: null, domain: null }
  const draft = { title: '  Trafic în scădere ', period: { from: '2026-10-01', to: '2026-10-07' }, summary: 'Constatare', interpretation: 'Interpretare', limits: 'Limite', evidence_keys: ['ga4_sessions', 'seomonitor_visibility_latest'] }

  it('ciornă nouă: tenantul și brandul vin din brand, autorul din sesiune; statusul nu se trimite niciodată', async () => {
    const { client, calls } = fakeDataClient({ userId: 'me' })
    const r = await createSupabaseInsights(client).saveDraft(brand, null, draft)
    expect(r).toEqual({ kind: 'ready', data: { id: 'new-id' } })
    const insert = calls.find((c) => c.table === 'insights' && c.op === 'insert')?.payload as Record<string, unknown>
    expect(insert).toEqual({ tenant_id: 't1', brand_id: 'b1', author_id: 'me', title: 'Trafic în scădere', period_start: '2026-10-01', period_end: '2026-10-07', period_kind: 'custom', summary: 'Constatare', interpretation: 'Interpretare', limits: 'Limite' })
    expect(insert).not.toHaveProperty('status')
    // Dovezile: câte un rând pe metrică; SEOmonitor primește device-ul cerut la îngheț.
    expect(calls.find((c) => c.table === 'evidence_links' && c.op === 'insert')?.payload).toEqual([
      { tenant_id: 't1', brand_id: 'b1', insight_id: 'new-id', kind: 'metric', metric_key: 'ga4_sessions', options: {} },
      { tenant_id: 't1', brand_id: 'b1', insight_id: 'new-id', kind: 'metric', metric_key: 'seomonitor_visibility_latest', options: { device: 'desktop' } },
    ])
  })

  it('editare: actualizează doar ciorna brandului și potrivește dovezile (scoate ce nu mai e bifat, adaugă ce lipsește)', async () => {
    const tables = { evidence_links: [{ id: 'e1', insight_id: 'i1', kind: 'metric', metric_key: 'ga4_sessions' }, { id: 'e2', insight_id: 'i1', kind: 'metric', metric_key: 'gsc_clicks' }, { id: 'e9', insight_id: 'alta', kind: 'metric', metric_key: 'gsc_clicks' }] }
    const { client, calls } = fakeDataClient({ tables })
    const r = await createSupabaseInsights(client).saveDraft(brand, 'i1', { ...draft, evidence_keys: ['ga4_sessions', 'mentions_count'] })
    expect(r).toEqual({ kind: 'ready', data: { id: 'i1' } })
    expect(calls.find((c) => c.table === 'insights' && c.op === 'update')?.filters).toEqual([['id', 'eq', 'i1'], ['brand_id', 'eq', 'b1']])
    expect(calls.find((c) => c.table === 'evidence_links' && c.op === 'delete')?.filters).toEqual([['id', 'in', ['e2']]])
    expect(calls.find((c) => c.table === 'evidence_links' && c.op === 'insert')?.payload).toEqual([{ tenant_id: 't1', brand_id: 'b1', insight_id: 'i1', kind: 'metric', metric_key: 'mentions_count', options: {} }])
    // Dovada altei analize rămâne neatinsă.
    expect(tables.evidence_links.map((e) => e.id).sort()).toEqual(['e1', 'e9'])
  })

  it('fără sesiune nu se scrie nimic', async () => {
    const { client, calls } = fakeDataClient({ userId: null })
    expect((await createSupabaseInsights(client).saveDraft(brand, null, draft)).kind).toBe('error')
    expect((await createSupabaseInsights(client).addAction(brand, 'i1', { title: 'x', due: null, effort: null, tracked_metric_key: null })).kind).toBe('error')
    expect(calls).toHaveLength(0)
  })

  it('statusul se schimbă doar prin jurnalele de tranziții', async () => {
    const { client, calls } = fakeDataClient()
    const p = createSupabaseInsights(client)
    await p.transition('i1', 'draft', '  Lipsește comparația  ')
    await p.transition('i1', 'published')
    await p.transitionAction('a1', { to: 'measured', result_note: ' +3 p.p. ' })
    await p.transitionAction('a1', { to: 'cancelled', reason: 'Nu mai e nevoie' })
    expect(calls.map((c) => [c.table, c.op, c.payload])).toEqual([
      ['insight_transitions', 'insert', { insight_id: 'i1', to_status: 'draft', reason: 'Lipsește comparația' }],
      ['insight_transitions', 'insert', { insight_id: 'i1', to_status: 'published', reason: null }],
      ['action_transitions', 'insert', { action_id: 'a1', to_status: 'measured', reason: null, result_note: '+3 p.p.' }],
      ['action_transitions', 'insert', { action_id: 'a1', to_status: 'cancelled', reason: 'Nu mai e nevoie', result_note: null }],
    ])
  })

  it('acțiune nouă: responsabilul e utilizatorul curent; efortul și indicatorul goale rămân NULL', async () => {
    const { client, calls } = fakeDataClient({ userId: 'me' })
    await createSupabaseInsights(client).addAction(brand, 'i1', { title: ' Rescrie pagina ', due: '2026-11-20', effort: '  ', tracked_metric_key: null })
    expect(calls[0]?.payload).toEqual({ tenant_id: 't1', brand_id: 'b1', insight_id: 'i1', title: 'Rescrie pagina', responsible_user_id: 'me', due_date: '2026-11-20', effort: null, tracked_metric_key: null })
  })

  it('mesajele triggerelor noastre ajung la utilizator; erorile de schemă rămân generice', async () => {
    const ask = async (error: { code?: string; message: string }) => createSupabaseInsights(fakeDataClient({ errors: { 'insight_transitions:insert': error } }).client).transition('i1', 'in_review')
    expect(await ask({ code: '23514', message: 'Analiza nu poate fi trimisă la review; lipsesc: limite, dovezi' })).toEqual({ kind: 'error', message: 'Analiza nu poate fi trimisă la review; lipsesc: limite, dovezi.' })
    expect(await ask({ code: '42501', message: 'Doar strategist sau agency_admin poate publica' })).toEqual({ kind: 'error', message: 'Doar strategist sau agency_admin poate publica.' })
    expect(await ask({ code: '42501', message: 'new row violates row-level security policy for table "insight_transitions"' })).toEqual({ kind: 'error', message: 'Nu ai dreptul să faci această modificare.' })
    expect(await ask({ code: '23514', message: 'new row for relation "insights" violates check constraint "insights_title_check"' })).toEqual({ kind: 'error', message: 'Statusul analizei nu a putut fi schimbat. Reîncearcă.' })
    expect(await ask({ code: 'XX000', message: 'Tranziție nepermisă' })).toEqual({ kind: 'error', message: 'Statusul analizei nu a putut fi schimbat. Reîncearcă.' })
  })

  it('versiune nouă: pleacă textele și `supersedes_id`; versiunea, dovezile și recomandările le pune serverul', async () => {
    const { client, calls } = fakeDataClient({ userId: 'me' })
    const insight = { id: 'i1', brand_id: 'b1', title: 'Analiză', summary: 'C', interpretation: 'I', author: { id: 'a', name: 'A', role: '' }, period: { from: '2026-10-01', to: '2026-10-07' }, status: 'published' as const, evidence: [], limits: 'L', actions: [], updated_at: '', published_at: '' }
    expect(await createSupabaseInsights(client).supersede(brand, insight)).toEqual({ kind: 'ready', data: { id: 'new-id' } })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toEqual({ tenant_id: 't1', brand_id: 'b1', author_id: 'me', supersedes_id: 'i1', title: 'Analiză', period_start: '2026-10-01', period_end: '2026-10-07', period_kind: 'custom', summary: 'C', interpretation: 'I', limits: 'L' })
  })

  it('recomandările: inserare cu brandul și analiza; ștergere doar pe ID', async () => {
    const tables = { recommendations: [{ id: 'r1' }, { id: 'r2' }] }
    const { client, calls } = fakeDataClient({ tables })
    const p = createSupabaseInsights(client)
    await p.addRecommendation(brand, 'i1', { problem: ' P ', action: ' A ', expected_benefit: ' B ', priority: 1 })
    expect(calls[0]?.payload).toEqual({ tenant_id: 't1', brand_id: 'b1', insight_id: 'i1', problem: 'P', action: 'A', expected_benefit: 'B', priority: 1 })
    await p.deleteRecommendation('r1')
    expect(tables.recommendations).toEqual([{ id: 'r2' }])
  })

  it('răspunsul clientului: pleacă doar recomandarea, răspunsul și motivul; brandul, autorul și data le pune serverul', async () => {
    const { client, calls } = fakeDataClient()
    const p = createSupabaseInsights(client)
    expect(await p.respondToRecommendation('r1', 'accepted')).toEqual({ kind: 'ready', data: null })
    expect(await p.respondToRecommendation('r1', 'adjustment_requested', '  Vrem alt termen.  ')).toEqual({ kind: 'ready', data: null })
    expect(calls.map((c) => [c.table, c.op, c.payload])).toEqual([
      ['recommendation_responses', 'insert', { recommendation_id: 'r1', response: 'accepted', comment: null }],
      ['recommendation_responses', 'insert', { recommendation_id: 'r1', response: 'adjustment_requested', comment: 'Vrem alt termen.' }],
    ])
    for (const k of ['tenant_id', 'brand_id', 'user_id', 'insight_id', 'created_at']) expect(calls[0]!.payload).not.toHaveProperty(k)
  })

  it('răspunsul clientului: refuzurile serverului ajung cu mesajul lor; erorile de schemă rămân generice', async () => {
    const ask = async (error: { code?: string; message: string }) => createSupabaseInsights(fakeDataClient({ errors: { 'recommendation_responses:insert': error } }).client).respondToRecommendation('r1', 'accepted')
    expect(await ask({ code: '42501', message: 'Doar clientul răspunde la o recomandare' })).toEqual({ kind: 'error', message: 'Doar clientul răspunde la o recomandare.' })
    expect(await ask({ code: '42501', message: 'Recomandare inexistentă sau fără acces' })).toEqual({ kind: 'error', message: 'Recomandare inexistentă sau fără acces.' })
    expect(await ask({ code: '23514', message: 'Scrie ce ajustare ceri' })).toEqual({ kind: 'error', message: 'Scrie ce ajustare ceri.' })
    expect(await ask({ code: '42501', message: 'new row violates row-level security policy for table "recommendation_responses"' })).toEqual({ kind: 'error', message: 'Nu ai dreptul să faci această modificare.' })
    expect(await ask({ code: '42P01', message: 'relation "recommendation_responses" does not exist' })).toEqual({ kind: 'error', message: 'Răspunsul nu a putut fi salvat. Reîncearcă.' })
  })

  it('comentariul: pleacă doar analiza și textul; autorul și rolul lui le pune serverul', async () => {
    const { client, calls } = fakeDataClient()
    expect(await createSupabaseInsights(client).addComment('i1', '  Putem muta termenul?  ')).toEqual({ kind: 'ready', data: null })
    expect(calls[0]).toMatchObject({ table: 'insight_comments', op: 'insert', payload: { insight_id: 'i1', body: 'Putem muta termenul?' } })
    for (const k of ['author_id', 'author_role', 'tenant_id', 'brand_id']) expect(calls[0]!.payload).not.toHaveProperty(k)
    const refused = fakeDataClient({ errors: { 'insight_comments:insert': { code: '42501', message: 'Analiză inexistentă sau fără acces' } } })
    expect(await createSupabaseInsights(refused.client).addComment('i1', 'x')).toEqual({ kind: 'error', message: 'Analiză inexistentă sau fără acces.' })
  })

  it('responsabilul ales pleacă spre server, care îl verifică; fără alegere rămâne utilizatorul curent', async () => {
    const { client, calls } = fakeDataClient({ userId: 'me' })
    await createSupabaseInsights(client).addAction(brand, 'i1', { title: 'x', owner_id: 'coleg', due: null, effort: null, tracked_metric_key: null })
    await createSupabaseInsights(client).addAction(brand, 'i1', { title: 'y', owner_id: null, due: null, effort: null, tracked_metric_key: null })
    expect(calls.map((c) => (c.payload as { responsible_user_id: string }).responsible_user_id)).toEqual(['coleg', 'me'])
  })

  it('ștergerea țintește doar analiza cerută', async () => {
    const tables = { insights: [{ id: 'i1' }, { id: 'i2' }] }
    const { client } = fakeDataClient({ tables })
    expect(await createSupabaseInsights(client).deleteDraft('i1')).toEqual({ kind: 'ready', data: null })
    expect(tables.insights).toEqual([{ id: 'i2' }])
  })
})
