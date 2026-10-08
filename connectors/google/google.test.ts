import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectGoogle, ga4PropertyName } from './collect-core.ts'
import { activeUsersIntervals, lastCompleteSunday, previousPeriod } from './intervals.ts'
import {
  ga4Date,
  normalizeGa4ActiveUsers,
  normalizeGa4Daily,
  normalizeGa4KeyEvents,
  normalizeGscDaily,
  normalizeGscQueries,
  parseGa4Totals,
  parseGscDateTotals,
  type Ctx,
} from './normalize.ts'
import { classifyGoogleError, callWithRetry } from './errors.ts'
import { reconcileTotals } from './reconcile.ts'
import { Ga4ReportSchema, GscResponseSchema } from './schemas.ts'
import { addDaysIso, calendarDateIn, lookbackWindow } from './dates.ts'
import type { Ga4Client, GscClient, GoogleClients } from './clients.ts'
import { FakeDb } from '../shared/test-helpers.ts'

const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'google', 'docs-derived')
function fixture(name: string): { header: string; payload: unknown } {
  const doc = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { _header: string; payload: unknown }
  return { header: doc._header, payload: doc.payload }
}

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const CRED = '50000000-0000-0000-0000-0000000000a1'
const GA4_CONN = '50000000-0000-0000-0000-0000000000a2'
const GSC_CONN = '50000000-0000-0000-0000-0000000000a3'
const NOW = new Date('2026-10-08T07:00:00Z') // 10:00 în București; ieri = 2026-10-07
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', client_email: 'reader@proj.iam.gserviceaccount.com', private_key: 'PRIVATE-KEY-DO-NOT-LOG' })

const ctx: Ctx = {
  tenant_id: T1, brand_id: B1, source_id: GA4_CONN, sync_run_id: null, collected_at: NOW.toISOString(),
  payload_hash: 'a'.repeat(64), source_timezone: 'Europe/Bucharest', schema_version: 'docs-test',
}
const ga4 = (name: string) => Ga4ReportSchema.parse(fixture(name).payload)
const gsc = (name: string) => GscResponseSchema.parse(fixture(name).payload)

describe('fixtures docs-derived', () => {
  test('toate poartă header-ul „derivat din documentație, neconfirmat”', () => {
    for (const n of ['ga4-daily', 'ga4-key-events', 'ga4-interval-totals', 'ga4-active-users-interval', 'ga4-check-compatibility-ok', 'ga4-check-compatibility-incompatible', 'gsc-daily', 'gsc-totals-by-date', 'gsc-queries-page1', 'gsc-queries-page2']) {
      assert.match(fixture(n).header, /derivat din documentație, neconfirmat/, n)
    }
  })
})

