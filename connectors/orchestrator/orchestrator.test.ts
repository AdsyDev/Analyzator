// Date SINTETICE, doar în acest fișier de test.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CONNECTOR_FLAGS, connectorEnabled, flagEnabled } from '../shared/flags.ts'
import { REFRESH_ORDER, recordSourceFailure, runRefresh, type RefreshSource, type RunnerOutcome, type Runners } from './refresh.ts'
import { defaultRunners } from './runners.ts'
import { dispatchOpsNotifications, enqueueFailure, failureMessage } from './ops-notifications.ts'
import { FakeDb as BaseFakeDb } from '../shared/test-helpers.ts'
import type { Db, Row } from '../shared/supabase-rest.ts'

class FakeDb extends BaseFakeDb {
  rows(table: string): Row[] {
    return (this.tables[table] ??= [])
  }
  // FakeDb de bază nu cunoaște order/limit/offset; aici contează doar filtrele de egalitate.
  override async select<T extends Row>(table: string, query: string): Promise<T[]> {
    return super.select<T>(table, query.replace(/&(order|limit|offset)=[^&]*/g, ''))
  }
}

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000012'
const B3 = '20000000-0000-0000-0000-000000000021'
const C_SEO = '50000000-0000-0000-0000-0000000000c1'
const C_GA4 = '50000000-0000-0000-0000-0000000000c2'
const NOW = () => new Date('2026-10-08T07:00:00Z')
const ALL_ON = { CONNECTOR_SEOMONITOR_ENABLED: 'true', CONNECTOR_GOOGLE_ENABLED: 'true', CONNECTOR_CLARITY_ENABLED: 'true' }

function seed(extra: Record<string, Row[]> = {}) {
  return new FakeDb({
    brands: [
      { id: B1, tenant_id: T1, name: 'Brand A', status: 'active' },
      { id: B2, tenant_id: T1, name: 'Brand B', status: 'active' },
      { id: B3, tenant_id: T2, name: 'Brand C', status: 'active' },
    ],
    source_connections: [
      { id: C_SEO, tenant_id: T1, brand_id: null, provider: 'seomonitor', status: 'active' },
      { id: C_GA4, tenant_id: T1, brand_id: B1, provider: 'ga4', status: 'active' },
    ],
    ...extra,
  })
}

function outcome(source: string, db: FakeDb, o: Partial<RunnerOutcome> & { status: RunnerOutcome['status'] }): RunnerOutcome {
  // Un runner real ar fi scris sync_runs; simulăm și rândul.
  const id = `00000000-0000-4000-8000-${String(db.rows('sync_runs').length + 1).padStart(12, '0')}`
  if (o.status !== 'not_connected') {
    db.rows('sync_runs').push({ id, tenant_id: o.tenant_id ?? T1, brand_id: o.brand_id ?? B1, source, status: o.status })
  }
  return {
    tenant_id: T1, brand_id: B1, connection_id: C_GA4, sync_run_id: o.status === 'not_connected' ? null : id, errors: [], ...o,
  }
}

function runners(db: FakeDb, calls: string[], plan: Partial<Record<RefreshSource, () => Promise<RunnerOutcome[]>>> = {}): Runners {
  const make = (s: RefreshSource): (() => Promise<RunnerOutcome[]>) =>
    plan[s] ?? (async () => [outcome(s, db, { status: 'succeeded' })])
  const wrap = (s: RefreshSource) => async () => { calls.push(s); return make(s)() }
  return { seomonitor: wrap('seomonitor'), ga4: wrap('ga4'), gsc: wrap('gsc') }
}

describe('flag-uri', () => {
  test('doar „true” activează; ga4 și gsc împart flag-ul Google', () => {
    for (const v of ['true', 'TRUE', ' True ']) assert.equal(flagEnabled({ X: v }, 'X'), true, v)
    for (const v of [undefined, '', 'false', '1', 'yes', 'trueish']) assert.equal(flagEnabled({ X: v }, 'X'), false, String(v))
    assert.equal(CONNECTOR_FLAGS.ga4, CONNECTOR_FLAGS.gsc)
    assert.equal(connectorEnabled({ CONNECTOR_GOOGLE_ENABLED: 'true' }, 'gsc'), true)
    assert.equal(connectorEnabled({}, 'clarity'), false)
  })
  test('flag-urile se citesc doar din connectors/shared/flags.ts', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const root = join(import.meta.dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !full.endsWith(join('shared', 'flags.ts'))) {
          if (/CONNECTOR_[A-Z]+_ENABLED/.test(readFileSync(full, 'utf8').replace(/\/\/.*$/gm, ''))) offenders.push(full)
        }
      }
    }
    walk(root)
    assert.deepEqual(offenders, [], 'flag-urile CONNECTOR_*_ENABLED apar în afara modulului dedicat')
  })
})

