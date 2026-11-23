import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTables, PgError, type Column, type PgSession, type PgTarget } from '../../supabase/functions/airbyte/inspect.ts'
import { FakeDb } from '../shared/test-helpers.ts'
import { collectAirbyte, collectionWindow, type AirbyteOutcome } from './collect-core.ts'
import { pickReport, reportQuery, toPaidRows, type ReportRow } from './streams.ts'

const T = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const B1 = 'b1111111-1111-4111-8111-111111111111'
const B2 = 'b2222222-2222-4222-8222-222222222222'
const KEY = 'c0000000-0000-4000-8000-000000000001'
const NOW = () => new Date('2026-11-23T08:00:00Z')

type Cols = Array<[string, string]>
const AB: Cols = [['_airbyte_raw_id', 'uuid'], ['_airbyte_extracted_at', 'timestamp with time zone'], ['_airbyte_meta', 'jsonb']]
const table = (schema: string, name: string, cols: Cols): Column[] => [...AB, ...cols].map(([column, data_type]) => ({ schema, table: name, column, data_type }))

const META = table('public', 'ads_insights', [
  ['account_id', 'character varying'], ['account_name', 'character varying'], ['account_currency', 'character varying'], ['date_start', 'date'],
  ['campaign_id', 'character varying'], ['campaign_name', 'character varying'], ['adset_id', 'character varying'], ['adset_name', 'character varying'],
  ['ad_id', 'character varying'], ['ad_name', 'character varying'], ['spend', 'numeric'], ['impressions', 'bigint'], ['clicks', 'bigint'],
])
const META_BREAKDOWN = table('public', 'ads_insights_age_and_gender', [['account_id', 'text'], ['date_start', 'date'], ['ad_id', 'text'], ['age', 'text'], ['spend', 'numeric']])
const GOOGLE = table('public', 'campaign', [
  ['customer.id', 'bigint'], ['campaign.id', 'bigint'], ['campaign.name', 'text'], ['segments.date', 'date'], ['segments.hour', 'bigint'],
  ['metrics.cost_micros', 'bigint'], ['metrics.impressions', 'bigint'], ['metrics.clicks', 'bigint'], ['metrics.conversions', 'numeric'],
])
const GOOGLE_CATALOG = table('public', 'customer', [['customer.id', 'bigint'], ['customer.descriptive_name', 'text'], ['customer.currency_code', 'text'], ['customer.time_zone', 'text']])

const r = (o: Partial<ReportRow>): ReportRow => ({
  account_id: '111', date: '2026-11-20', campaign_id: 'c1', campaign_name: 'Campanie', ad_group_id: null, ad_group_name: null, ad_id: null, ad_name: null,
  account_name: null, spend: null, impressions: null, clicks: null, conversions: null, currency: null, timezone: null, ...o,
})

function fakePg(columns: Column[], rows: Record<string, unknown[] | Error>) {
  const sql: Array<{ text: string; params: unknown[] }> = []
  const targets: PgTarget[] = []
  const session: PgSession = {
    async query<X>(text: string, params: unknown[] = []): Promise<X[]> {
      sql.push({ text, params })
      if (text.includes('information_schema.columns')) return columns as unknown as X[]
      for (const [k, v] of Object.entries(rows)) {
        if (text.includes(k)) {
          if (v instanceof Error) throw v
          return v as X[]
        }
      }
      return []
    },
  }
  const connect = async <R>(t: PgTarget, run: (s: PgSession) => Promise<R>) => {
    targets.push(t)
    return run(session)
  }
  return { sql, targets, connect }
}

function db(extra: Array<Record<string, unknown>> = [], key: Partial<Record<string, unknown>> = {}) {
  const d = new FakeDb({
    source_connections: [
      { id: KEY, tenant_id: T, brand_id: null, provider: 'airbyte_postgres', external_account_id: 'Airbyte', status: 'active', credential_status: 'valid', ...key },
      ...extra,
    ],
  })
  const validations: unknown[] = []
  d.rpcs.get_source_token = () => 'postgresql://ro:parola@airbyte.exemplu.ro:5498/reporting?sslmode=require'
  d.rpcs.record_source_validation = (a) => void validations.push(a)
  return { d, validations }
}
const link = (id: string, brand: string, external: string, tenant = T) => ({ id, tenant_id: tenant, brand_id: brand, provider: 'airbyte', external_account_id: external, status: 'active', credential_status: 'unverified' })

