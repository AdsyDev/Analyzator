// Date SINTETICE, doar în acest fișier de test.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchPvNotifications, pvEmail } from './queue.ts'
import { sendEmail } from './resend.ts'
import { MemImportDb } from '../csv-import/test-db.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const U = '30000000-0000-0000-0000-000000000002'
const N1 = '80000000-0000-0000-0000-000000000001'
const N2 = '80000000-0000-0000-0000-000000000002'
const F1 = '90000000-0000-0000-0000-000000000001'
const F2 = '90000000-0000-0000-0000-000000000002'
const ENV = { RESEND_API_KEY: 're_test_KEY_DO_NOT_LOG', PV_FROM_EMAIL: 'Analyzator <pv@exemplu.ro>', APP_BASE_URL: 'https://app.exemplu.ro' }
const NOW = new Date('2026-10-08T07:00:00Z')

function seed(over: Record<string, Array<Record<string, unknown>>> = {}) {
  return new MemImportDb({
    pv_notifications: [
      { id: N1, tenant_id: T1, brand_id: B1, flag_id: F1, status: 'pending', attempts: 0, last_error: null, created_at: '2026-10-08T06:00:00Z' },
    ],
    pv_flags: [
      { id: F1, tenant_id: T1, brand_id: B1, entity_type: 'mention', entity_ref: 'm1', link: 'https://exemplu.ro/relatare', text_snapshot: 'Text '.repeat(200), snapshot_source: 'entity', flagged_by: U, flagged_at: '2026-10-08T05:00:00Z', status: 'open' },
    ],
    brands: [{ id: B1, tenant_id: T1, name: 'Brand A' }, { id: B2, tenant_id: T2, name: 'Brand Z' }],
    pv_contacts: [
      { tenant_id: T1, email: 'PV@agentie.ro', active: true },
      { tenant_id: T1, email: 'sef@agentie.ro', active: true },
      { tenant_id: T1, email: 'vechi@agentie.ro', active: false },
      { tenant_id: T2, email: 'alt-tenant@agentie.ro', active: true },
    ],
    pv_flag_events: [],
    ...over,
  })
}

type Call = { url: string; init: RequestInit; body: Record<string, unknown> }
function fakeResend(responses: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = []
  const queue = [...responses]
  const fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, body: JSON.parse(String(init.body ?? '{}')) })
    const next = queue.shift() ?? { status: 200, body: { id: 'msg-default' } }
    if (next instanceof Error) throw next
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status })
  }
  return { fetch, calls }
}

const OK = { status: 200, body: { id: 'msg-1' } }
const run = (db: MemImportDb, r: ReturnType<typeof fakeResend>, over: Partial<Parameters<typeof dispatchPvNotifications>[0]> = {}) =>
  dispatchPvNotifications({ db, fetch: r.fetch, env: ENV, now: () => NOW, ...over })

describe('fără secret sau expeditor: nimic nu se pierde', () => {
  test('RESEND_API_KEY lipsește: niciun apel, notificarea rămâne pending, încercările neschimbate', async () => {
    const db = seed()
    const r = fakeResend([OK])
    const s = await run(db, r, { env: { PV_FROM_EMAIL: ENV.PV_FROM_EMAIL } })
    assert.deepEqual([s.state, s.pending_before, s.sent], ['secret_missing', 1, 0])
    assert.equal(r.calls.length, 0)
    const n = db.rows('pv_notifications')[0]!
    assert.deepEqual([n.status, n.attempts, n.last_error], ['pending', 0, null])
    assert.equal(db.rows('pv_flag_events').length, 0)
  })
  test('expeditor lipsă: la fel', async () => {
    const db = seed()
    const r = fakeResend([OK])
    const s = await run(db, r, { env: { RESEND_API_KEY: ENV.RESEND_API_KEY } })
    assert.equal(s.state, 'sender_missing')
    assert.equal(r.calls.length, 0)
    assert.equal(db.rows('pv_notifications')[0]!.status, 'pending')
  })
  test('secretul apare mai târziu: aceeași notificare se trimite', async () => {
    const db = seed()
    await run(db, fakeResend([OK]), { env: {} })
    const r = fakeResend([OK])
    const s = await run(db, r)
    assert.equal(s.sent, 1)
    assert.equal(db.rows('pv_notifications')[0]!.status, 'sent')
  })
})