describe('normalize GA4', () => {
  test('web_daily: 7 rânduri, tipuri, md5, proveniență, fus', () => {
    const { rows, issues } = normalizeGa4Daily(ga4('ga4-daily'), ctx)
    assert.equal(rows.length, 7)
    assert.deepEqual(issues, [])
    const first = rows[0]!
    assert.equal(first.date, '2026-10-05')
    assert.equal(first.channel_group, 'Organic Search')
    assert.equal(first.source_medium, 'google / organic')
    assert.equal(first.sessions, 120)
    assert.equal(first.engaged_sessions, 80)
    assert.equal(first.key_events, 6)
    assert.equal(first.active_users_not_additive, 100)
    assert.equal(first.tenant_id, T1)
    assert.equal(first.brand_id, B1)
    assert.equal(first.window_days, 1)
    assert.equal(first.collection_method, 'api')
    assert.match(first.landing_page_md5 as string, /^[0-9a-f]{32}$/)
    assert.equal(first.source_timezone, 'Europe/Bucharest')
    assert.equal(rows.reduce((s, r) => s + (r.sessions as number), 0), 535)
  })

  test('zero vs null: "0" primit e 0 real; metrica ne-cerută (eliminată pentru incompatibilitate) e NULL', () => {
    const { rows } = normalizeGa4Daily(ga4('ga4-daily'), ctx)
    assert.equal(rows.find((r) => r.landing_page === '(not set)')!.key_events, 0)
    const withoutKeyEvents = structuredClone(ga4('ga4-daily'))
    const idx = withoutKeyEvents.metricHeaders!.findIndex((h) => h.name === 'keyEvents')
    withoutKeyEvents.metricHeaders!.splice(idx, 1)
    for (const r of withoutKeyEvents.rows!) r.metricValues!.splice(idx, 1)
    const out = normalizeGa4Daily(withoutKeyEvents, ctx)
    assert.ok(out.rows.every((r) => r.key_events === null), 'lipsa metricii nu devine 0')
    assert.ok(out.rows.every((r) => typeof r.sessions === 'number'))
  })

  test('valoare invalidă → NULL + notă; rând fără dată → sărit', () => {
    const bad = structuredClone(ga4('ga4-daily'))
    bad.rows![0]!.metricValues![0]!.value = 'abc'
    bad.rows![1]!.dimensionValues![0]!.value = '2026-10-05'
    const { rows, issues } = normalizeGa4Daily(bad, ctx)
    assert.equal(rows.length, 6)
    assert.equal(rows[0]!.sessions, null)
    assert.deepEqual(issues.map((i) => i.code).sort(), ['invalid_metric_value', 'invalid_row'])
  })

  test('antet de dimensiune lipsă → niciun rând, nu excepție', () => {
    const r = structuredClone(ga4('ga4-daily'))
    r.dimensionHeaders = r.dimensionHeaders!.filter((h) => h.name !== 'sessionSourceMedium')
    const out = normalizeGa4Daily(r, ctx)
    assert.equal(out.rows.length, 0)
    assert.equal(out.issues[0]!.code, 'missing_dimension_header')
  })

  test('key events pe eventName', () => {
    const { rows } = normalizeGa4KeyEvents(ga4('ga4-key-events'), ctx)
    assert.equal(rows.length, 6)
    assert.equal(rows.reduce((s, r) => s + (r.key_events as number), 0), 28)
  })

  test('active users: un rând per interval cerut, cheia conține ambele capete', () => {
    const { rows } = normalizeGa4ActiveUsers(ga4('ga4-active-users-interval'), ctx, { start: '2026-09-28', end: '2026-10-04' })
    assert.deepEqual([rows[0]!.interval_start, rows[0]!.interval_end, rows[0]!.active_users], ['2026-09-28', '2026-10-04', 910])
    assert.equal('window_days' in rows[0]!, false)
  })

  test('active users: raport fără rânduri = necunoscut, nu zero', () => {
    const empty = { ...ga4('ga4-active-users-interval'), rows: [] }
    const out = normalizeGa4ActiveUsers(empty, ctx, { start: '2026-09-28', end: '2026-10-04' })
    assert.equal(out.rows.length, 0)
    assert.equal(out.issues[0]!.code, 'empty_report')
  })

  test('totaluri raportate de sursă', () => {
    const { totals } = parseGa4Totals(ga4('ga4-interval-totals'), ['sessions', 'engagedSessions', 'keyEvents', 'nuExista'])
    assert.deepEqual(totals, { sessions: 535, engagedSessions: 363, keyEvents: 28, nuExista: null })
  })

  test('date GA4 YYYYMMDD', () => {
    assert.equal(ga4Date('20261007'), '2026-10-07')
    assert.equal(ga4Date('20261340'), null)
    assert.equal(ga4Date('2026-10-07'), null)
    assert.equal(ga4Date(undefined), null)
  })

  test('property ID: numeric sau properties/NNN', () => {
    assert.equal(ga4PropertyName('123456789'), 'properties/123456789')
    assert.equal(ga4PropertyName('properties/42'), 'properties/42')
    assert.equal(ga4PropertyName('G-ABC123'), null)
  })
})

describe('normalize GSC', () => {
  test('search_daily: date × device, CTR raportat păstrat doar pentru reconciliere', () => {
    const { rows, issues } = normalizeGscDaily(gsc('gsc-daily'), { ...ctx, source_timezone: 'America/Los_Angeles' }, 'final')
    assert.equal(rows.length, 6)
    assert.deepEqual(issues, [])
    assert.equal(rows.reduce((s, r) => s + (r.clicks as number), 0), 390)
    assert.equal(rows.reduce((s, r) => s + (r.impressions as number), 0), 11100)
    assert.equal(rows[0]!.device, 'DESKTOP')
    assert.equal(rows[0]!.data_state, 'final')
    assert.equal(rows[0]!.source_timezone, 'America/Los_Angeles')
  })

  test('device necunoscut sau CTR > 1 → rând sărit / NULL', () => {
    const bad = structuredClone(gsc('gsc-daily'))
    bad.rows![0]!.keys![1] = 'SMARTWATCH'
    bad.rows![1]!.ctr = 3
    const { rows, issues } = normalizeGscDaily(bad, ctx, 'final')
    assert.equal(rows.length, 5)
    assert.equal(rows[0]!.ctr_reported, null)
    assert.deepEqual(issues.map((i) => i.code).sort(), ['invalid_metric_value', 'invalid_row'])
  })

  test('query × page: separate de totaluri', () => {
    const { rows } = normalizeGscQueries(gsc('gsc-queries-page1'), ctx, 'final')
    assert.equal(rows.length, 3)
    assert.match(rows[0]!.query_md5 as string, /^[0-9a-f]{32}$/)
    assert.equal(rows[0]!.query, 'urinal remediu')
  })

  test('totaluri pe zi', () => {
    const { byDate } = parseGscDateTotals(gsc('gsc-totals-by-date'))
    assert.deepEqual([...byDate.entries()].map(([d, v]) => [d, v.clicks]), [['2026-10-05', 120], ['2026-10-06', 140], ['2026-10-07', 130]])
  })
})

