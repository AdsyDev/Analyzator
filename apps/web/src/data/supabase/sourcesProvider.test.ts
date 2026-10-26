import { describe, expect, it } from 'vitest'
import { fakeDataClient } from '../../test/fakeDataClient'
import { createSupabaseSources } from './sourcesProvider'

const NOW = () => new Date('2026-10-08T10:00:00Z')
const BRAND = 'b-1'
const conn = (o: Record<string, unknown> = {}) => ({
  id: 'c-1',
  brand_id: BRAND,
  provider: 'clarity',
  external_account_id: 'proj-1',
  display_name: 'Urinal',
  credential_status: 'valid',
  last_validated_at: '2026-10-07T08:00:00Z',
  last_validation_error: null,
  credential_updated_by: null,
  credential_updated_at: null,
  status: 'active',
  ...o,
})
const run = (o: Record<string, unknown> = {}) => ({
  id: 'r-1',
  brand_id: BRAND,
  source: 'clarity',
  period_start: '2026-10-06',
  period_end: '2026-10-06',
  status: 'succeeded',
  rows_written: 120,
  errors: [],
  started_at: '2026-10-07T03:00:00Z',
  finished_at: '2026-10-07T03:01:10Z',
  created_at: '2026-10-07T03:00:00Z',
  ...o,
})

describe('sources.connections (supabase)', () => {
  it('filtrează pe brand și pe ziua UTC, și însumează apelurile pe conexiune', async () => {
    const { client, calls } = fakeDataClient({
      tables: {
        source_connections: [conn(), conn({ id: 'c-x', brand_id: 'alt-brand' })],
        provider_api_calls: [
          { source_connection_id: 'c-1', calls: 2, brand_id: BRAND, call_date_utc: '2026-10-08' },
          { source_connection_id: 'c-1', calls: 1, brand_id: BRAND, call_date_utc: '2026-10-08' },
          { source_connection_id: 'c-1', calls: 9, brand_id: BRAND, call_date_utc: '2026-10-07' },
        ],
      },
    })
    const r = await createSupabaseSources(client, NOW).connections(BRAND)
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    expect(r.data).toHaveLength(1)
    expect(r.data[0]).toMatchObject({ id: 'c-1', calls_today: 3, daily_call_budget: 10, credential_status: 'valid' })
    for (const c of calls) expect(c.filters.some(([col, , v]) => col === 'brand_id' && v === BRAND)).toBe(true)
    expect(JSON.stringify(r)).not.toMatch(/vault|secret|token/i)
  })

  it('o valoare în afara contractului dă eroare, nu o presupunere', async () => {
    const { client } = fakeDataClient({ tables: { source_connections: [conn({ credential_status: 'whatever' })] } })
    const r = await createSupabaseSources(client, NOW).connections(BRAND)
    expect(r.kind).toBe('error')
  })

  it('eroare de bază de date → mesaj prietenos, fără detalii', async () => {
    const { client } = fakeDataClient({ errors: { source_connections: { code: '42P01', message: 'relation "x" does not exist' } } })
    const r = await createSupabaseSources(client, NOW).connections(BRAND)
    expect(r).toEqual({ kind: 'error', message: expect.not.stringMatching(/relation|42P01/) })
  })
})

