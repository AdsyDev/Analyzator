import { describe, expect, it } from 'vitest'
import type { Brand, QueryContext } from '../../contracts'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabasePaid } from './paidProvider'

const ctx: QueryContext = { brandId: 'b1', period: { preset: '28d', from: '2026-09-10', to: '2026-10-07' }, comparison: 'previous', filters: {} }
const brand = { id: 'b1', tenant_id: 't1' } as Brand
const report = {
  connected: true, sources: ['meta_ads'], currency: 'RON', mixed_currency: false, source_timezone: 'Europe/Bucharest', imported_at: '2026-10-08T05:00:00Z', data_as_of: '2026-10-07',
  kpis: [
    { key: 'spend', label: 'Cost', unit: 'currency', currency: 'RON', value: 70, change: 40, status: 'ok', definition: 'Suma costurilor.', note: null },
    { key: 'cpa', label: 'CPA', unit: 'currency', currency: 'RON', value: null, change: null, status: 'cannot_compute', definition: 'Cost / conversii.', note: null },
  ],
  series: [{ date: '2026-10-06', spend: null, results: null }, { date: '2026-10-07', spend: '10', results: null }],
  rows: [{ date: '2026-10-07', platform: 'meta_ads', account: 'Urinal RO', campaign: 'Toamna', objective: null, spend: '10', impressions: 100, clicks: 4, ctr: 4, cpc: 2.5, conversions: null, cpa: null, attribution_window: null }],
}