describe('intervale active users', () => {
  test('ultima duminică completă', () => {
    assert.equal(lastCompleteSunday('2026-10-08'), '2026-10-04') // joi
    assert.equal(lastCompleteSunday('2026-10-05'), '2026-10-04') // luni
    assert.equal(lastCompleteSunday('2026-10-04'), '2026-09-27') // duminică: ziua curentă e incompletă
  })
  test('perioada anterioară de aceeași lungime', () => {
    assert.deepEqual(previousPeriod('2026-09-28', '2026-10-04'), { start: '2026-09-21', end: '2026-09-27' })
    assert.deepEqual(previousPeriod('2026-09-01', '2026-09-30'), { start: '2026-08-02', end: '2026-08-31' })
  })
  test('presetări + comparații, fără duplicate', () => {
    const list = activeUsersIntervals('2026-10-08')
    const keys = list.map((i) => `${i.kind}:${i.start}..${i.end}`)
    assert.ok(keys.includes('week:2026-09-28..2026-10-04'))
    assert.ok(keys.includes('week:2026-09-21..2026-09-27'))
    assert.ok(keys.includes('4_weeks:2026-09-07..2026-10-04'))
    assert.ok(keys.includes('13_weeks:2026-07-06..2026-10-04'))
    assert.ok(keys.includes('month:2026-09-01..2026-09-30'))
    assert.equal(new Set(list.map((i) => `${i.start}|${i.end}`)).size, list.length)
    assert.equal(list.filter((i) => i.comparison_of === null).length, 4)
  })
})

describe('reconcileTotals', () => {
  const base = { metric: 'sessions', tolerancePct: 1 }
  const p = { start: '2026-09-03', end: '2026-10-07', timezone: 'Europe/Bucharest', property: 'properties/1' }
  test('egal → match', () => assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 535 }, source: { ...p, total: 535 } }).status, 'match'))
  test('în toleranță', () => {
    const r = reconcileTotals({ ...base, ours: { ...p, total: 533 }, source: { ...p, total: 535 } })
    assert.equal(r.status, 'within_tolerance')
    assert.equal(r.difference, -2)
  })
  test('peste toleranță → mismatch', () => assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 400 }, source: { ...p, total: 535 } }).status, 'mismatch'))
  test('interval, fus sau proprietate diferite → incomparable (nu mismatch)', () => {
    assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 1 }, source: { ...p, end: '2026-10-06', total: 1 } }).reason, 'interval_differs')
    assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 1 }, source: { ...p, timezone: 'America/Los_Angeles', total: 1 } }).reason, 'timezone_differs')
    assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 1 }, source: { ...p, property: 'properties/2', total: 1 } }).reason, 'property_differs')
  })
  test('total lipsă → incomparable; zero la sursă cu valoare la noi → mismatch fără procent', () => {
    assert.equal(reconcileTotals({ ...base, ours: { ...p, total: null }, source: { ...p, total: 5 } }).reason, 'our_total_missing')
    assert.equal(reconcileTotals({ ...base, ours: { ...p, total: 5 }, source: { ...p, total: null } }).reason, 'source_total_missing')
    const r = reconcileTotals({ ...base, ours: { ...p, total: 5 }, source: { ...p, total: 0 } })
    assert.deepEqual([r.status, r.difference_pct], ['mismatch', null])
  })
})