describe('ordinea și flag-urile', () => {
  test('rulează în ordinea seomonitor → ga4 → gsc, câte o dată', async () => {
    const db = seed()
    const calls: string[] = []
    const r = await runRefresh({ db, env: ALL_ON, runners: runners(db, calls), now: NOW })
    assert.deepEqual(calls, ['seomonitor', 'ga4', 'gsc'])
    assert.deepEqual(REFRESH_ORDER, ['seomonitor', 'ga4', 'gsc'])
    assert.deepEqual(r.sources.map((s) => s.source), ['seomonitor', 'ga4', 'gsc'])
    assert.equal(r.clean, true)
  })

  test('Clarity nu intră în refresh-ul săptămânal (colectare zilnică proprie), chiar dacă flag-ul e activ', async () => {
    const db = seed()
    const r = await runRefresh({ db, env: ALL_ON, runners: runners(db, []), now: NOW })
    assert.ok(!r.sources.some((s) => (s.source as string) === 'clarity'))
  })

  test('sursele cu flag dezactivat sunt sărite: runner neapelat, fără sync_runs', async () => {
    const db = seed()
    const calls: string[] = []
    const r = await runRefresh({ db, env: { CONNECTOR_GOOGLE_ENABLED: 'true' }, runners: runners(db, calls), now: NOW })
    assert.deepEqual(calls, ['ga4', 'gsc'])
    assert.equal(r.sources[0]!.state, 'disabled')
    assert.deepEqual(r.sources.map((s) => s.state), ['disabled', 'ran', 'ran'])
  })

  test('niciun flag activ: nimic nu rulează', async () => {
    const db = seed()
    const calls: string[] = []
    const r = await runRefresh({ db, env: {}, runners: runners(db, calls), now: NOW })
    assert.deepEqual(calls, [])
    assert.ok(r.sources.every((s) => s.state === 'disabled'))
    assert.equal(db.rows('sync_runs').length, 0)
  })

  test('--only: doar sursele cerute, în ordinea standard', async () => {
    const db = seed()
    const calls: string[] = []
    await runRefresh({ db, env: ALL_ON, runners: runners(db, calls), now: NOW, only: ['gsc', 'seomonitor'] })
    assert.deepEqual(calls, ['seomonitor', 'gsc'])
  })
})