describe('trimitere', () => {
  test('un e-mail către toate contactele active ale tenantului; Idempotency-Key; cheia doar în Authorization', async () => {
    const db = seed()
    const r = fakeResend([OK])
    const s = await run(db, r)
    assert.deepEqual([s.state, s.sent, s.failed, s.retrying], ['ok', 1, 0, 0])
    assert.equal(r.calls.length, 1)
    const c = r.calls[0]!
    assert.equal(c.url, 'https://api.resend.com/emails')
    const h = c.init.headers as Record<string, string>
    assert.equal(h.Authorization, `Bearer ${ENV.RESEND_API_KEY}`)
    assert.equal(h['Idempotency-Key'], `pv-notification-${N1}`)
    assert.deepEqual(c.body.to, ['pv@agentie.ro', 'sef@agentie.ro'], 'contacte active din tenantul brandului; fără inactive și fără alt tenant')
    assert.equal(c.body.from, ENV.PV_FROM_EMAIL)
    assert.doesNotMatch(JSON.stringify(c.body), /re_test_KEY/)
    const n = db.rows('pv_notifications')[0]!
    assert.deepEqual([n.status, n.attempts, n.provider_message_id, n.last_error], ['sent', 1, 'msg-1', null])
    assert.deepEqual(n.recipients, ['pv@agentie.ro', 'sef@agentie.ro'])
    assert.ok(n.sent_at)
    assert.deepEqual(db.rows('pv_flag_events').map((e) => e.event_type), ['notification_sent'])
  })

  test('conținutul e-mailului: brand, link, utilizator, fragment trunchiat, disclaimer', () => {
    const flag = seed().rows('pv_flags')[0] as never
    const m = pvEmail('Brand A', flag, 'https://app.exemplu.ro/')
    assert.match(m.subject, /Farmacovigilență.*Brand A/)
    assert.match(m.text, /Link: https:\/\/exemplu\.ro\/relatare/)
    assert.match(m.text, new RegExp(U))
    assert.match(m.text, /text trunchiat/)
    assert.ok(m.text.length < 2000)
    assert.match(m.text, /nu stabilește dacă este o reacție adversă/)
    assert.match(m.text, /preluat din înregistrare/)
  })

  test('rulare repetată după trimitere: nu retrimite (status sent)', async () => {
    const db = seed()
    const r = fakeResend([OK, OK])
    await run(db, r)
    const s2 = await run(db, r)
    assert.equal(s2.pending_before, 0)
    assert.equal(r.calls.length, 1)
  })

  test('două dispatchere simultane: doar unul revendică și trimite', async () => {
    const db = seed()
    const r = fakeResend([OK, OK])
    await Promise.all([run(db, r), run(db, r)])
    assert.equal(r.calls.length, 1)
    assert.equal(db.rows('pv_notifications')[0]!.attempts, 1)
  })
})

describe('contacte', () => {
  test('fără contacte active: rămâne pending, încercarea nu se consumă, evenimentul no_contacts o singură dată', async () => {
    const db = seed({ pv_contacts: [{ tenant_id: T1, email: 'x@agentie.ro', active: false }] })
    const r = fakeResend([OK])
    const s1 = await run(db, r)
    const s2 = await run(db, r)
    assert.equal(s1.waiting_for_contacts, 1)
    assert.equal(s2.waiting_for_contacts, 1)
    assert.equal(r.calls.length, 0)
    const n = db.rows('pv_notifications')[0]!
    assert.deepEqual([n.status, n.attempts, n.last_error], ['pending', 0, 'no_contacts'])
    assert.deepEqual(db.rows('pv_flag_events').map((e) => e.event_type), ['no_contacts'])
  })
  test('după ce apare un contact, notificarea (rămasă pending) se trimite', async () => {
    const db = seed({ pv_contacts: [] })
    const r = fakeResend([OK])
    await run(db, r)
    db.rows('pv_contacts').push({ tenant_id: T1, email: 'nou@agentie.ro', active: true })
    const s = await run(db, r)
    assert.equal(s.sent, 1)
    assert.deepEqual(r.calls[0]!.body.to, ['nou@agentie.ro'])
  })
  test('contactele altui tenant nu primesc niciodată', async () => {
    const db = seed({ pv_contacts: [{ tenant_id: T2, email: 'alt@agentie.ro', active: true }] })
    const r = fakeResend([OK])
    const s = await run(db, r)
    assert.equal(s.waiting_for_contacts, 1)
    assert.equal(r.calls.length, 0)
  })
})

