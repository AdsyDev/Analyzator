import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classifyPgError, inspect, PgError, quoteIdent, type PgSession } from './inspect.ts'

type Col = [schema: string, table: string, column: string, type: string]

const AB: Col[] = [['_airbyte_raw_id', 'uuid'], ['_airbyte_extracted_at', 'timestamp with time zone'], ['_airbyte_meta', 'jsonb']].map(
  ([c, t]) => ['', '', c!, t!] as Col,
)
const table = (schema: string, name: string, cols: Array<[string, string]>): Col[] =>
  [...AB.map(([, , c, t]) => [schema, name, c, t] as Col), ...cols.map(([c, t]) => [schema, name, c, t] as Col)]

const META = table('meta', 'ads_insights', [
  ['account_id', 'character varying'], ['account_name', 'character varying'], ['date_start', 'date'], ['ad_id', 'character varying'],
  ['campaign_id', 'character varying'], ['spend', 'numeric'], ['impressions', 'bigint'], ['clicks', 'bigint'], ['actions', 'jsonb'], ['age', 'character varying'],
])
const META_CATALOG = table('meta', 'ad_account', [['account_id', 'character varying'], ['name', 'character varying'], ['id', 'character varying']])
const GOOGLE = table('gads', 'account_performance_report', [
  ['customer.id', 'bigint'], ['customer.descriptive_name', 'character varying'], ['segments.date', 'date'], ['segments.device', 'character varying'],
  ['metrics.cost_micros', 'bigint'], ['metrics.impressions', 'bigint'], ['metrics.clicks', 'bigint'],
])
// Fluxul `customer` din Google Ads are segments.date, dar nu are metrici: e catalog, nu raport.
const GOOGLE_CATALOG = table('gads', 'customer', [['customer_id', 'bigint'], ['customer_descriptive_name', 'character varying'], ['segments_date', 'date']])
const TIKTOK = table('tiktok', 'advertisers_reports_daily', [['advertiser_id', 'bigint'], ['stat_time_day', 'timestamp without time zone'], ['metrics', 'jsonb'], ['dimensions', 'jsonb']])
const OTHER = table('public', 'users', [['id', 'bigint'], ['email', 'text']])
// Entități Meta fără metrici (campaigns) nu sunt nici raport, nici catalog.
const META_CAMPAIGNS = table('meta', 'campaigns', [['account_id', 'character varying'], ['name', 'character varying'], ['id', 'character varying']])

type Fake = { session: PgSession; sql: string[] }

function fakeSession(columns: Col[], rows: Record<string, Array<Record<string, unknown>> | Error>): Fake {
  const sql: string[] = []
  return {
    sql,
    session: {
      async query<T>(text: string): Promise<T[]> {
        sql.push(text)
        if (text.includes('information_schema.columns')) {
          return columns.map(([schema, t, column, data_type]) => ({ schema, table: t, column, data_type })) as T[]
        }
        for (const [key, value] of Object.entries(rows)) {
          if (text.includes(key)) {
            if (value instanceof Error) throw value
            return value as T[]
          }
        }
        return []
      },
    },
  }
}

const account = (account_id: string, name: string | null, rows: number, first: string, last: string, synced = '2026-10-26T03:00:00Z') => ({
  account_id, name, rows: String(rows), first_date: first, last_date: last, last_synced_at: synced,
})