describe('createSupabasePaid', () => {
  it('un singur apel brand_paid pentru KPI-uri, serie și rânduri; valorile vin de la server', async () => {
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: report }) })
    const p = createSupabasePaid(client)
    const [s, series, rows] = await Promise.all([p.summary(ctx, { platform: null }), p.series(ctx, { platform: null }), p.rows(ctx, { platform: null })])
    expect(rpcs).toHaveLength(1)
    expect(rpcs[0]!.args).toMatchObject({ p_brand_id: 'b1', p_platform: null, p_kind: 'custom' })
    expect(s.kind === 'ready' && s.data.kpis.map((k) => [k.key, k.value, k.status])).toEqual([['spend', 70, 'ok'], ['cpa', null, 'cannot_compute']])
    expect(series.kind === 'ready' && series.data.spend).toEqual([{ date: '2026-10-06', value: null }, { date: '2026-10-07', value: 10 }])
    expect(rows.kind === 'ready' && rows.data[0]).toMatchObject({ platform: 'meta_ads', spend: 10, cpa: null })
  })

  it('fără platformă conectată: „Sursă neconectată”, nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { connected: false } }) })
    expect((await createSupabasePaid(client).summary(ctx, { platform: null })).kind).toBe('not_connected')
  })

  it('bugetul: planul în vigoare la sfârșitul perioadei, cu procentele calculate de server', async () => {
    const plan = { id: 'p1', plan_from: '2026-10-01', plan_to: '2026-10-31', approved_budget: '1000', currency: 'RON', plan_note: 'plan lunar', spent: '70', currency_mismatch: false, data_as_of: '2026-10-07', elapsed_days: 7, planned_days: 31, spend_pct: 7, time_pct: 22.58 }
    const { client, rpcs } = fakeDataClient({ rpc: () => ({ data: { plan } }) })
    const r = await createSupabasePaid(client).budget(ctx)
    expect(rpcs[0]).toEqual({ fn: 'brand_paid_budget', args: { p_brand_id: 'b1', p_day: '2026-10-07' } })
    expect(r.kind === 'ready' && r.data).toEqual({ id: 'p1', currency: 'RON', approved_budget: 1000, plan_from: '2026-10-01', plan_to: '2026-10-31', spent: 70, elapsed_days: 7, planned_days: 31, spend_pct: 7, time_pct: 22.58, plan_note: 'plan lunar', data_as_of: '2026-10-07', currency_mismatch: false })
  })

  it('fără plan: stare validă fără buget, nu eroare și nu zero', async () => {
    const { client } = fakeDataClient({ rpc: () => ({ data: { plan: null } }) })
    const r = await createSupabasePaid(client).budget(ctx)
    expect(r.kind === 'ready' && [r.data.id, r.data.approved_budget, r.data.spent, r.data.spend_pct]).toEqual([null, null, null, null])
  })

  it('cost în altă monedă: costul și procentul rămân null, nepotrivirea e semnalată', async () => {
    const plan = { id: 'p1', plan_from: '2026-10-01', plan_to: '2026-10-31', approved_budget: 500, currency: 'EUR', plan_note: null, spent: null, currency_mismatch: true, data_as_of: '2026-10-07', elapsed_days: 7, planned_days: 31, spend_pct: null, time_pct: 22.58 }
    const { client } = fakeDataClient({ rpc: () => ({ data: { plan } }) })
    const r = await createSupabasePaid(client).budget(ctx)
    expect(r.kind === 'ready' && [r.data.spent, r.data.spend_pct, r.data.currency_mismatch]).toEqual([null, null, true])
  })

  it('un plan fără câmpurile obligatorii încalcă contractul; refuzul de acces are mesajul lui', async () => {
    const broken = fakeDataClient({ rpc: () => ({ data: { plan: { id: 'p1' } } }) })
    expect((await createSupabasePaid(broken.client).budget(ctx)).kind).toBe('error')
    const denied = fakeDataClient({ rpc: () => ({ error: { code: '42501', message: 'x' } }) })
    expect(await createSupabasePaid(denied.client).budget(ctx)).toEqual({ kind: 'error', message: 'Nu ai acces la acest spațiu de brand.' })
  })

  it('salvarea scrie brandul, clientul și autorul din sesiune; moneda cu litere mari, nota goală devine null', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u1' })
    const r = await createSupabasePaid(client).saveBudget(brand, { plan_from: '2026-10-01', plan_to: '2026-10-31', amount: 1000, currency: 'ron', note: '  ' })
    expect(r.kind).toBe('ready')
    expect(calls[0]).toMatchObject({ table: 'paid_budgets', op: 'insert', payload: { tenant_id: 't1', brand_id: 'b1', plan_from: '2026-10-01', plan_to: '2026-10-31', amount: 1000, currency: 'RON', note: null, created_by: 'u1' } })
  })

  it('fără sesiune nu se scrie nimic; refuzul RLS și regulile tabelului au mesaje în română', async () => {
    const anon = fakeDataClient({ userId: null })
    expect((await createSupabasePaid(anon.client).saveBudget(brand, { plan_from: '2026-10-01', plan_to: '2026-10-31', amount: 1, currency: 'RON', note: null })).kind).toBe('error')
    expect(anon.calls).toHaveLength(0)
    const rls = fakeDataClient({ userId: 'u1', errors: { paid_budgets: { code: '42501', message: 'x' } } })
    expect(await createSupabasePaid(rls.client).saveBudget(brand, { plan_from: '2026-10-01', plan_to: '2026-10-31', amount: 1, currency: 'RON', note: null })).toEqual({ kind: 'error', message: 'Nu ai dreptul să modifici bugetul acestui brand.' })
    const check = fakeDataClient({ userId: 'u1', errors: { paid_budgets: { code: '23514', message: 'x' } } })
    const r = await createSupabasePaid(check.client).saveBudget(brand, { plan_from: '2026-10-01', plan_to: '2026-10-31', amount: 1, currency: 'RON', note: null })
    expect(r.kind === 'error' && r.message).toMatch(/sumă mai mare ca zero/)
  })

  it('ștergerea țintește un singur plan, după id', async () => {
    const { client, calls } = fakeDataClient({ userId: 'u1' })
    expect((await createSupabasePaid(client).deleteBudget('p1')).kind).toBe('ready')
    expect(calls[0]).toMatchObject({ table: 'paid_budgets', op: 'delete', filters: [['id', 'eq', 'p1']] })
  })

  it('un KPI cu status necunoscut încalcă contractul', async () => {
    const bad = { ...report, kpis: [{ ...report.kpis[0], status: 'inventat' }] }
    const { client } = fakeDataClient({ rpc: () => ({ data: bad }) })
    expect((await createSupabasePaid(client).summary(ctx, { platform: null })).kind).toBe('error')
  })
})
