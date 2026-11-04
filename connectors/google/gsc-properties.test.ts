import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGscProperty,
  belongsToDomain,
  estimateHistoryRows,
  importArchivedHistory,
  inspectGscProperties,
  planArchivedHistory,
  propertyHost,
  type ListGscSites,
} from './gsc-properties-core.ts'
import type { GoogleClients, GscClient } from './clients.ts'
import { addDaysIso } from './dates.ts'
import { FakeDb } from '../shared/test-helpers.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const CRED = '50000000-0000-0000-0000-0000000000c1'
const B = {
  urinal: '20000000-0000-0000-0000-000000000101',
  keep: '20000000-0000-0000-0000-000000000102',
  noaccess: '20000000-0000-0000-0000-000000000103',
  fresh: '20000000-0000-0000-0000-000000000104',
  mismatch: '20000000-0000-0000-0000-000000000105',
  nodomain: '20000000-0000-0000-0000-000000000106',
  multi: '20000000-0000-0000-0000-000000000107',
  archived: '20000000-0000-0000-0000-000000000108',
  t2: '20000000-0000-0000-0000-000000000201',
}
const C = {
  urinal: '50000000-0000-0000-0000-000000000101',
  keep: '50000000-0000-0000-0000-000000000102',
  noaccess: '50000000-0000-0000-0000-000000000103',
  mismatch: '50000000-0000-0000-0000-000000000105',
  multiA: '50000000-0000-0000-0000-000000000107',
  multiB: '50000000-0000-0000-0000-000000000117',
  t2: '50000000-0000-0000-0000-000000000201',
}
const KEY = JSON.stringify({ type: 'service_account', client_email: 'reader@proj.iam.gserviceaccount.com', private_key: 'PRIVATE-KEY-DO-NOT-LOG' })
const VISIBLE = ['sc-domain:urinal.ro', 'https://urinal.ro/', 'sc-domain:keep.ro', 'https://www.noaccess.ro/', 'sc-domain:fresh.ro', 'https://other.ro/', 'sc-domain:multi.ro', 'sc-domain:elsewhere.ro']

const gsc = (id: string, brand: string, site: string, status = 'active', tenant = T1) =>
  ({ id, tenant_id: tenant, brand_id: brand, provider: 'gsc', external_account_id: site, display_name: site, status, credential_status: 'missing', timezone: 'Europe/Bucharest' })

function makeDb() {
  const db = new FakeDb({
    tenants: [{ id: T1, name: 'STADA România' }, { id: T2, name: 'Alt client' }],
    brands: [
      { id: B.urinal, tenant_id: T1, name: 'Urinal', domain: 'urinal.ro', status: 'active' },
      { id: B.keep, tenant_id: T1, name: 'Keep', domain: 'keep.ro', status: 'active' },
      { id: B.noaccess, tenant_id: T1, name: 'NoAccess', domain: 'noaccess.ro', status: 'active' },
      { id: B.fresh, tenant_id: T1, name: 'Fresh', domain: 'fresh.ro', status: 'active' },
      { id: B.mismatch, tenant_id: T1, name: 'Mismatch', domain: 'mis.ro', status: 'active' },
      { id: B.nodomain, tenant_id: T1, name: 'NoDomain', domain: null, status: 'active' },
      { id: B.multi, tenant_id: T1, name: 'Multi', domain: 'multi.ro', status: 'active' },
      { id: B.archived, tenant_id: T1, name: 'Arhivat', domain: 'arhivat.ro', status: 'archived' },
      { id: B.t2, tenant_id: T2, name: 'T2', domain: 't2.ro', status: 'active' },
    ],
    source_connections: [
      { id: CRED, tenant_id: T1, brand_id: null, provider: 'google_service_account', external_account_id: 'sa', status: 'active', credential_status: 'valid', timezone: 'Europe/Bucharest' },
      { ...gsc(C.urinal, B.urinal, 'https://urinal.ro/'), timezone: 'Europe/London' },
      gsc(C.keep, B.keep, 'sc-domain:keep.ro'),
      gsc(C.noaccess, B.noaccess, 'https://www.noaccess.ro/'),
      gsc(C.mismatch, B.mismatch, 'https://other.ro/'),
      gsc(C.multiA, B.multi, 'https://multi.ro/'),
      gsc(C.multiB, B.multi, 'sc-domain:multi.ro'),
      gsc(C.t2, B.t2, 'https://t2.ro/', 'active', T2),
    ],
    sync_runs: [
      { tenant_id: T1, brand_id: B.urinal, source: 'gsc', rows_written: 100, created_at: '2026-10-27T11:00:00Z', status: 'succeeded' },
      { tenant_id: T1, brand_id: B.urinal, source: 'gsc', rows_written: 17725, created_at: '2026-11-03T11:29:00Z', status: 'succeeded' },
    ],
    search_daily: [{ id: 1, tenant_id: T1, brand_id: B.urinal, date: '2026-10-01', device: 'MOBILE', source_id: C.urinal }],
    search_queries: [],
  })
  db.rpcs.get_source_token = (args) => {
    if (args.p_connection_id !== CRED) throw new Error('Conexiune inexistentă, inactivă sau fără token')
    return KEY
  }
  return db
}