describe('erori Google și retry', () => {
  test('clasificare gRPC și HTTP', () => {
    assert.equal(classifyGoogleError({ code: 7 }).kind, 'access_denied')
    assert.equal(classifyGoogleError({ code: 16 }).kind, 'access_denied')
    assert.equal(classifyGoogleError({ code: 8 }).kind, 'rate_limited')
    assert.equal(classifyGoogleError({ code: 3 }).kind, 'bad_request')
    assert.equal(classifyGoogleError({ code: 14 }).kind, 'server_error')
    assert.equal(classifyGoogleError({ code: 403, response: { status: 403 } }).kind, 'access_denied')
    assert.equal(classifyGoogleError({ response: { status: 429 } }).kind, 'rate_limited')
    assert.equal(classifyGoogleError({ response: { status: 503 } }).kind, 'server_error')
    assert.equal(classifyGoogleError({ code: 'ECONNRESET' }).kind, 'network_error')
    assert.equal(classifyGoogleError(new Error('x')).kind, 'unexpected')
  })
  test('retry: 429 apoi succes; accesul refuzat nu se reîncearcă', async () => {
    const delays: number[] = []
    const sleep = async (ms: number) => void delays.push(ms)
    let n = 0
    const ok = await callWithRetry(async () => { if (++n < 3) throw { code: 8 }; return 'ok' }, { sleep })
    assert.deepEqual([ok.ok, ok.attempts, delays], [true, 3, [1000, 2000]])
    let m = 0
    const denied = await callWithRetry(async () => { m++; throw { code: 7 } }, { sleep })
    assert.deepEqual([denied.ok, m], [false, 1])
  })
})

describe('dates', () => {
  test('fereastra de 35 de zile până ieri în fusul dat', () => {
    assert.deepEqual(lookbackWindow(NOW, 'Europe/Bucharest', 35), { start: '2026-09-03', end: '2026-10-07' })
    // 23:30 UTC pe 7 oct = 02:30 pe 8 oct la București, dar încă 16:30 pe 7 oct în PT
    const late = new Date('2026-10-07T23:30:00Z')
    assert.equal(calendarDateIn(late, 'Europe/Bucharest'), '2026-10-08')
    assert.equal(calendarDateIn(late, 'America/Los_Angeles'), '2026-10-07')
    assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28')
  })
})

// --- Colectare completă cu clienți simulați ------------------------------------------------------------------------------

type Compat = { incompatibleDimensions: string[]; incompatibleMetrics: string[] }
type FakeOpts = {
  compat?: Compat
  ga4Pages?: boolean
  denyGa4?: boolean
  throwOnce?: Array<{ code: number }>
  dailyOverride?: unknown
  totalsOverride?: unknown
  gscTotalsOverride?: unknown
}

function fakeClients(opts: FakeOpts = {}) {
  const calls = { check: 0, report: [] as Array<{ dims: string; metrics: string[]; offset: number; limit: number; range: string }>, gsc: [] as Array<{ dims: string; startRow: number }> }
  const throwOnce = [...(opts.throwOnce ?? [])]
  const g4: Ga4Client = {
    async checkCompatibility() {
      calls.check++
      if (opts.denyGa4) throw { code: 7, message: 'PERMISSION_DENIED' }
      return opts.compat ?? { incompatibleDimensions: [], incompatibleMetrics: [] }
    },
    async runReport(req) {
      calls.report.push({ dims: req.dimensions.join(','), metrics: req.metrics, offset: req.offset, limit: req.limit, range: `${req.startDate}..${req.endDate}` })
      const next = throwOnce.shift()
      if (next) throw next
      let payload: { rows?: unknown[]; rowCount?: number; [k: string]: unknown }
      if (req.dimensions.length === 0 && req.metrics.includes('activeUsers')) payload = fixture('ga4-active-users-interval').payload as typeof payload
      else if (req.dimensions.length === 0) payload = (opts.totalsOverride ?? fixture('ga4-interval-totals').payload) as typeof payload
      else if (req.dimensions.includes('eventName')) payload = fixture('ga4-key-events').payload as typeof payload
      else payload = (opts.dailyOverride ?? fixture('ga4-daily').payload) as typeof payload
      // Proiecția pe metricile cerute (ca API-ul real): o metrică eliminată nu mai apare în răspuns.
      const headers = (payload.metricHeaders as Array<{ name: string }> | undefined) ?? []
      const keep = headers.map((h, i) => (req.metrics.includes(h.name) ? i : -1)).filter((i) => i >= 0)
      if (keep.length !== headers.length) {
        payload = {
          ...payload,
          metricHeaders: keep.map((i) => headers[i]),
          rows: (payload.rows as Array<{ dimensionValues: unknown[]; metricValues: unknown[] }>).map((r) => ({ ...r, metricValues: keep.map((i) => r.metricValues[i]) })),
        }
      }
      if (opts.ga4Pages && payload.rows && req.dimensions.length > 0) {
        const all = payload.rows
        return { ...payload, rows: all.slice(req.offset, req.offset + req.limit), rowCount: all.length }
      }
      return payload
    },
  }
  const gs: GscClient = {
    async query(req) {
      calls.gsc.push({ dims: req.dimensions.join(','), startRow: req.startRow })
      const slice = (payload: unknown) => {
        const p = payload as { rows: unknown[] }
        return { ...p, rows: p.rows.slice(req.startRow, req.startRow + req.rowLimit) }
      }
      if (req.dimensions.join(',') === 'date,device') return slice(fixture('gsc-daily').payload)
      if (req.dimensions.join(',') === 'date') return slice(opts.gscTotalsOverride ?? fixture('gsc-totals-by-date').payload)
      return req.startRow === 0 ? fixture('gsc-queries-page1').payload : fixture('gsc-queries-page2').payload
    },
  }
  const clients: GoogleClients = { ga4: g4, gsc: gs }
  return { clients, calls }
}