describe('izolarea eșecurilor', () => {
  test('o sursă care aruncă excepție nu le oprește pe celelalte; eșecul e înregistrat pentru brandurile afectate și pus în coadă', async () => {
    const db = seed()
    const calls: string[] = []
    const r = await runRefresh({
      db, env: ALL_ON, now: NOW,
      runners: runners(db, calls, { seomonitor: async () => { throw new Error('API SEOmonitor indisponibil') } }),
    })
    assert.deepEqual(calls, ['seomonitor', 'ga4', 'gsc'], 'ga4 și gsc au rulat după excepție')
    assert.equal(r.sources[0]!.state, 'exception')
    assert.equal(r.exceptions, 1)
    assert.equal(r.clean, false)
    // Conexiunea SEOmonitor e la nivel de client → ambele branduri ale lui T1 (nu și T2)
    const failed = db.rows('sync_runs').filter((x) => x.source === 'seomonitor')
    assert.deepEqual(failed.map((x) => [x.brand_id, x.status]).sort(), [[B1, 'failed'], [B2, 'failed']])
    assert.equal((failed[0]!.errors as Array<{ code: string }>)[0]!.code, 'orchestrator_exception')
    assert.equal(db.rows('ops_notifications').length, 2)
    assert.ok(db.rows('ops_notifications').every((n) => n.tenant_id === T1))
  })

  test('excepție la două surse: toate încercate, toate raportate', async () => {
    const db = seed()
    const calls: string[] = []
    const r = await runRefresh({
      db, env: ALL_ON, now: NOW,
      runners: runners(db, calls, {
        seomonitor: async () => { throw new Error('x') },
        ga4: async () => { throw new Error('y') },
      }),
    })
    assert.deepEqual(calls, ['seomonitor', 'ga4', 'gsc'])
    assert.equal(r.exceptions, 2)
    assert.equal(r.sources[2]!.counts.succeeded, 1)
  })

  test('o rulare cu status failed returnată de conector: alertă o singură dată, chiar dacă refresh-ul se repetă', async () => {
    const db = seed()
    const failedRun = (): RunnerOutcome => outcome('ga4', db, { status: 'failed', errors: [{ code: 'access_denied', status: 403, message: 'fără acces' }] })
    const plan = { ga4: async () => [failedRun()] }
    const r1 = await runRefresh({ db, env: ALL_ON, runners: runners(db, [], plan), now: NOW })
    assert.equal(r1.failed_runs, 1)
    assert.equal(r1.notifications_enqueued, 1)
    assert.equal(db.rows('ops_notifications').length, 1)
    const n = db.rows('ops_notifications')[0]!
    assert.deepEqual([n.kind, n.source, n.tenant_id, n.brand_id], ['refresh_failed', 'ga4', T1, B1])
    assert.match(String(n.subject), /ga4.*Brand A/)
    assert.match(String(n.body), /access_denied/)
    // aceeași rulare reîncercată → același sync_run_id → nu se dublează
    const run = db.rows('sync_runs').find((r) => r.status === 'failed')!
    await enqueueFailure(db, { tenant_id: T1, brand_id: B1, sync_run_id: run.id as string, source: 'ga4', brand_name: 'Brand A', errors: [] })
    assert.equal(db.rows('ops_notifications').length, 1)
  })

  test('rularea parțială nu e succeeded și nu e eșec: numărată separat, fără alertă', async () => {
    const db = seed()
    const r = await runRefresh({
      db, env: ALL_ON, now: NOW,
      runners: runners(db, [], { gsc: async () => [outcome('gsc', db, { status: 'partial', errors: [{ code: 'gsc_truncated', status: null, message: 'x' }] })] }),
    })
    assert.equal(r.partial_runs, 1)
    assert.equal(r.failed_runs, 0)
    assert.equal(r.clean, false)
    assert.equal(r.sources[2]!.counts.succeeded, 0)
    assert.equal(db.rows('ops_notifications').length, 0)
  })

  test('neconectat nu e eșec: fără sync_run, fără alertă', async () => {
    const db = seed()
    const r = await runRefresh({
      db, env: ALL_ON, now: NOW,
      runners: runners(db, [], { ga4: async () => [outcome('ga4', db, { status: 'not_connected', reason: 'credential Google neconfigurat' })] }),
    })
    assert.equal(r.sources[1]!.counts.not_connected, 1)
    assert.equal(r.failed_runs, 0)
    assert.equal(db.rows('ops_notifications').length, 0)
    assert.equal(r.clean, true)
  })

  test('recordSourceFailure: ia în calcul doar tenantul cerut când e dat', async () => {
    const db = seed({
      source_connections: [
        { id: C_SEO, tenant_id: T1, brand_id: null, provider: 'seomonitor', status: 'active' },
        { id: '50000000-0000-0000-0000-0000000000c9', tenant_id: T2, brand_id: null, provider: 'seomonitor', status: 'active' },
      ],
    })
    const out = await recordSourceFailure(db, 'seomonitor', 'eroare', NOW, { tenant_id: T2 })
    assert.deepEqual(out.map((o) => [o.tenant_id, o.brand_id]), [[T2, B3]])
    assert.deepEqual(db.rows('sync_runs').map((r) => r.tenant_id), [T2])
  })

  test('izolare între tenanți: alerta unui tenant poartă tenant_id-ul lui', async () => {
    const db = seed()
    const out = await recordSourceFailure(db, 'seomonitor', 'eroare', NOW)
    assert.equal(out.length, 2)
    assert.ok(out.every((o) => o.tenant_id === T1))
  })
})