describe('erori și reîncercări', () => {
  test('429 / 5xx / rețea: rămâne pending cu eroarea notată; la a 5-a încercare devine failed (vizibil)', async () => {
    const db = seed()
    const errors = [{ status: 429 }, { status: 503 }, new Error('ECONNRESET'), { status: 500 }, { status: 502 }]
    const r = fakeResend(errors)
    const results = []
    for (let i = 0; i < 5; i++) results.push(await run(db, r))
    assert.deepEqual(results.map((x) => [x.retrying, x.failed]), [[1, 0], [1, 0], [1, 0], [1, 0], [0, 1]])
    const n = db.rows('pv_notifications')[0]!
    assert.deepEqual([n.status, n.attempts], ['failed', 5])
    assert.match(String(n.last_error), /502/)
    assert.equal(db.rows('pv_flag_events').filter((e) => e.event_type === 'notification_failed').length, 5)
    assert.equal((await run(db, r)).pending_before, 0, 'failed nu se mai reîncearcă singur')
  })
  test('401 / 422: definitiv de la prima încercare', async () => {
    for (const status of [401, 403, 422, 400]) {
      const db = seed()
      const s = await run(db, fakeResend([{ status }]))
      assert.equal(s.failed, 1, String(status))
      assert.equal(db.rows('pv_notifications')[0]!.status, 'failed')
    }
  })
  test('eroare după revendicare (de ex. marcaj lipsă): revine în coadă, nu rămâne blocată în sending', async () => {
    const db = seed({ pv_flags: [] })
    const s = await run(db, fakeResend([OK]))
    assert.equal(s.retrying, 1)
    const n = db.rows('pv_notifications')[0]!
    assert.equal(n.status, 'pending')
    assert.match(String(n.last_error), /marcaj inexistent/)
  })
  test('cheia API nu apare în erori, în evenimente sau în coadă', async () => {
    const db = seed()
    await run(db, fakeResend([{ status: 500, body: { message: 'contains re_test_KEY_DO_NOT_LOG' } }]))
    assert.doesNotMatch(JSON.stringify(db.tables), /re_test_KEY/)
  })
})

describe('izolare', () => {
  test('tenantIds: un apel de utilizator trimite doar notificările tenanților lui', async () => {
    const db = seed({
      pv_notifications: [
        { id: N1, tenant_id: T1, brand_id: B1, flag_id: F1, status: 'pending', attempts: 0, last_error: null, created_at: '2026-10-08T06:00:00Z' },
        { id: N2, tenant_id: T2, brand_id: B2, flag_id: F2, status: 'pending', attempts: 0, last_error: null, created_at: '2026-10-08T05:00:00Z' },
      ],
      pv_flags: [
        { id: F1, tenant_id: T1, brand_id: B1, entity_type: 'mention', entity_ref: 'm1', link: null, text_snapshot: 't1', snapshot_source: 'entity', flagged_by: U, flagged_at: '2026-10-08T05:00:00Z' },
        { id: F2, tenant_id: T2, brand_id: B2, entity_type: 'mention', entity_ref: 'm2', link: null, text_snapshot: 't2', snapshot_source: 'entity', flagged_by: U, flagged_at: '2026-10-08T05:00:00Z' },
      ],
    })
    const r = fakeResend([OK, OK])
    const s = await run(db, r, { tenantIds: [T1], batchLimit: 1 })
    assert.equal(s.sent, 1, 'T2 e mai veche, dar nu consumă lotul lui T1')
    assert.equal(db.rows('pv_notifications').find((n) => n.id === N2)!.status, 'pending')
    assert.equal(db.rows('pv_notifications').find((n) => n.id === N1)!.status, 'sent')
  })
  test('tenantIds invalid sau gol: nimic de trimis / eroare', async () => {
    const db = seed()
    assert.deepEqual((await run(db, fakeResend([OK]), { tenantIds: [] })).pending_before, 0)
    await assert.rejects(run(db, fakeResend([OK]), { tenantIds: ['x&status=neq.sent'] }), /ID invalid/)
  })
  test('marcajul se caută cu tenant și brand din notificare', async () => {
    const db = seed()
    await run(db, fakeResend([OK]))
    const flagQuery = db.log.find((l) => l.table === 'pv_flags')!.query!
    assert.match(flagQuery, new RegExp(`tenant_id=eq.${T1}`))
    assert.match(flagQuery, new RegExp(`brand_id=eq.${B1}`))
  })
})

describe('sendEmail', () => {
  test('validări locale: fără destinatari, peste 50, cheie de idempotență prea lungă', async () => {
    const f = fakeResend([OK]).fetch
    const base = { from: 'a@b.ro', subject: 's', text: 't', idempotencyKey: 'k' }
    assert.equal((await sendEmail(f, 'k', { ...base, to: [] })).ok, false)
    assert.equal((await sendEmail(f, 'k', { ...base, to: Array(51).fill('x@y.ro') })).ok, false)
    assert.equal((await sendEmail(f, 'k', { ...base, to: ['x@y.ro'], idempotencyKey: 'x'.repeat(257) })).ok, false)
  })
  test('răspuns de succes fără id: ok cu id null', async () => {
    const r = await sendEmail(async () => new Response('nu-json', { status: 200 }), 'k', { from: 'a@b.ro', to: ['x@y.ro'], subject: 's', text: 't', idempotencyKey: 'k' })
    assert.deepEqual(r, { ok: true, id: null })
  })
})