function makeDb(extra: Record<string, Array<Record<string, unknown>>> = {}, credStatus: 'valid' | 'missing' | 'invalid' = 'valid') {
  const db = new FakeDb({
    source_connections: [
      { id: CRED, tenant_id: T1, brand_id: null, provider: 'google_service_account', external_account_id: 'sa-t1', status: 'active', credential_status: credStatus, timezone: 'Europe/Bucharest' },
      { id: GA4_CONN, tenant_id: T1, brand_id: B1, provider: 'ga4', external_account_id: '123456789', status: 'active', credential_status: 'missing', timezone: 'Europe/Bucharest' },
      { id: GSC_CONN, tenant_id: T1, brand_id: B1, provider: 'gsc', external_account_id: 'sc-domain:example.ro', status: 'active', credential_status: 'missing', timezone: 'Europe/Bucharest' },
      ...(extra.source_connections ?? []),
    ],
  })
  db.rpcs.get_source_token = (args) => {
    if (args.p_connection_id !== CRED) throw new Error('Conexiune inexistentă, inactivă sau fără token')
    return SERVICE_ACCOUNT
  }
  return db
}

const noSleep = { sleep: async () => undefined }
const run = (db: FakeDb, opts: FakeOpts = {}, only?: 'ga4' | 'gsc', extra: Partial<Parameters<typeof collectGoogle>[0]> = {}) => {
  const f = fakeClients(opts)
  return collectGoogle({ db, createClients: () => f.clients, now: () => NOW, ...noSleep, ...extra }, only).then((outcomes) => ({ outcomes, ...f }))
}