function fakeList(sites: string[] | { fail: string } = VISIBLE) {
  const calls: string[] = []
  const listSites: ListGscSites = async (raw) => {
    calls.push(raw)
    if (!Array.isArray(sites)) return { ok: false, reason: 'api_disabled', status: 403, message: sites.fail }
    return { ok: true, truncated: false, accounts: sites.map((id) => ({ id, name: id, detail: id.startsWith('sc-domain:') ? 'Domain property' : 'URL prefix' })) }
  }
  return { listSites, calls }
}

const NOW = () => new Date('2026-11-04T01:00:00Z')
const writes = (db: FakeDb) => db.log.filter((l) => l.op === 'insert' || l.op === 'update' || l.op === 'upsert')

describe('Search Console: verificarea proprietăților (D-27)', () => {
  test('acțiunea pe fiecare site activ, fără nicio scriere; o singură listare per client', async () => {
    const db = makeDb()
    const f = fakeList()
    const reports = await inspectGscProperties({ db, listSites: f.listSites, now: NOW })
    const action = Object.fromEntries(reports.map((r) => [r.brand_name, r.action]))
    assert.deepEqual(action, {
      Urinal: 'switch', Keep: 'keep', NoAccess: 'no_domain_access', Fresh: 'connect', Mismatch: 'mismatch', NoDomain: 'no_domain', Multi: 'multiple', T2: 'no_credential',
    })
    assert.equal(reports.some((r) => r.brand_id === B.archived), false, 'site-urile arhivate nu intră')
    assert.equal(f.calls.length, 1, 'aceeași cheie pentru toate site-urile clientului')
    assert.deepEqual(writes(db), [])
    const urinal = reports.find((r) => r.brand_id === B.urinal)!
    assert.deepEqual(urinal.visible, ['sc-domain:urinal.ro', 'https://urinal.ro/'])
    assert.equal(urinal.target, 'sc-domain:urinal.ro')
    assert.equal(urinal.last_run_rows, 17725, 'ultima rulare, nu prima')
    assert.doesNotMatch(JSON.stringify(reports), /PRIVATE-KEY-DO-NOT-LOG/)
  })

  test('listarea refuzată de Google: list_failed cu mesajul, nu excepție', async () => {
    const db = makeDb()
    const reports = await inspectGscProperties({ db, listSites: fakeList({ fail: 'Google Search Console API nu e activat' }).listSites, now: NOW })
    assert.ok(reports.filter((r) => r.tenant_id === T1).every((r) => r.action === 'list_failed' && /nu e activat/.test(r.note)))
    assert.equal(reports.find((r) => r.tenant_id === T2)!.action, 'no_credential')
  })

  test('doar un client', async () => {
    const reports = await inspectGscProperties({ db: makeDb(), listSites: fakeList().listSites, now: NOW }, { tenantId: T2 })
    assert.deepEqual(reports.map((r) => r.brand_id), [B.t2])
  })

  test('estimarea pe 16 luni și potrivirea pe domeniu', () => {
    const e = estimateHistoryRows(17725)!
    assert.ok(e > 240_000 && e < 250_000, String(e))
    assert.equal(estimateHistoryRows(null), null)
    assert.equal(propertyHost('sc-domain:Urinal.ro'), 'urinal.ro')
    assert.equal(propertyHost('https://www.urinal.ro/'), 'www.urinal.ro')
    assert.equal(propertyHost('ftp://urinal.ro/'), null)
    assert.ok(belongsToDomain('https://www.urinal.ro/', 'urinal.ro'))
    assert.ok(!belongsToDomain('https://noturinal.ro/', 'urinal.ro'))
  })
})