describe('alegerea tabelului', () => {
  test('Meta: ads_insights, nu defalcările; fără flux recunoscut: null', () => {
    const tables = groupTables([...META_BREAKDOWN, ...META])
    assert.equal(pickReport('meta_ads', tables)?.table, 'ads_insights')
    assert.equal(pickReport('meta_ads', groupTables(META_BREAKDOWN)), null)
    assert.equal(pickReport('tiktok_ads', tables), null)
  })

  test('SELECT-ul: un rând pe cheia fluxului (cel mai recent extras), conturile și fereastra ca parametri', () => {
    const q = reportQuery('google_ads', pickReport('google_ads', groupTables(GOOGLE))!)
    assert.match(q, /^select distinct on \("customer\.id"::text, left\("segments\.date"::text, 10\), "campaign\.id"::text, "segments\.hour"::text\)/)
    assert.match(q, /from "public"\."campaign" where "customer\.id"::text = any\(string_to_array\(\$1, ','\)\) and left\("segments\.date"::text, 10\) between \$2 and \$3/)
    assert.match(q, /"_airbyte_extracted_at" desc nulls last$/)
  })
})

describe('normalizarea în paid_daily', () => {
  const p = { tenant_id: T, brand_id: B1, source_id: 'x', sync_run_id: 'y', collected_at: '2026-11-23T08:00:00Z', source_timezone: 'Europe/Bucharest', currency: 'RON', table: 'public.campaign' }

  test('Google Ads: micro-unități → monedă; orele aceleiași zile se adună; conversiile rămân', () => {
    const notes: string[] = []
    const out = toPaidRows('google_ads', [r({ spend: '1500000', impressions: '100', clicks: '5', conversions: '1.5' }), r({ spend: '2500000', impressions: '50', clicks: '1', conversions: '0' })], p, notes)
    assert.equal(out.length, 1)
    assert.deepEqual([out[0]!.spend, out[0]!.impressions, out[0]!.clicks, out[0]!.conversions], [4, 150, 6, 1.5])
    assert.equal(out[0]!.collection_method, 'api')
    assert.equal(out[0]!.schema_version, 'airbyte-postgres-v1:public.campaign')
    assert.match(String(out[0]!.payload_hash), /^[0-9a-f]{64}$/)
    assert.deepEqual(notes, [])
  })

  test('lipsa rămâne null, nu 0; o valoare invalidă devine notă și null; altă monedă nu se scrie', () => {
    const notes: string[] = []
    const out = toPaidRows('meta_ads', [
      r({ spend: null, impressions: '10' }),
      r({ campaign_id: 'c2', spend: 'abc', impressions: '3' }),
      r({ campaign_id: 'c3', spend: '9', currency: 'EUR' }),
    ], p, notes)
    assert.deepEqual(out.map((o) => [o.campaign_id, o.spend, o.impressions, o.conversions]), [['c1', null, 10, null], ['c2', null, 3, null]])
    assert.equal(notes.length, 2)
  })

  test('fără ID de campanie: numele marcat sau contul, nu un ID inventat', () => {
    const out = toPaidRows('google_ads', [r({ campaign_id: null, campaign_name: 'Brand' }), r({ campaign_id: null, campaign_name: null })], p, [])
    assert.deepEqual(out.map((o) => o.campaign_id), ['name:Brand', 'account:111'])
  })
})