describe('collectGoogle: GA4', () => {
  test('scrie web_daily, web_key_events și intervale; reconciliere = match; acoperire parțială (3 din 35 de zile) → partial', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, {}, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status as string, 'partial', 'fereastra de 35 de zile nu e acoperită de fixture')
    assert.equal(db.tables.web_daily!.length, 7)
    assert.equal(db.tables.web_key_events!.length, 6)
    assert.equal(o.coverage.web_daily!.covered_days, 3)
    assert.equal(o.coverage.web_daily!.expected_days, 35)
    assert.equal(o.coverage.web_daily!.coverage, 0.0857)
    assert.equal(db.tables.source_reconciliations!.length, 3)
    assert.ok(db.tables.source_reconciliations!.every((r) => r.status === 'match' && r.source_timezone === 'Europe/Bucharest' && r.property_ref === 'properties/123456789'))
    assert.deepEqual(o.reconciliations.map((r) => r.status), ['match', 'match', 'match'])
    // checkCompatibility înainte de fiecare runReport (o dată per combinație distinctă)
    assert.equal(calls.check, 4)
    assert.ok(calls.report.length >= 3)
    const run1 = db.tables.sync_runs![0]!
    assert.equal(run1.source, 'ga4')
    assert.equal(run1.source_connection_id, GA4_CONN)
    assert.equal(run1.period_start, '2026-09-03')
    assert.equal(run1.period_end, '2026-10-07')
    assert.notEqual(run1.status, 'succeeded')
  })

  test('acoperire completă și fără erori → succeeded', async () => {
    const dates = Array.from({ length: 35 }, (_, i) => addDaysIso('2026-09-03', i))
    const ymd = (d: string) => d.replaceAll('-', '')
    const row = (dims: string[], mets: string[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((value) => ({ value })) })
    const daily = {
      dimensionHeaders: ['date', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'landingPagePlusQueryString'].map((name) => ({ name })),
      metricHeaders: ['sessions', 'activeUsers', 'engagedSessions', 'keyEvents'].map((name) => ({ name })),
      rows: dates.map((d) => row([ymd(d), 'Direct', '(direct) / (none)', '/'], ['10', '9', '5', '1'])),
      rowCount: 35, metadata: { timeZone: 'Europe/Bucharest' },
    }
    const keyEvents = {
      dimensionHeaders: [{ name: 'date' }, { name: 'eventName' }], metricHeaders: [{ name: 'keyEvents' }],
      rows: dates.map((d) => row([ymd(d), 'contact'], ['1'])), rowCount: 35, metadata: { timeZone: 'Europe/Bucharest' },
    }
    const totals = { dimensionHeaders: [], metricHeaders: ['sessions', 'engagedSessions', 'keyEvents'].map((name) => ({ name })), rows: [row([], ['350', '175', '35'])], rowCount: 1, metadata: { timeZone: 'Europe/Bucharest' } }
    const f = fakeClients({ totalsOverride: totals })
    const base = f.clients.ga4.runReport.bind(f.clients.ga4)
    f.clients.ga4.runReport = async (req) => (req.dimensions.includes('eventName') ? keyEvents : req.dimensions.includes('landingPagePlusQueryString') ? daily : base(req))
    const db = makeDb()
    const [o] = await collectGoogle({ db, createClients: () => f.clients, now: () => NOW, ...noSleep }, 'ga4')
    if (o!.status === 'not_connected') assert.fail()
    assert.equal(o!.status as string, 'succeeded')
    assert.equal(o!.coverage.web_daily!.coverage, 1)
    assert.deepEqual(o!.errors, [])
  })

  test('rulare dublă: idempotentă, aceleași rânduri și aceleași totaluri', async () => {
    const db = makeDb()
    await run(db, {}, 'ga4')
    const sum = (t: string, c: string) => db.tables[t]!.reduce((s, r) => s + (r[c] as number), 0)
    const snapshot = { daily: db.tables.web_daily!.length, keys: db.tables.web_key_events!.length, active: db.tables.web_active_users_interval!.length, recon: db.tables.source_reconciliations!.length, sessions: sum('web_daily', 'sessions') }
    await run(db, {}, 'ga4')
    assert.deepEqual(
      { daily: db.tables.web_daily!.length, keys: db.tables.web_key_events!.length, active: db.tables.web_active_users_interval!.length, recon: db.tables.source_reconciliations!.length, sessions: sum('web_daily', 'sessions') },
      snapshot,
    )
    assert.equal(snapshot.sessions, 535)
    assert.equal(db.tables.sync_runs!.length, 2, 'fiecare rulare are propriul sync_run')
  })

  test('utilizatori activi: câte un rând per interval, nesumați; intervalele din cheie', async () => {
    const db = makeDb()
    await run(db, {}, 'ga4')
    const rows = db.tables.web_active_users_interval!
    assert.equal(rows.length, activeUsersIntervals('2026-10-08').length)
    assert.equal(new Set(rows.map((r) => `${r.interval_start}|${r.interval_end}`)).size, rows.length)
    assert.ok(rows.every((r) => r.active_users === 910), 'fixture-ul întoarce 910 pentru fiecare interval; nimic nu se adună')
    // activeUsers din raportul pe zile e păstrat separat și etichetat nesumabil
    assert.ok(db.tables.web_daily!.every((r) => 'active_users_not_additive' in r && !('active_users' in r)))
  })

  test('paginare GA4 cu offset', async () => {
    const db = makeDb()
    const { calls } = await run(db, { ga4Pages: true }, 'ga4', { ga4PageSize: 3 })
    const dailyCalls = calls.report.filter((c) => c.dims.includes('landingPagePlusQueryString'))
    assert.deepEqual(dailyCalls.map((c) => c.offset), [0, 3, 6])
    assert.equal(db.tables.web_daily!.length, 7)
  })

  test('combinație incompatibilă (metrică): raportată în sync_runs.errors, metrica eliminată din cerere, rândurile cu NULL', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, { compat: { incompatibleDimensions: [], incompatibleMetrics: ['keyEvents'] } }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status as string, 'partial')
    const err = o.errors.find((e) => e.code === 'ga4_incompatible_metrics')
    assert.ok(err)
    assert.match(err.message, /keyEvents/)
    const dailyReq = calls.report.find((c) => c.dims.includes('landingPagePlusQueryString'))!
    assert.ok(!dailyReq.metrics.includes('keyEvents'))
    assert.ok(db.tables.web_daily!.every((r) => r.key_events === null), 'metrica eliminată rămâne NULL, nu 0')
    const run1 = db.tables.sync_runs![0]!
    assert.ok((run1.errors as Array<{ code: string }>).some((e) => e.code === 'ga4_incompatible_metrics'))
  })

  test('combinație incompatibilă (dimensiune): raportul se sare, nu se cere', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, { compat: { incompatibleDimensions: ['landingPagePlusQueryString'], incompatibleMetrics: [] } }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.ok(o.errors.some((e) => e.code === 'ga4_incompatible_dimensions'))
    assert.ok(!calls.report.some((c) => c.dims.includes('landingPagePlusQueryString')))
    assert.equal((db.tables.web_daily ?? []).length, 0)
  })

  test('acces refuzat (403/gRPC 7): failed, fără retry, fără excepție, fără alte cereri', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, { denyGa4: true }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status, 'failed')
    assert.equal(calls.check, 1)
    assert.equal(calls.report.length, 0)
    assert.ok(o.errors.some((e) => e.code === 'access_denied'))
    assert.equal(db.tables.sync_runs![0]!.status, 'failed')
  })

  test('eroare tranzitorie 429 reîncercată', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, { throwOnce: [{ code: 8 }] }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.notEqual(o.status, 'failed')
    assert.ok(calls.report.length > 3)
    assert.equal(db.tables.web_daily!.length, 7)
  })

  test('reconciliere cu diferență peste toleranță → mismatch în errors, run partial', async () => {
    const db = makeDb()
    const totals = structuredClone(fixture('ga4-interval-totals').payload) as { rows: Array<{ metricValues: Array<{ value: string }> }> }
    totals.rows[0]!.metricValues[0]!.value = '9999'
    const { outcomes } = await run(db, { totalsOverride: totals }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.reconciliations.find((r) => r.metric === 'sessions')!.status, 'mismatch')
    assert.ok(o.errors.some((e) => e.code === 'reconciliation_mismatch'))
    assert.equal(db.tables.source_reconciliations!.find((r) => r.metric === 'sessions')!.status, 'mismatch')
  })

  test('data loss din „(other)” și fus diferit sunt raportate', async () => {
    const db = makeDb()
    const daily = structuredClone(fixture('ga4-daily').payload) as { metadata: Record<string, unknown> }
    daily.metadata = { ...daily.metadata, dataLossFromOtherRow: true, timeZone: 'America/New_York' }
    const { outcomes } = await run(db, { dailyOverride: daily }, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    const codes = o.errors.map((e) => e.code)
    assert.ok(codes.includes('ga4_data_loss_other_row'))
    assert.ok(codes.includes('timezone_mismatch'))
    assert.ok(db.tables.web_daily!.every((r) => r.source_timezone === 'America/New_York'), 'se păstrează fusul din răspuns')
  })

  test('property ID invalid: failed, fără apeluri', async () => {
    const db = makeDb({ source_connections: [] })
    db.tables.source_connections!.find((c) => c.id === GA4_CONN)!.external_account_id = 'G-ABC123'
    const { outcomes, calls } = await run(db, {}, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status, 'failed')
    assert.equal(calls.check + calls.report.length, 0)
  })
})