describe('Search Console: trecerea pe Domain property (D-27)', () => {
  const reportFor = async (db: FakeDb, brand: string, sites?: string[]) =>
    (await inspectGscProperties({ db, listSites: fakeList(sites).listSites, now: NOW })).find((r) => r.brand_id === brand)!

  test('URL prefix → Domain property: veche arhivată, nouă activă cu același fus; a doua oară nu mai schimbă nimic', async () => {
    const db = makeDb()
    const result = await applyGscProperty(db, await reportFor(db, B.urinal))
    assert.equal(result.action, 'switched')
    assert.equal(result.previous, 'https://urinal.ro/')
    const rows = db.tables.source_connections!.filter((c) => c.brand_id === B.urinal)
    assert.deepEqual(rows.map((c) => [c.external_account_id, c.status]), [['https://urinal.ro/', 'archived'], ['sc-domain:urinal.ro', 'active']])
    const created = rows[1]!
    assert.deepEqual([created.tenant_id, created.provider, created.display_name, created.timezone], [T1, 'gsc', 'sc-domain:urinal.ro', 'Europe/London'])
    // Scrierea veche a filtrat pe tenant, brand și provider.
    const archive = db.log.find((l) => l.op === 'update')!
    assert.match(archive.query!, new RegExp(`id=eq.${C.urinal}&tenant_id=eq.${T1}&brand_id=eq.${B.urinal}&provider=eq.gsc&status=eq.active`))

    const again = await reportFor(db, B.urinal)
    assert.equal(again.action, 'keep')
    assert.equal(again.archived_count, 1)
    assert.equal(again.old_property_rows, true, 'rândul din search_daily e încă al proprietății vechi')
    db.tables.search_daily![0]!.source_id = created.id
    assert.equal((await reportFor(db, B.urinal)).old_property_rows, false)
    const before = writes(db).length
    assert.equal((await applyGscProperty(db, again)).action, 'kept')
    assert.equal(writes(db).length, before)
  })

  test('fără conexiune: se adaugă Domain property', async () => {
    const db = makeDb()
    const result = await applyGscProperty(db, await reportFor(db, B.fresh))
    assert.equal(result.action, 'connected')
    const row = db.tables.source_connections!.find((c) => c.brand_id === B.fresh)!
    assert.deepEqual([row.external_account_id, row.status, row.tenant_id, 'timezone' in row], ['sc-domain:fresh.ro', 'active', T1, false])
  })

  test('proprietatea nouă există arhivată pe același site: se reactivează, nu se dublează', async () => {
    const db = makeDb()
    db.tables.source_connections!.push(gsc('50000000-0000-0000-0000-000000000301', B.urinal, 'sc-domain:urinal.ro', 'archived'))
    const result = await applyGscProperty(db, await reportFor(db, B.urinal))
    assert.equal(result.connection_id, '50000000-0000-0000-0000-000000000301')
    assert.equal(db.log.filter((l) => l.op === 'insert').length, 0)
    assert.deepEqual(db.tables.source_connections!.filter((c) => c.brand_id === B.urinal && c.status === 'active').map((c) => c.external_account_id), ['sc-domain:urinal.ro'])
  })

  test('site nepregătit (fără acces, alt domeniu, două proprietăți, fără cheie): refuz fără scrieri', async () => {
    const db = makeDb()
    for (const brand of [B.noaccess, B.mismatch, B.multi, B.nodomain, B.t2]) {
      await assert.rejects(applyGscProperty(db, await reportFor(db, brand)), /nu trec automat/)
    }
    assert.deepEqual(writes(db), [])
  })

  test('proprietatea nouă e deja legată de alt site al clientului: refuz înainte de orice scriere', async () => {
    const db = makeDb()
    db.tables.source_connections!.push(gsc('50000000-0000-0000-0000-000000000302', B.keep, 'sc-domain:urinal.ro', 'archived'))
    await assert.rejects(applyGscProperty(db, await reportFor(db, B.urinal)), /alt site/)
    assert.deepEqual(writes(db), [])
  })

  test('adăugarea eșuează: conexiunea veche revine activă, eroarea urcă', async () => {
    const db = makeDb()
    const report = await reportFor(db, B.urinal)
    db.insert = async () => {
      throw new Error('insert refuzat')
    }
    await assert.rejects(applyGscProperty(db, report), /insert refuzat/)
    assert.deepEqual(db.tables.source_connections!.filter((c) => c.brand_id === B.urinal).map((c) => [c.external_account_id, c.status]), [['https://urinal.ro/', 'active']])
  })

  test('conexiunea veche nu mai e activă între verificare și trecere: nu se schimbă nimic', async () => {
    const db = makeDb()
    const report = await reportFor(db, B.urinal)
    db.tables.source_connections!.find((c) => c.id === C.urinal)!.status = 'archived'
    await assert.rejects(applyGscProperty(db, report), /nu mai e activă/)
    assert.equal(db.log.filter((l) => l.op === 'insert').length, 0)
  })
})