describe('detectarea tabelelor', () => {
  test('Meta, Google Ads (coloane cu punct) și TikTok (metrici jsonb); restul se ignoră', async () => {
    const f = fakeSession([...META, ...META_CATALOG, ...GOOGLE, ...GOOGLE_CATALOG, ...TIKTOK, ...OTHER, ...META_CAMPAIGNS], {
      'from "meta"."ad_account"': [{ account_id: '111', name: 'Aflamin RO' }],
      'from "meta"."ads_insights"': [account('111', 'Aflamin (vechi)', 50, '2026-09-01', '2026-10-25'), account('222', 'Hepathrombin', 40, '2026-09-05', '2026-10-24')],
      'from "gads"."customer"': [{ account_id: '999', name: 'Aflamin Search' }],
      'from "gads"."account_performance_report"': [account('999', null, 30, '2026-08-01', '2026-10-24', '2026-10-25T22:00:00Z')],
      'jsonb_object_keys': [{ key: 'clicks' }, { key: 'impressions' }, { key: 'spend' }],
      'from "tiktok"."advertisers_reports_daily"': [account('700', null, 25, '2026-10-01', '2026-10-25')],
    })
    const r = await inspect(f.session, Date.now() + 60_000)

    assert.deepEqual(r.platforms.map((p) => [p.platform, p.tables.map((t) => `${t.table}:${t.role}`)]), [
      ['meta_ads', ['ad_account:catalog', 'ads_insights:report']],
      ['google_ads', ['customer:catalog', 'account_performance_report:report']],
      ['tiktok_ads', ['advertisers_reports_daily:report']],
    ])
    const meta = r.platforms[0]!.tables[1]!
    assert.equal(meta.level, 'ad')
    assert.deepEqual(meta.metrics, ['actions', 'clicks', 'impressions', 'spend'])
    assert.deepEqual(meta.dimensions, ['age'])
    assert.equal(meta.rows, 90)
    assert.equal(meta.first_date, '2026-09-01')
    assert.equal(meta.last_date, '2026-10-25')
    const google = r.platforms[1]!.tables[1]!
    assert.deepEqual(google.metrics, ['metrics_clicks', 'metrics_cost_micros', 'metrics_impressions'])
    assert.deepEqual(google.dimensions, ['segments_device'])
    assert.equal(google.level, 'account')
    assert.deepEqual(r.platforms[2]!.tables[0]!.metrics, ['clicks', 'impressions', 'spend'])

    // Numele din catalog au prioritate; conturile fără nume rămân cu null.
    assert.deepEqual(r.accounts.map((a) => [a.platform, a.account_id, a.name, a.rows]), [
      ['google_ads', '999', 'Aflamin Search', 30],
      ['meta_ads', '111', 'Aflamin RO', 50],
      ['meta_ads', '222', 'Hepathrombin', 40],
      ['tiktok_ads', '700', null, 25],
    ])
    assert.equal(r.truncated, false)
  })

  test('identificatorii vin citați din catalog: un nume de tabel cu ghilimele nu iese din identificator', async () => {
    const evil = table('meta', 'x"; drop table t; --', [['account_id', 'text'], ['date_start', 'date'], ['spend', 'numeric']])
    const f = fakeSession(evil, {})
    await inspect(f.session, Date.now() + 60_000)
    const q = f.sql.find((s) => s.includes('group by 1'))!
    assert.ok(q.includes('from "meta"."x""; drop table t; --"'), q)
    assert.equal(quoteIdent('a"b'), '"a""b"')
  })

  test('doar SELECT-uri, fără parametri din afară', async () => {
    const f = fakeSession([...META, ...TIKTOK], {})
    await inspect(f.session, Date.now() + 60_000)
    for (const q of f.sql) assert.match(q.trim(), /^select /i)
  })

  test('același cont în mai multe tabele: perioada cea mai largă, o singură intrare', async () => {
    const breakdown = table('meta', 'ads_insights_age_and_gender', META.slice(AB.length).map(([, , c, t]) => [c, t] as [string, string]))
    const f = fakeSession([...META, ...breakdown], {
      'from "meta"."ads_insights_age_and_gender"': [account('111', 'Aflamin', 300, '2026-08-15', '2026-10-20')],
      'from "meta"."ads_insights"': [account('111', 'Aflamin', 50, '2026-09-01', '2026-10-25')],
    })
    const r = await inspect(f.session, Date.now() + 60_000)
    assert.equal(r.accounts.length, 1)
    assert.deepEqual([r.accounts[0]!.first_date, r.accounts[0]!.last_date, r.accounts[0]!.tables, r.accounts[0]!.rows], ['2026-08-15', '2026-10-25', 2, 300])
  })
})

