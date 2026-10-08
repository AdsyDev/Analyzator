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
    expect(Object.keys(s)).toEqual(['seomonitor', 'ga4', 'gsc', 'clarity', 'planable', 'csv_import'])
  })

  it('token refuzat → eroare; ultima sincronizare eșuată → eroare cu ultimele date păstrate; parțial → parțial', async () => {
    expect((await get({ source_connections: [conn({ credential_status: 'invalid' })], sync_runs: [], import_batches: [] })).clarity?.state).toBe('error')
    const failedLast = await get({ source_connections: [conn()], sync_runs: [run({ id: 'r-0', created_at: '2026-10-06T03:00:00Z', period_end: '2026-10-05' }), run({ id: 'r-2', status: 'failed', created_at: '2026-10-08T03:00:00Z' })], import_batches: [] })
    expect(failedLast.clarity).toMatchObject({ state: 'error', data_as_of: '2026-10-05' })
    expect((await get({ source_connections: [conn()], sync_runs: [run({ status: 'partial' })], import_batches: [] })).clarity?.state).toBe('partial')
  })

  it('token salvat dar fără nicio sincronizare: neconectat (tokenul nu înseamnă date); fără token: spune asta', async () => {
    expect((await get({ source_connections: [conn()], sync_runs: [], import_batches: [] })).clarity).toMatchObject({ state: 'not_connected', note: expect.stringContaining('sincronizare') })
    expect((await get({ source_connections: [conn({ credential_status: 'missing' })], sync_runs: [], import_batches: [] })).clarity).toMatchObject({ state: 'not_connected', note: 'Token neconfigurat.' })
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