describe('colectarea', () => {
  test('Meta și Google Ads: rândurile site-ului în paid_daily, cu proveniența conexiunii Airbyte; o rulare per cont', async () => {
    const { d, validations } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'), link('a0000000-0000-4000-8000-000000000002', B2, 'google_ads:999')])
    const pg = fakePg([...META, ...GOOGLE, ...GOOGLE_CATALOG], {
      'from "public"."ads_insights"': [r({ account_id: '111', ad_id: 'ad1', spend: '12.5', impressions: '1000', clicks: '20', currency: 'RON', account_name: 'Proenzi RO' })],
      'from "public"."campaign"': [r({ account_id: '999', spend: '3000000', impressions: '400', clicks: '9', conversions: '2' })],
      'from "public"."customer"': [{ account_id: '999', currency: 'EUR', timezone: 'Europe/Bucharest' }],
    })
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })

    assert.deepEqual(out.map((o) => [o.platform, o.status, o.rows_written]).sort(), [['google_ads', 'succeeded', 1], ['meta_ads', 'succeeded', 1]])
    const paid = d.tables.paid_daily!
    const meta = paid.find((x) => x.source === 'meta_ads')!
    assert.deepEqual([meta.brand_id, meta.account_id, meta.ad_id, meta.spend, meta.currency, meta.source_id, meta.click_type], [B1, '111', 'ad1', 12.5, 'RON', 'a0000000-0000-4000-8000-000000000001', 'all'])
    const google = paid.find((x) => x.source === 'google_ads')!
    assert.deepEqual([google.brand_id, google.spend, google.currency, google.conversions], [B2, 3, 'EUR', 2])
    // Rulările: sursa = platforma (Paid Media le vede), conexiunea = legătura Airbyte a site-ului.
    assert.deepEqual(d.tables.sync_runs!.map((s) => [s.source, s.source_connection_id, s.status, s.period_start, s.period_end]).sort(), [
      ['google_ads', 'a0000000-0000-4000-8000-000000000002', 'succeeded', '2026-10-19', '2026-11-22'],
      ['meta_ads', 'a0000000-0000-4000-8000-000000000001', 'succeeded', '2026-10-19', '2026-11-22'],
    ])
    // Conexiunea: la IP-ul verificat, cu numele pentru TLS; conturile și fereastra ca parametri, nu în text.
    assert.deepEqual(pg.targets.map((t) => [t.ip, t.servername, t.port, t.database]), [['89.41.38.210', 'airbyte.exemplu.ro', 5498, 'reporting']])
    for (const q of pg.sql) assert.match(q.text.trim(), /^select /i)
    assert.deepEqual(pg.sql.find((q) => q.text.includes('ads_insights'))!.params, ['111', '2026-10-19', '2026-11-22'])
    assert.deepEqual(validations, [{ p_connection_id: KEY, p_ok: true }])
  })

  test('un cont legat și prin conectorul API nu se colectează de două ori', async () => {
    const { d } = db([
      link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'),
      { id: 'a0000000-0000-4000-8000-000000000009', tenant_id: T, brand_id: B1, provider: 'meta_ads', external_account_id: 'act_111', status: 'active', credential_status: 'unverified' },
    ])
    const pg = fakePg(META, {})
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })
    assert.equal(out[0]!.status, 'not_connected')
    assert.match(out[0]!.reason!, /conectorul API meta_ads/)
    assert.equal(pg.targets.length, 0)
    assert.equal(d.tables.sync_runs, undefined)
  })

  test('fără destinația clientului sau cu ea invalidă: not_connected, fără conexiune; alt client nu e atins', async () => {
    const { d } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'), link('a0000000-0000-4000-8000-000000000003', B2, 'meta_ads:333', T2)], { credential_status: 'invalid' })
    const pg = fakePg(META, {})
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })
    assert.deepEqual(out.map((o) => [o.tenant_id, o.status]), [[T, 'not_connected'], [T2, 'not_connected']])
    assert.match(out[0]!.reason!, /invalid/)
    assert.match(out[1]!.reason!, /nu e configurată/)
    assert.equal(pg.targets.length, 0)
  })

  test('numele rezolvat într-o adresă privată: refuzat înainte de conexiune, cheia devine invalidă', async () => {
    const { d, validations } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111')])
    const pg = fakePg(META, {})
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['10.0.0.5'], connect: pg.connect })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'airbyte_host_not_allowed')
    assert.equal(pg.targets.length, 0)
    assert.deepEqual(validations, [{ p_connection_id: KEY, p_ok: false, p_error: 'host_not_allowed' }])
  })

  test('TLS refuzat: rulări eșuate cu motivul, cheia invalidă; fără mesajul serverului', async () => {
    const { d, validations } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111')])
    const out = await collectAirbyte({
      db: d, now: NOW, resolve: async () => ['89.41.38.210'],
      connect: async () => { throw new PgError('tls', null) },
    })
    assert.equal(out[0]!.status, 'failed')
    assert.equal(out[0]!.errors[0]!.code, 'airbyte_tls')
    assert.deepEqual(validations, [{ p_connection_id: KEY, p_ok: false, p_error: 'tls' }])
  })

  test('fără tabelul platformei sau fără monedă: eșec explicit, nimic scris', async () => {
    const { d } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'tiktok_ads:700'), link('a0000000-0000-4000-8000-000000000002', B2, 'google_ads:999')])
    const pg = fakePg([...META, ...GOOGLE], { 'from "public"."campaign"': [r({ account_id: '999', spend: '1000000' })] })
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })
    const by = Object.fromEntries(out.map((o) => [o.platform, o]))
    assert.equal(by.tiktok_ads!.errors[0]!.code, 'stream_not_found')
    assert.equal(by.google_ads!.status, 'failed')
    assert.equal(by.google_ads!.errors[0]!.code, 'currency_missing')
    assert.equal(d.tables.paid_daily, undefined)
  })

  test('timeout pe tabel: conturile platformei eșuează, celelalte se colectează', async () => {
    const { d } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'), link('a0000000-0000-4000-8000-000000000002', B2, 'google_ads:999')])
    const pg = fakePg([...META, ...GOOGLE, ...GOOGLE_CATALOG], {
      'from "public"."ads_insights"': new PgError('timeout', '57014'),
      'from "public"."campaign"': [r({ account_id: '999', spend: '1000000' })],
      'from "public"."customer"': [{ account_id: '999', currency: 'RON', timezone: null }],
    })
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })
    const by: Record<string, AirbyteOutcome> = Object.fromEntries(out.map((o) => [o.platform, o]))
    assert.equal(by.meta_ads!.status, 'failed')
    assert.equal(by.meta_ads!.errors[0]!.code, 'airbyte_timeout')
    assert.equal(by.google_ads!.status, 'succeeded')
    assert.ok(by.google_ads!.errors.some((e) => e.code === 'parser_note' && /fusul orar/.test(e.message)))
  })

  test('fără date în fereastră: parțial, cu ultima zi sincronizată în Airbyte (sincronizare oprită)', async () => {
    const { d } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'), link('a0000000-0000-4000-8000-000000000002', B2, 'meta_ads:222')])
    const pg = fakePg(META, { 'max(left(': [{ account_id: '111', last_date: '2026-09-18' }] })
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect })
    const by: Record<string, AirbyteOutcome> = Object.fromEntries(out.map((o) => [o.connection_id.slice(-1), o]))
    assert.deepEqual([by['1']!.status, by['1']!.errors[0]!.code], ['partial', 'airbyte_stale'])
    assert.match(by['1']!.errors[0]!.message, /ultima zi sincronizată e 2026-09-18/)
    assert.deepEqual([by['2']!.status, by['2']!.errors[0]!.code], ['partial', 'airbyte_account_absent'])
    assert.equal(d.tables.paid_daily, undefined)
  })

  test('reimportul istoricului: --from până ieri, doar site-ul cerut', async () => {
    const { d } = db([link('a0000000-0000-4000-8000-000000000001', B1, 'meta_ads:111'), link('a0000000-0000-4000-8000-000000000002', B2, 'meta_ads:222')])
    const pg = fakePg(META, { 'from "public"."ads_insights" where': [r({ account_id: '111', date: '2026-05-02', spend: '3', currency: 'RON' })] })
    const out = await collectAirbyte({ db: d, now: NOW, resolve: async () => ['89.41.38.210'], connect: pg.connect, from: '2026-04-01', brandId: B1 })
    assert.deepEqual(out.map((o) => [o.brand_id, o.status, o.rows_written]), [[B1, 'succeeded', 1]])
    assert.deepEqual(pg.sql.find((q) => q.text.includes('distinct on'))!.params, ['111', '2026-04-01', '2026-11-22'])
    assert.deepEqual(d.tables.sync_runs!.map((s) => [s.period_start, s.period_end]), [['2026-04-01', '2026-11-22']])
  })

  test('fereastra: implicit 35 de zile; --from validat (formă, viitor, cel mult 730 de zile)', () => {
    assert.deepEqual(collectionWindow(NOW()), { start: '2026-10-19', end: '2026-11-22' })
    assert.throws(() => collectionWindow(NOW(), '2026-13-01'), /invalid/)
    assert.throws(() => collectionWindow(NOW(), '2026-11-23'), /după ieri/)
    assert.throws(() => collectionWindow(NOW(), '2024-01-01'), /730/)
  })
})