describe('sources.statuses (supabase)', () => {
  const get = async (tables: Record<string, Array<Record<string, unknown>>>) => {
    const { client } = fakeDataClient({ tables })
    const r = await createSupabaseSources(client, NOW).statuses(BRAND)
    if (r.kind !== 'ready') throw new Error('nu e ready')
    return Object.fromEntries(r.data.map((s) => [s.provider, s]))
  }

  it('fără conexiune: neconectat; cu sincronizare reușită: conectat cu data_as_of din perioadă', async () => {
    const s = await get({ source_connections: [conn()], sync_runs: [run()], import_batches: [] })
    expect(s.clarity).toMatchObject({ state: 'connected', data_as_of: '2026-10-06', imported_at: '2026-10-07T03:01:10Z' })
    expect(s.ga4).toMatchObject({ state: 'not_connected', data_as_of: null })
    expect(s.csv_import?.state).toBe('not_connected')
    expect(Object.keys(s)).toEqual(['seomonitor', 'ga4', 'gsc', 'clarity', 'planable', 'google_ads', 'meta_ads', 'tiktok_ads', 'csv_import'])
  })

  it('token refuzat → eroare; ultima sincronizare eșuată → eroare cu ultimele date păstrate; parțial → parțial', async () => {
    expect((await get({ source_connections: [conn({ credential_status: 'invalid' })], sync_runs: [], import_batches: [] })).clarity?.state).toBe('error')
    const failedLast = await get({ source_connections: [conn()], sync_runs: [run({ id: 'r-0', created_at: '2026-10-06T03:00:00Z', period_end: '2026-10-05' }), run({ id: 'r-2', status: 'failed', created_at: '2026-10-08T03:00:00Z' })], import_batches: [] })
    expect(failedLast.clarity).toMatchObject({ state: 'error', data_as_of: '2026-10-05' })
    expect((await get({ source_connections: [conn()], sync_runs: [run({ status: 'partial' })], import_batches: [] })).clarity?.state).toBe('partial')
  })

  it('nota spune de ce e parțial sau eșuat, din erori și acoperire (20 oct. 2026)', async () => {
    const ga4 = conn({ id: 'c-g', provider: 'ga4', credential_status: 'missing' })
    const partial = await get({
      source_connections: [ga4],
      sync_runs: [run({ source: 'ga4', status: 'partial', coverage: { web_daily: { expected_days: 35, covered_days: 30, coverage: 0.857 } }, errors: [{ code: 'parser_unknown_field', message: 'x' }] })],
      import_batches: [],
    })
    expect(partial.ga4).toMatchObject({ state: 'partial', note: 'Ultima sincronizare a adus date parțiale: 5 din 35 de zile fără sesiuni.' })
    const seo = await get({
      source_connections: [],
      sync_runs: [
        run({ id: 'r-ok', source: 'seomonitor', created_at: '2026-10-13T12:00:00Z', period_end: '2026-10-12' }),
        run({ id: 'r-x', source: 'seomonitor', status: 'failed', rows_written: 0, created_at: '2026-10-20T09:00:00Z', errors: [{ code: 'exception', message: 'POST ai_answer_originals: HTTP 500 57014 canceling statement due to statement timeout' }] }),
      ],
      import_batches: [],
    })
    expect(seo.seomonitor).toMatchObject({ state: 'error', data_as_of: '2026-10-12', note: 'Ultima sincronizare a eșuat: baza de date nu a răspuns la timp. Afișăm ultimele date importate.' })
    // Fără explicație salvată: fraza de bază, fără „:”.
    expect((await get({ source_connections: [conn()], sync_runs: [run({ status: 'partial' })], import_batches: [] })).clarity?.note).toBe('Ultima sincronizare a adus date parțiale.')
  })

  it('token salvat dar fără nicio sincronizare: neconectat (tokenul nu înseamnă date); fără token: spune asta', async () => {
    expect((await get({ source_connections: [conn()], sync_runs: [], import_batches: [] })).clarity).toMatchObject({ state: 'not_connected', note: expect.stringContaining('sincronizare') })
    expect((await get({ source_connections: [conn({ credential_status: 'missing' })], sync_runs: [], import_batches: [] })).clarity).toMatchObject({ state: 'not_connected', note: 'Token neconfigurat.' })
  })

  it('SEOmonitor: contul e al clientului; site-ul cu rulări e conectat fără conexiune proprie, fără rulări rămâne neconectat', async () => {
    const withRuns = await get({ source_connections: [], sync_runs: [run({ source: 'seomonitor', period_end: '2026-10-11' })], import_batches: [] })
    expect(withRuns.seomonitor).toMatchObject({ state: 'connected', data_as_of: '2026-10-11' })
    expect((await get({ source_connections: [], sync_runs: [], import_batches: [] })).seomonitor).toMatchObject({ state: 'not_connected' })
    // Doar SEOmonitor: o sursă pe site fără conexiune nu devine conectată din rulări rămase.
    expect((await get({ source_connections: [], sync_runs: [run({ source: 'gsc' })], import_batches: [] })).gsc?.state).toBe('not_connected')
  })

  it('Planable: rulările Analytics și Listening contează pentru card; cheia clientului nu e „token neconfigurat”', async () => {
    const pl = conn({ provider: 'planable', credential_status: 'missing' })
    const s = await get({ source_connections: [pl], sync_runs: [run({ source: 'planable_analytics', period_end: '2026-10-11' }), run({ id: 'r-l', source: 'planable_listening', status: 'partial', created_at: '2026-10-07T03:00:01Z' })], import_batches: [] })
    expect(s.planable).toMatchObject({ state: 'partial', data_as_of: '2026-10-06' })
    expect((await get({ source_connections: [pl], sync_runs: [], import_batches: [] })).planable?.note).not.toBe('Token neconfigurat.')
  })

  it('Meta Ads: cu rulări reușite cardul e conectat (nu mai rămâne „Neconectat”); fără drept pe cont: eroare cu motiv', async () => {
    const meta = conn({ id: 'c-m', provider: 'meta_ads', credential_status: 'missing', external_account_id: 'act_123' })
    const ok = await get({ source_connections: [meta], sync_runs: [run({ source: 'meta_ads', period_end: '2026-10-25' })], import_batches: [] })
    expect(ok.meta_ads).toMatchObject({ state: 'connected', data_as_of: '2026-10-25' })
    const denied = await get({ source_connections: [meta], sync_runs: [run({ source: 'meta_ads', status: 'failed', rows_written: 0, errors: [{ code: 'permission_denied', message: '200' }] })], import_batches: [] })
    expect(denied.meta_ads).toMatchObject({ state: 'error', note: 'Ultima sincronizare a eșuat: cheia nu are drept de citire pe acest cont.' })
    expect((await get({ source_connections: [], sync_runs: [], import_batches: [] })).google_ads).toMatchObject({ state: 'not_connected' })
  })

  it('Import CSV: conectat doar cu un lot încheiat', async () => {
    const s = await get({ source_connections: [], sync_runs: [], import_batches: [{ brand_id: BRAND, status: 'imported', updated_at: '2026-10-05T09:00:00Z' }] })
    expect(s.csv_import).toMatchObject({ state: 'connected', imported_at: '2026-10-05T09:00:00Z' })
  })
})