describe('erori și limite', () => {
  test('un tabel cu timeout rămâne marcat, celelalte se citesc', async () => {
    const f = fakeSession([...META, ...TIKTOK], {
      'from "meta"."ads_insights"': new PgError('timeout', '57014'),
      'jsonb_object_keys': [],
      'from "tiktok"."advertisers_reports_daily"': [account('700', null, 25, '2026-10-01', '2026-10-25')],
    })
    const r = await inspect(f.session, Date.now() + 60_000)
    assert.equal(r.platforms[0]!.tables[0]!.error, 'timeout')
    assert.equal(r.platforms[0]!.tables[0]!.rows, null, 'fără date: null, nu 0')
    assert.equal(r.accounts.length, 1)
  })
  test('drept lipsă pe un tabel: permission', async () => {
    const f = fakeSession(META, { 'from "meta"."ads_insights"': new PgError('permission', '42501') })
    assert.equal((await inspect(f.session, Date.now() + 60_000)).platforms[0]!.tables[0]!.error, 'permission')
  })
  test('conexiunea pierdută oprește inspecția', async () => {
    const f = fakeSession([...META, ...TIKTOK], { 'from "meta"."ads_insights"': new PgError('unreachable', 'ECONNRESET') })
    await assert.rejects(inspect(f.session, Date.now() + 60_000), (e: unknown) => e instanceof PgError && e.kind === 'unreachable')
  })
  test('după termen, tabelele rămase apar ca sărite și rezultatul e trunchiat', async () => {
    let t = 0
    const f = fakeSession([...META, ...TIKTOK], { 'from "meta"."ads_insights"': [account('111', 'A', 1, '2026-10-01', '2026-10-01')] })
    const r = await inspect(f.session, 0, () => t++)
    assert.equal(r.truncated, true)
    assert.equal(r.platforms.find((p) => p.platform === 'tiktok_ads')!.tables[0]!.error, 'skipped')
  })
  test('peste 200 de conturi într-un tabel: trunchiat', async () => {
    const many = Array.from({ length: 201 }, (_, i) => account(String(i + 1), null, 1, '2026-10-01', '2026-10-01'))
    const f = fakeSession(META, { 'from "meta"."ads_insights"': many })
    const r = await inspect(f.session, Date.now() + 60_000)
    assert.equal(r.truncated, true)
    assert.equal(r.accounts.length, 200)
  })
})

describe('classifyPgError', () => {
  const kind = (e: unknown) => classifyPgError(e).kind
  test('SQLSTATE', () => {
    assert.equal(kind({ code: '28P01' }), 'auth')
    assert.equal(kind({ code: '28000' }), 'auth')
    assert.equal(kind({ code: '3D000' }), 'database_not_found')
    assert.equal(kind({ code: '57014' }), 'timeout')
    assert.equal(kind({ code: '42501' }), 'permission')
    assert.equal(kind({ code: '25006' }), 'not_read_only')
    assert.equal(kind({ code: '08006' }), 'unreachable')
  })
  test('rețea și TLS (erorile din Deno, observate pe edge runtime)', () => {
    assert.equal(kind({ code: 'ECONNREFUSED' }), 'unreachable')
    assert.equal(kind({ code: 'CONNECT_TIMEOUT' }), 'timeout')
    assert.equal(kind({ name: 'InvalidData', message: 'invalid peer certificate: UnknownIssuer' }), 'tls')
    assert.equal(kind({ name: 'InvalidData', message: 'invalid peer certificate: NotValidForName' }), 'tls')
    assert.equal(kind({ name: 'UnexpectedEof', message: 'unexpected end of file' }), 'tls')
    assert.equal(kind(new Error('altceva')), 'other')
  })
  test('mesajul serverului nu ajunge în eroarea clasificată', () => {
    const e = classifyPgError({ code: '28P01', message: 'password authentication failed for user "analyzator_ro"' })
    assert.equal(e.message.includes('analyzator_ro'), false)
  })
})