describe('collectGoogle: Search Console', () => {
  test('search_daily, totaluri, query×page cu paginare startRow; reconciliere clicks/impressions = match', async () => {
    const db = makeDb()
    const { outcomes, calls } = await run(db, {}, 'gsc', { gscRowLimit: 3 })
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(db.tables.search_daily!.length, 6)
    assert.equal(db.tables.search_queries!.length, 5)
    assert.deepEqual(calls.gsc.filter((c) => c.dims.includes('query')).map((c) => c.startRow), [0, 3])
    assert.deepEqual(o.reconciliations.map((r) => [r.metric, r.status]), [['clicks', 'match'], ['impressions', 'match']])
    assert.ok(db.tables.source_reconciliations!.every((r) => r.source_timezone === 'America/Los_Angeles' && r.property_ref === 'sc-domain:example.ro'))
    assert.ok(db.tables.search_daily!.every((r) => r.data_state === 'final'))
    assert.equal(o.coverage.search_daily!.covered_days, 3)
    assert.equal(db.tables.sync_runs![0]!.source, 'gsc')
  })

  test('rulare dublă idempotentă', async () => {
    const db = makeDb()
    await run(db, {}, 'gsc', { gscRowLimit: 3 })
    const before = [db.tables.search_daily!.length, db.tables.search_queries!.length, db.tables.source_reconciliations!.length]
    await run(db, {}, 'gsc', { gscRowLimit: 3 })
    assert.deepEqual([db.tables.search_daily!.length, db.tables.search_queries!.length, db.tables.source_reconciliations!.length], before)
  })

  test('totalurile din search_queries nu intră în reconciliere (interogările anonimizate lipsesc)', async () => {
    const db = makeDb()
    const queryClicks = (await run(db, {}, 'gsc', { gscRowLimit: 3 })) && db.tables.search_queries!.reduce((s, r) => s + (r.clicks as number), 0)
    assert.equal(queryClicks, 44)
    assert.notEqual(queryClicks, 390, 'query×page nu însumează la total; reconcilierea folosește search_daily')
    assert.ok(db.tables.source_reconciliations!.every((r) => r.our_total === (r.metric === 'clicks' ? 390 : 11100)), JSON.stringify(db.tables.source_reconciliations))
  })

  test('plafon de pagini atins → gsc_truncated, run partial', async () => {
    const db = makeDb()
    const { outcomes } = await run(db, {}, 'gsc', { gscRowLimit: 3, gscMaxPages: 1 })
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.ok(o.errors.some((e) => e.code === 'gsc_truncated'))
    assert.equal(o.status, 'partial')
  })

  test('site_url invalid: failed fără cereri', async () => {
    const db = makeDb()
    db.tables.source_connections!.find((c) => c.id === GSC_CONN)!.external_account_id = 'example.ro'
    const { outcomes, calls } = await run(db, {}, 'gsc')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status, 'failed')
    assert.equal(calls.gsc.length, 0)
  })
})