describe('sources.syncRuns (supabase)', () => {
  it('cele mai recente întâi; coada nu are rânduri; sursă necunoscută se păstrează ca atare', async () => {
    const { client } = fakeDataClient({
      tables: { sync_runs: [run(), run({ id: 'r-q', status: 'queued', started_at: null, finished_at: null, rows_written: 0, created_at: '2026-10-08T03:00:00Z', source: 'altceva' }), run({ id: 'r-f', status: 'failed', errors: [{ code: 'HTTP 429' }], created_at: '2026-10-07T04:00:00Z' })] },
    })
    const r = await createSupabaseSources(client, NOW).syncRuns(BRAND)
    if (r.kind !== 'ready') throw new Error('nu e ready')
    expect(r.data.map((x) => x.id)).toEqual(['r-q', 'r-f', 'r-1'])
    expect(r.data[0]).toMatchObject({ provider: 'altceva', rows: null, finished_at: null, started_at: '2026-10-08T03:00:00Z' })
    expect(r.data[1]).toMatchObject({ status: 'failed', error: 'HTTP 429', rows: 120 })
  })

  it('fiecare rulare are conexiunea, codurile de eroare și motivul (din errors și coverage)', async () => {
    const { client } = fakeDataClient({
      tables: { sync_runs: [run({ source: 'ga4', status: 'partial', source_connection_id: 'c-g', errors: [{ code: 'ga4_thresholding', message: 'x' }], coverage: { web_daily: { expected_days: 35, covered_days: 35, coverage: 1 } } })] },
    })
    const r = await createSupabaseSources(client, NOW).syncRuns(BRAND)
    if (r.kind !== 'ready') throw new Error('nu e ready')
    expect(r.data[0]).toMatchObject({ connection_id: 'c-g', error_codes: ['ga4_thresholding'], reason: 'GA4 a ascuns valori mici (pragul de confidențialitate)' })
  })
})

