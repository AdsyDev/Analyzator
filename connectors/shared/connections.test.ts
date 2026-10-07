import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getSourceToken, loadActiveConnections, providerCallsToday, recordProviderCalls, utcDay } from './connections.ts'
import { FakeDb } from './test-helpers.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const B1 = '20000000-0000-0000-0000-000000000011'
const C1 = '50000000-0000-0000-0000-000000000031'
const base = { tenant_id: T1, provider: 'clarity', external_account_id: 'p', status: 'active' }

describe('loadActiveConnections', () => {
  test('separă conexiunile colectabile de cele sărite, cu motiv', async () => {
    const db = new FakeDb({
      source_connections: [
        { ...base, id: 'a', brand_id: B1, credential_status: 'valid' },
        { ...base, id: 'b', brand_id: B1, credential_status: 'unverified' },
        { ...base, id: 'c', brand_id: B1, credential_status: 'missing' },
        { ...base, id: 'd', brand_id: B1, credential_status: 'invalid' },
        { ...base, id: 'e', brand_id: null, credential_status: 'valid' },
        { ...base, id: 'f', brand_id: B1, credential_status: 'valid', status: 'archived' },
        { ...base, id: 'g', brand_id: B1, credential_status: 'valid', provider: 'ga4' },
      ],
    })
    const { connections, skipped } = await loadActiveConnections(db, 'clarity')
    assert.deepEqual(connections.map((c) => c.id), ['a', 'b'])
    assert.deepEqual(skipped.map((s) => s.id), ['c', 'd', 'e'])
    assert.match(skipped[0]!.reason, /fără token/)
    assert.match(skipped[1]!.reason, /invalid/)
  })
  test('nu selectează coloane de credențial (tokenul nu e în tabel oricum)', async () => {
    const db = new FakeDb({ source_connections: [] })
    await loadActiveConnections(db, 'clarity')
    assert.doesNotMatch(db.log[0]!.query!, /vault|token/)
  })
})

describe('getSourceToken', () => {
  test('apelează RPC-ul cu ID-ul conexiunii', async () => {
    const db = new FakeDb()
    db.rpcs.get_source_token = (args) => (args.p_connection_id === C1 ? 'tok' : null)
    assert.equal(await getSourceToken(db, C1), 'tok')
  })
  test('ID invalid: respins înainte de RPC', async () => {
    const db = new FakeDb()
    await assert.rejects(getSourceToken(db, 'x'))
    assert.equal(db.log.length, 0)
  })
  test('răspuns gol: eroare', async () => {
    const db = new FakeDb()
    db.rpcs.get_source_token = () => ''
    await assert.rejects(getSourceToken(db, C1), /indisponibil/)
  })
})

describe('provider_api_calls', () => {
  test('ziua UTC, nu Europe/Bucharest', () => {
    assert.equal(utcDay(new Date('2026-10-07T22:30:00Z')), '2026-10-07') // 01:30 pe 8 oct la București
  })
  test('suma apelurilor de azi pentru conexiune', async () => {
    const db = new FakeDb({
      provider_api_calls: [
        { source_connection_id: C1, call_date_utc: '2026-10-07', calls: 1 },
        { source_connection_id: C1, call_date_utc: '2026-10-07', calls: 4 },
        { source_connection_id: C1, call_date_utc: '2026-10-06', calls: 9 },
        { source_connection_id: 'alta', call_date_utc: '2026-10-07', calls: 9 },
      ],
    })
    assert.equal(await providerCallsToday(db, C1, '2026-10-07'), 5)
  })
  test('zero apeluri: nimic scris', async () => {
    const db = new FakeDb()
    await recordProviderCalls(db, {
      tenant_id: T1, brand_id: B1, source_connection_id: C1, call_date_utc: '2026-10-07', purpose: 'collect', calls: 0,
    })
    assert.equal(db.log.length, 0)
  })
})