describe('collectGoogle: conexiune lipsă și izolare', () => {
  test('fără credential Google: not_connected curat, fără sync_run, fără cereri, fără excepție', async () => {
    const db = new FakeDb({
      source_connections: [{ id: GA4_CONN, tenant_id: T1, brand_id: B1, provider: 'ga4', external_account_id: '1', status: 'active', credential_status: 'missing', timezone: 'Europe/Bucharest' }],
    })
    const { outcomes, calls } = await run(db)
    assert.deepEqual(outcomes.map((o) => [o.source, o.status]), [['ga4', 'not_connected']])
    assert.equal(db.tables.sync_runs, undefined)
    assert.equal(calls.check + calls.report.length + calls.gsc.length, 0)
  })

  test('credential configurat dar fără token sau invalid: not_connected cu motiv', async () => {
    for (const status of ['missing', 'invalid'] as const) {
      const db = makeDb({}, status)
      const { outcomes } = await run(db)
      assert.ok(outcomes.every((o) => o.status === 'not_connected'), status)
      assert.match((outcomes[0] as { reason: string }).reason, /credential Google/)
      assert.equal(db.tables.sync_runs, undefined)
    }
  })

  test('credentialul unui tenant nu e folosit pentru brandul altui tenant', async () => {
    const db = makeDb({
      source_connections: [{ id: '50000000-0000-0000-0000-0000000000b2', tenant_id: T2, brand_id: B2, provider: 'ga4', external_account_id: '999', status: 'active', credential_status: 'missing', timezone: 'Europe/Bucharest' }],
    })
    const { outcomes } = await run(db, {}, 'ga4')
    const t2 = outcomes.find((o) => o.brand_id === B2)!
    assert.equal(t2.status, 'not_connected')
    assert.ok(db.tables.web_daily!.every((r) => r.tenant_id === T1), 'nimic scris pe T2')
    assert.ok(db.tables.sync_runs!.every((r) => r.tenant_id === T1))
  })

  test('conexiune fără brand: not_connected', async () => {
    const db = makeDb({ source_connections: [{ id: '50000000-0000-0000-0000-0000000000b3', tenant_id: T1, brand_id: null, provider: 'ga4', external_account_id: '5', status: 'active', credential_status: 'missing', timezone: 'Europe/Bucharest' }] })
    const { outcomes } = await run(db, {}, 'ga4')
    assert.ok(outcomes.some((o) => o.status === 'not_connected' && o.brand_id === null))
  })

  test('JSON de service account invalid: failed, mesajul nu conține cheia privată', async () => {
    const db = makeDb()
    db.rpcs.get_source_token = () => JSON.stringify({ type: 'service_account', client_email: 'nu-e-email', private_key: 'PRIVATE-KEY-DO-NOT-LOG' })
    const { outcomes } = await run(db, {}, 'ga4')
    const o = outcomes[0]!
    if (o.status === 'not_connected') assert.fail()
    assert.equal(o.status, 'failed')
    assert.doesNotMatch(JSON.stringify(db.tables), /PRIVATE-KEY-DO-NOT-LOG/)
  })

  test('tokenul (service account) nu apare în sync_runs, provider_api_calls sau tabelele de date', async () => {
    const db = makeDb()
    await run(db)
    assert.doesNotMatch(JSON.stringify(db.tables), /PRIVATE-KEY-DO-NOT-LOG|reader@proj/)
  })

  test('apelurile API se contorizează în provider_api_calls pe conexiunea brandului', async () => {
    const db = makeDb()
    await run(db, {}, 'ga4')
    const calls = db.tables.provider_api_calls!
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.source_connection_id, GA4_CONN)
    assert.equal(calls[0]!.call_date_utc, '2026-10-08')
    assert.ok((calls[0]!.calls as number) >= 4)
  })
})