describe('sources.setToken / validate (funcția server)', () => {
  it('trimite tokenul doar în corpul cererii; rezultatul nu îl conține', async () => {
    const { client, invocations } = fakeDataClient({ invoke: () => ({ data: { connection_id: 'c-1', credential_status: 'unverified' } }) })
    const r = await createSupabaseSources(client, NOW).setToken('c-1', 'sup3r-secret-token')
    expect(invocations).toEqual([{ name: 'source-credentials', body: { action: 'set_token', connection_id: 'c-1', token: 'sup3r-secret-token' } }])
    expect(r).toEqual({ kind: 'ready', data: { connection_id: 'c-1', credential_status: 'unverified' } })
    expect(JSON.stringify(r)).not.toContain('sup3r-secret-token')
  })

  it('eroarea funcției server (mesaj în română) ajunge la utilizator, fără token', async () => {
    const err = { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Doar agency_admin al clientului poate gestiona sursele.' }) } }
    const { client } = fakeDataClient({ invoke: () => ({ error: err }) })
    const r = await createSupabaseSources(client, NOW).setToken('c-1', 'tok')
    expect(r).toEqual({ kind: 'error', message: 'Doar agency_admin al clientului poate gestiona sursele.' })
    const generic = fakeDataClient({ invoke: () => ({ error: { message: 'Edge Function returned a non-2xx status code' } }) })
    const g = await createSupabaseSources(generic.client, NOW).setToken('c-1', 'tok')
    expect(g.kind).toBe('error')
    expect(JSON.stringify(g)).not.toMatch(/Edge Function|non-2xx/)
  })

  it('validate: parsează răspunsul și respinge unul în afara contractului', async () => {
    const ok = { connection_id: 'c-1', credential_status: 'valid', calls_today: 4, daily_limit: 10, outcome: 'valid', message: 'Conexiunea funcționează.' }
    expect(await createSupabaseSources(fakeDataClient({ invoke: () => ({ data: ok }) }).client, NOW).validate('c-1')).toEqual({ kind: 'ready', data: ok })
    const bad = await createSupabaseSources(fakeDataClient({ invoke: () => ({ data: { ...ok, outcome: 'ceva' } }) }).client, NOW).validate('c-1')
    expect(bad.kind).toBe('error')
  })
})

describe('sources.listAccounts (funcția server)', () => {
  const ok = { connection_id: 'c-1', kind: 'ga4', outcome: 'ok', credential_status: 'valid', accounts: [{ id: '412', name: 'Minimartieni', detail: 'STADA' }], truncated: false, message: null }

  it('trimite acțiunea și tipul, parsează lista', async () => {
    const fake = fakeDataClient({ invoke: () => ({ data: ok }) })
    const r = await createSupabaseSources(fake.client, NOW).listAccounts('c-1', 'ga4')
    expect(r).toEqual({ kind: 'ready', data: { outcome: 'ok', credential_status: 'valid', accounts: ok.accounts, truncated: false, message: null } })
    expect(fake.invocations).toEqual([{ name: 'source-credentials', body: { action: 'list_accounts', connection_id: 'c-1', kind: 'ga4' } }])
  })

  it('un cont fără nume sau un rezultat necunoscut încalcă contractul', async () => {
    for (const data of [{ ...ok, accounts: [{ id: '1' }] }, { ...ok, outcome: 'altceva' }]) {
      const r = await createSupabaseSources(fakeDataClient({ invoke: () => ({ data }) }).client, NOW).listAccounts('c-1', 'ga4')
      expect(r.kind).toBe('error')
    }
  })
})

describe('sources.createConnection (supabase)', () => {
  it('ia tenant_id din brand, nu de la utilizator; duplicat → mesaj clar', async () => {
    const { client, calls } = fakeDataClient({ tables: { brands: [{ id: BRAND, tenant_id: 't-1' }] } })
    const r = await createSupabaseSources(client, NOW).createConnection(BRAND, { provider: 'clarity', external_account_id: 'p9', display_name: null })
    expect(r.kind).toBe('ready')
    expect(calls.find((c) => c.op === 'insert')?.payload).toMatchObject({ tenant_id: 't-1', brand_id: BRAND, provider: 'clarity', external_account_id: 'p9' })
    const dup = fakeDataClient({ tables: { brands: [{ id: BRAND, tenant_id: 't-1' }] }, errors: { 'source_connections:insert': { code: '23505', message: 'dup' } } })
    expect(await createSupabaseSources(dup.client, NOW).createConnection(BRAND, { provider: 'clarity', external_account_id: 'p9', display_name: null })).toEqual({ kind: 'error', message: 'Există deja o conexiune pentru acest cont.' })
  })
})

describe('conturile la nivel de client', () => {
  const tenantRow = (o: Record<string, unknown> = {}) => ({ id: 'tc-1', tenant_id: 't-1', brand_id: null, provider: 'google_service_account', external_account_id: 'sa@p.iam.gserviceaccount.com', display_name: null, credential_status: 'unverified', credential_updated_at: null, status: 'active', ...o })

  it('citește doar conexiunile fără brand ale tenantului, pentru furnizorii de client', async () => {
    const { client, calls } = fakeDataClient({
      tables: {
        source_connections: [
          tenantRow(),
          tenantRow({ id: 'tc-2', provider: 'seomonitor', external_account_id: '4821' }),
          tenantRow({ id: 'tc-3', brand_id: BRAND, provider: 'clarity' }),
          tenantRow({ id: 'tc-4', tenant_id: 't-2' }),
          tenantRow({ id: 'tc-5', provider: 'altceva' }),
        ],
      },
    })
    const r = await createSupabaseSources(client, NOW).tenantConnections('t-1')
    expect(r.kind === 'ready' && r.data.map((c) => c.id)).toEqual(['tc-1', 'tc-2'])
    expect(calls[0]?.filters).toEqual(expect.arrayContaining([['tenant_id', 'eq', 't-1'], ['brand_id', 'is', null]]))
  })

  it('creează conexiunea fără brand; refuză furnizorii care nu sunt la nivel de client', async () => {
    const { client, calls } = fakeDataClient()
    const p = createSupabaseSources(client, NOW)
    const r = await p.createTenantConnection('t-1', { provider: 'seomonitor', external_account_id: '4821', display_name: 'SEOmonitor' })
    expect(r.kind).toBe('ready')
    expect(calls.find((c) => c.op === 'insert')?.payload).toEqual({ tenant_id: 't-1', brand_id: null, provider: 'seomonitor', external_account_id: '4821', display_name: 'SEOmonitor' })
    expect((await p.createTenantConnection('t-1', { provider: 'clarity' as never, external_account_id: 'x', display_name: null })).kind).toBe('error')
  })
})