describe('Search Console: istoricul vechi din proprietatea URL prefix arhivată (D-27)', () => {
  const DOMAIN_START = '2026-10-10'
  const day = (date: string, source: string) => ({ tenant_id: T1, brand_id: B.urinal, date, device: 'MOBILE', source_id: source })
  const reportFor = async (db: FakeDb, brand: string, sites?: string[]) =>
    (await inspectGscProperties({ db, listSites: fakeList(sites).listSites, now: NOW })).find((r) => r.brand_id === brand)!

  /** Urinal trecut pe Domain property: zilele vechi de la URL prefix, cele noi de la Domain property. */
  async function switchedDb() {
    const db = makeDb()
    const switched = await applyGscProperty(db, await reportFor(db, B.urinal))
    db.tables.search_daily = [day('2026-09-01', C.urinal), day('2026-10-09', C.urinal), day(DOMAIN_START, switched.connection_id), day('2026-10-31', switched.connection_id)]
    db.tables.search_queries = []
    return { db, current: switched.connection_id }
  }

  /** Search Console simulat: câte un rând pe zi din intervalul cerut; Domain property are date abia de la DOMAIN_START. */
  function rangeClients() {
    const calls: Array<{ site: string; range: string }> = []
    const gs: GscClient = {
      async query(req) {
        calls.push({ site: req.siteUrl, range: `${req.startDate}..${req.endDate}` })
        if (req.startRow > 0) return { rows: [] }
        const first = req.siteUrl.startsWith('sc-domain:') ? DOMAIN_START : '0000-01-01'
        const days: string[] = []
        for (let d = req.startDate; d <= req.endDate; d = addDaysIso(d, 1)) if (d >= first) days.push(d)
        const m = { clicks: 1, impressions: 5, ctr: 0.2, position: 4 }
        const dims = req.dimensions.join(',')
        if (dims === 'date,device') return { rows: days.map((d) => ({ keys: [d, 'MOBILE'], ...m })) }
        if (dims === 'date') return { rows: days.map((d) => ({ keys: [d], ...m })) }
        return { rows: days.map((d) => ({ keys: [d, 'urinal', 'https://urinal.ro/produs', 'MOBILE'], ...m })) }
      },
    }
    const unused = async () => {
      throw new Error('GA4 nu se folosește aici')
    }
    return { clients: { ga4: { checkCompatibility: unused, runReport: unused }, gsc: gs } as GoogleClients, calls }
  }

  test('verificarea arată zilele fiecărei proprietăți și zilele amestecate', async () => {
    const { db } = await switchedDb()
    const r = await reportFor(db, B.urinal)
    assert.equal(r.action, 'keep')
    assert.deepEqual(r.archived, [{ connection_id: C.urinal, site_url: 'https://urinal.ro/' }])
    assert.deepEqual(r.days_current, { first: DOMAIN_START, last: '2026-10-31' })
    assert.deepEqual(r.days_archived, { first: '2026-09-01', last: '2026-10-09' })
    assert.equal(r.archived_rows_since_current, false, 'zilele dinaintea Domain property nu sunt amestec')
    // Un rând query × pagină al proprietății vechi într-o zi a proprietății noi: amestec.
    db.tables.search_queries!.push({ id: 99, tenant_id: T1, brand_id: B.urinal, date: '2026-10-15', device: 'MOBILE', source_id: C.urinal })
    assert.equal((await reportFor(db, B.urinal)).archived_rows_since_current, true)
    assert.deepEqual(writes(db).filter((w) => w.table !== 'source_connections'), [])
  })

  test('planul: zilele de la `from` până în ziua dinaintea Domain property, din singura proprietate URL prefix arhivată', async () => {
    const { db, current } = await switchedDb()
    assert.deepEqual(planArchivedHistory(await reportFor(db, B.urinal), '2025-07-04'), {
      tenant_id: T1,
      brand_id: B.urinal,
      brand_name: 'Urinal',
      current: { connection_id: current, site_url: 'sc-domain:urinal.ro', first_day: DOMAIN_START },
      source: { connection_id: C.urinal, site_url: 'https://urinal.ro/' },
      from: '2025-07-04',
      until: '2026-10-09',
    })
  })

  test('site nepregătit: refuz cu motivul, înainte de orice scriere', async () => {
    // Încă pe URL prefix.
    const fresh = makeDb()
    await assert.rejects(async () => planArchivedHistory(await reportFor(fresh, B.urinal), '2025-07-04'), /întâi --apply/)
    // Domain property fără date: nu se știe ziua de trecere.
    const empty = await switchedDb()
    empty.db.tables.search_daily = empty.db.tables.search_daily!.filter((r) => r.source_id !== empty.current)
    await assert.rejects(async () => planArchivedHistory(await reportFor(empty.db, B.urinal), '2025-07-04'), /nu are încă date/)
    // Fără proprietate URL prefix arhivată (Keep a fost mereu pe Domain property).
    const keep = makeDb()
    keep.tables.search_daily!.push({ id: 2, tenant_id: T1, brand_id: B.keep, date: '2026-10-01', device: 'MOBILE', source_id: C.keep })
    await assert.rejects(async () => planArchivedHistory(await reportFor(keep, B.keep), '2025-07-04'), /nicio proprietate URL prefix arhivată/)
    // Două proprietăți URL prefix arhivate: de ales manual.
    const two = await switchedDb()
    two.db.tables.source_connections!.push(gsc('50000000-0000-0000-0000-000000000401', B.urinal, 'https://www.urinal.ro/', 'archived'))
    await assert.rejects(async () => planArchivedHistory(await reportFor(two.db, B.urinal), '2025-07-04'), /mai multe proprietăți URL prefix arhivate/)
    // Clientul a scos accesul pe URL prefix.
    const gone = await switchedDb()
    await assert.rejects(async () => planArchivedHistory(await reportFor(gone.db, B.urinal, ['sc-domain:urinal.ro']), '2025-07-04'), /nu mai vede https:\/\/urinal.ro\//)
    await assert.rejects(async () => planArchivedHistory(await reportFor(gone.db, B.urinal), '2025-7-4'), /YYYY-MM-DD/)
    for (const d of [fresh, empty.db, keep, two.db, gone.db]) assert.deepEqual(writes(d).filter((w) => w.table !== 'source_connections'), [])
  })

  test('importul: zilele vechi din URL prefix, apoi fereastra obișnuită pe Domain property; nicio zi nu se amestecă', async () => {
    const { db, current } = await switchedDb()
    const plan = planArchivedHistory(await reportFor(db, B.urinal), '2026-08-01')
    const f = rangeClients()
    const { history, regular } = await importArchivedHistory({ db, createClients: () => f.clients, now: NOW, sleep: async () => undefined }, plan)

    assert.deepEqual(history.map((o) => [o.connection_id, o.status === 'not_connected' ? null : `${o.period.start}..${o.period.end}`, o.status]), [
      [C.urinal, '2026-08-01..2026-09-04', 'succeeded'],
      [C.urinal, '2026-09-05..2026-10-09', 'succeeded'],
    ])
    assert.deepEqual(regular.map((o) => [o.connection_id, o.status === 'not_connected' ? null : `${o.period.start}..${o.period.end}`]), [[current, '2026-09-27..2026-10-31']])
    // Cererile: zilele vechi doar la URL prefix, fereastra obișnuită doar la Domain property.
    assert.ok(f.calls.filter((c) => c.site === 'https://urinal.ro/').every((c) => c.range <= '2026-10-09'))
    assert.ok(f.calls.filter((c) => c.site === 'sc-domain:urinal.ro').every((c) => c.range === '2026-09-27..2026-10-31'))
    // Fiecare zi are o singură proprietate: URL prefix înainte de DOMAIN_START, Domain property de atunci încolo.
    for (const table of ['search_daily', 'search_queries']) {
      const rows = db.tables[table]!.filter((r) => r.brand_id === B.urinal)
      assert.ok(rows.length > 0, table)
      for (const r of rows) assert.equal(r.source_id, (r.date as string) < DOMAIN_START ? C.urinal : current, `${table} ${r.date}`)
    }
    // Ultima rulare (după care se citește starea sursei) e fereastra obișnuită, pe Domain property.
    const runs = db.tables.sync_runs!.filter((r) => r.brand_id === B.urinal && r.source === 'gsc' && r.period_start)
    assert.deepEqual([runs[runs.length - 1]!.source_connection_id, runs[runs.length - 1]!.period_start], [current, '2026-09-27'])

    const after = await reportFor(db, B.urinal)
    assert.deepEqual(after.days_archived, { first: '2026-08-01', last: '2026-10-09' })
    assert.deepEqual(after.days_current, { first: DOMAIN_START, last: '2026-10-31' })
    assert.equal(after.archived_rows_since_current, false)
    assert.equal(after.action, 'keep')
  })

  test('nimic de importat (Domain property începe la `from` sau înainte): nicio rulare, niciun apel', async () => {
    const { db } = await switchedDb()
    const plan = planArchivedHistory(await reportFor(db, B.urinal), DOMAIN_START)
    const f = rangeClients()
    assert.deepEqual(await importArchivedHistory({ db, createClients: () => f.clients, now: NOW }, plan), { history: [], regular: [] })
    assert.equal(f.calls.length, 0)
  })
})