describe('adaptoare (conectorii reali, fără conexiuni)', () => {
  test('fără conexiuni active: niciun rezultat, nicio excepție', async () => {
    const db = new FakeDb({ source_connections: [], brands: [] })
    const r = defaultRunners({ db, now: NOW })
    assert.deepEqual(await r.seomonitor(), [])
    assert.deepEqual(await r.ga4(), [])
    assert.deepEqual(await r.gsc(), [])
  })

  test('conexiune GA4 fără credential Google: not_connected cu tenantul conexiunii, fără sync_run', async () => {
    const db = new FakeDb({ source_connections: [{ id: C_GA4, tenant_id: T1, brand_id: B1, provider: 'ga4', external_account_id: '1', status: 'active', timezone: 'Europe/Bucharest', credential_status: 'missing' }] })
    const out = await defaultRunners({ db, now: NOW }).ga4()
    assert.deepEqual(out.map((o) => [o.status, o.tenant_id, o.brand_id, o.sync_run_id]), [['not_connected', T1, B1, null]])
    assert.equal(db.rows('sync_runs').length, 0)
  })

  test('o eroare a bazei de date ajunge la orchestrator ca excepție și se izolează', async () => {
    const broken: Db = {
      select: async () => { throw new Error('baza indisponibilă') },
      insert: async () => { throw new Error('baza indisponibilă') },
      update: async () => { throw new Error('baza indisponibilă') },
      upsert: async () => { throw new Error('baza indisponibilă') },
      rpc: async () => { throw new Error('baza indisponibilă') },
    }
    await assert.rejects(defaultRunners({ db: broken, now: NOW }).seomonitor(), /baza indisponibilă/)
    const calls: string[] = []
    const r = await runRefresh({
      db: seed(), env: ALL_ON, now: NOW,
      runners: { seomonitor: defaultRunners({ db: broken, now: NOW }).seomonitor, ga4: async () => { calls.push('ga4'); return [] }, gsc: async () => { calls.push('gsc'); return [] } },
    })
    assert.equal(r.sources[0]!.state, 'exception')
    assert.deepEqual(calls, ['ga4', 'gsc'])
  })
})

describe('alerte: coada care nu pierde nimic', () => {
  const ENV = { RESEND_API_KEY: 're_test_KEY_DO_NOT_LOG', OPS_FROM_EMAIL: 'Analyzator <ops@exemplu.ro>' }
  const run = { tenant_id: T1, brand_id: B1, sync_run_id: '00000000-0000-4000-8000-000000000001', source: 'ga4', brand_name: 'Brand A', errors: [{ code: 'access_denied', status: 403, message: 'fără acces la proprietate' }] }

  function fakeResend(responses: Array<{ status: number; body?: unknown } | Error>) {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = []
    const queue = [...responses]
    const fetch = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
      const next = queue.shift() ?? { status: 200, body: { id: 'm1' } }
      if (next instanceof Error) throw next
      return new Response(JSON.stringify(next.body ?? {}), { status: next.status })
    }
    return { fetch, calls }
  }
  async function pending(extra: Record<string, Row[]> = {}) {
    const db = new FakeDb({ alert_contacts: [{ tenant_id: T1, email: 'Ops@Agentie.ro', active: true }, { tenant_id: T1, email: 'vechi@agentie.ro', active: false }, { tenant_id: T2, email: 'alt@agentie.ro', active: true }], ...extra })
    await enqueueFailure(db, run)
    const row = db.rows('ops_notifications')[0]!
    Object.assign(row, { id: '80000000-0000-0000-0000-0000000000a1', status: 'pending', attempts: 0, last_error: null, created_at: '1' })
    return db
  }

  test('mesajul conține sursa, brandul și codurile de eroare, nu secrete', () => {
    const m = failureMessage({ ...run, errors: Array.from({ length: 8 }, (_, i) => ({ code: `e${i}`, status: null, message: 'x'.repeat(500) })) }, 'https://app.exemplu.ro')
    assert.match(m.subject, /Refresh eșuat: ga4 · Brand A/)
    assert.match(m.body, /… și încă 3/)
    assert.ok(m.body.length < 2500)
    assert.match(m.body, /administrare\/surse/)
  })

  test('fără secret sau expeditor: nimic nu se trimite, alerta rămâne pending, încercările neschimbate', async () => {
    const db = await pending()
    const r = fakeResend([])
    assert.equal((await dispatchOpsNotifications({ db, fetch: r.fetch, env: { OPS_FROM_EMAIL: ENV.OPS_FROM_EMAIL } })).state, 'secret_missing')
    assert.equal((await dispatchOpsNotifications({ db, fetch: r.fetch, env: { RESEND_API_KEY: ENV.RESEND_API_KEY } })).state, 'sender_missing')
    assert.equal(r.calls.length, 0)
    assert.deepEqual([db.rows('ops_notifications')[0]!.status, db.rows('ops_notifications')[0]!.attempts], ['pending', 0])
  })

  test('trimitere: către contactele active ale tenantului, cu Idempotency-Key; marcată sent', async () => {
    const db = await pending()
    const r = fakeResend([{ status: 200, body: { id: 'msg-9' } }])
    const s = await dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV, now: NOW })
    assert.equal(s.sent, 1)
    assert.deepEqual(r.calls[0]!.body.to, ['ops@agentie.ro'])
    assert.equal(r.calls[0]!.headers['Idempotency-Key'], `ops-notification-${db.rows('ops_notifications')[0]!.id}`)
    assert.doesNotMatch(JSON.stringify(db.tables), /re_test_KEY/)
    const n = db.rows('ops_notifications')[0]!
    assert.deepEqual([n.status, n.provider_message_id, n.attempts], ['sent', 'msg-9', 1])
    assert.equal((await dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV })).pending_before, 0)
  })

  test('fără contacte: rămâne pending, încercarea neconsumată; apoi se trimite când apare un contact', async () => {
    const db = await pending({ alert_contacts: [] })
    const r = fakeResend([])
    const s = await dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV })
    assert.equal(s.waiting_for_contacts, 1)
    assert.deepEqual([db.rows('ops_notifications')[0]!.status, db.rows('ops_notifications')[0]!.attempts, db.rows('ops_notifications')[0]!.last_error], ['pending', 0, 'no_contacts'])
    db.rows('alert_contacts').push({ tenant_id: T1, email: 'nou@agentie.ro', active: true })
    assert.equal((await dispatchOpsNotifications({ db, fetch: fakeResend([]).fetch, env: ENV })).sent, 1)
  })

  test('erori tranzitorii: pending cu eroarea; a 5-a încercare: failed (vizibil); 4xx: definitiv', async () => {
    const db = await pending()
    const r = fakeResend([{ status: 429 }, { status: 503 }, new Error('ECONNRESET'), { status: 500 }, { status: 502 }])
    const out = []
    for (let i = 0; i < 5; i++) out.push(await dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV }))
    assert.deepEqual(out.map((o) => [o.retrying, o.failed]), [[1, 0], [1, 0], [1, 0], [1, 0], [0, 1]])
    assert.deepEqual([db.rows('ops_notifications')[0]!.status, db.rows('ops_notifications')[0]!.attempts], ['failed', 5])
    const db2 = await pending()
    assert.equal((await dispatchOpsNotifications({ db: db2, fetch: fakeResend([{ status: 422 }]).fetch, env: ENV })).failed, 1)
  })

  test('două dispatchere simultane: se trimite o singură dată', async () => {
    const db = await pending()
    const r = fakeResend([])
    await Promise.all([dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV }), dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV })])
    assert.equal(r.calls.length, 1)
  })

  test('contactele altui tenant nu primesc alerta', async () => {
    const db = await pending({ alert_contacts: [{ tenant_id: T2, email: 'alt@agentie.ro', active: true }] })
    const r = fakeResend([])
    assert.equal((await dispatchOpsNotifications({ db, fetch: r.fetch, env: ENV })).waiting_for_contacts, 1)
    assert.equal(r.calls.length, 0)
  })

  test('enqueue cu ID invalid: respins înainte de scriere', async () => {
    const db = new FakeDb()
    await assert.rejects(enqueueFailure(db, { ...run, sync_run_id: 'x&status=neq.sent' }))
    assert.equal(db.log.length, 0)
  })
})
