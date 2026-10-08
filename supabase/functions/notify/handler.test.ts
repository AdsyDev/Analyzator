import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { handle } from './handler.ts'
import { MemImportDb } from '../_shared/csv-import/test-db.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const env = { supabaseUrl: 'http://sb.test', serviceRoleKey: 'service-key', anonKey: 'anon-key', RESEND_API_KEY: 're_k', PV_FROM_EMAIL: 'pv@exemplu.ro' }

function setup(memberships: Record<string, Array<{ tenant_id: string; role: string }>>) {
  const db = new MemImportDb({
    pv_notifications: [
      { id: '80000000-0000-0000-0000-000000000001', tenant_id: T1, brand_id: B1, flag_id: '90000000-0000-0000-0000-000000000001', status: 'pending', attempts: 0, created_at: '1' },
      { id: '80000000-0000-0000-0000-000000000002', tenant_id: T2, brand_id: B2, flag_id: '90000000-0000-0000-0000-000000000002', status: 'pending', attempts: 0, created_at: '0' },
    ],
    pv_flags: [
      { id: '90000000-0000-0000-0000-000000000001', tenant_id: T1, brand_id: B1, entity_type: 'mention', entity_ref: 'm', link: null, text_snapshot: 't', snapshot_source: 'entity', flagged_by: '30000000-0000-0000-0000-000000000002', flagged_at: '2026-10-08T05:00:00Z' },
      { id: '90000000-0000-0000-0000-000000000002', tenant_id: T2, brand_id: B2, entity_type: 'mention', entity_ref: 'm', link: null, text_snapshot: 't', snapshot_source: 'entity', flagged_by: '30000000-0000-0000-0000-000000000011', flagged_at: '2026-10-08T05:00:00Z' },
    ],
    brands: [{ id: B1, tenant_id: T1, name: 'A' }, { id: B2, tenant_id: T2, name: 'Z' }],
    pv_contacts: [{ tenant_id: T1, email: 'a@x.ro', active: true }, { tenant_id: T2, email: 'z@x.ro', active: true }],
  })
  const sent: Array<Record<string, unknown>> = []
  const fetch = async (url: string, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? ''
    if (url === 'https://api.resend.com/emails') {
      sent.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ id: 'm' }), { status: 200 })
    }
    if (url.endsWith('/auth/v1/user')) {
      const jwt = auth.replace('Bearer ', '')
      return jwt in memberships ? new Response(JSON.stringify({ id: '30000000-0000-0000-0000-000000000002' })) : new Response('{}', { status: 401 })
    }
    if (url.includes('/rest/v1/memberships?')) {
      assert.equal((init.headers as Record<string, string>).apikey, 'anon-key', 'citire cu JWT de utilizator')
      return new Response(JSON.stringify(memberships[auth.replace('Bearer ', '')] ?? []))
    }
    throw new Error(`neașteptat: ${url}`)
  }
  const call = (jwt: string | null, body: unknown = { action: 'dispatch' }, method = 'POST') =>
    handle(new Request('http://fn/notify', { method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }),
      { env, fetch, now: () => new Date('2026-10-08T07:00:00Z'), db: db as never })
  return { db, sent, call }
}

describe('notify: autorizare', () => {
  test('fără JWT / JWT invalid: 401; GET: 405; acțiune necunoscută: 400', async () => {
    const s = setup({})
    assert.equal((await s.call(null)).status, 401)
    assert.equal((await s.call('necunoscut')).status, 401)
    assert.equal((await s.call('x', {}, 'GET')).status, 405)
    const t = setup({ jwt: [{ tenant_id: T1, role: 'strategist' }] })
    assert.equal((await t.call('jwt', { action: 'drop' })).status, 400)
    assert.equal(t.sent.length, 0)
  })
  test('client_viewer sau fără membership: 403, nimic trimis', async () => {
    for (const m of [[{ tenant_id: T1, role: 'client_viewer' }], []]) {
      const s = setup({ jwt: m })
      assert.equal((await s.call('jwt')).status, 403)
      assert.equal(s.sent.length, 0)
    }
  })
  test('agenția din T1 trimite doar notificările T1; T2 rămâne pending', async () => {
    const s = setup({ jwt: [{ tenant_id: T1, role: 'strategist' }] })
    const res = await s.call('jwt')
    assert.equal(res.status, 200)
    const body = (await res.json()) as Record<string, unknown>
    assert.equal(body.sent, 1)
    assert.deepEqual(s.sent.map((m) => m.to), [['a@x.ro']])
    assert.equal(s.db.rows('pv_notifications').find((n) => n.tenant_id === T2)!.status, 'pending')
  })
  test('fără secret: 200 cu starea secret_missing, notificările rămân pending', async () => {
    const s = setup({ jwt: [{ tenant_id: T1, role: 'agency_admin' }] })
    const res = await handle(new Request('http://fn/notify', { method: 'POST', headers: { Authorization: 'Bearer jwt' }, body: JSON.stringify({ action: 'dispatch' }) }),
      { env: { ...env, RESEND_API_KEY: undefined }, fetch: async (u) => (u.includes('memberships') ? new Response(JSON.stringify([{ tenant_id: T1, role: 'agency_admin' }])) : new Response(JSON.stringify({ id: '30000000-0000-0000-0000-000000000002' }))), now: () => new Date(), db: s.db as never })
    assert.equal(((await res.json()) as { state: string }).state, 'secret_missing')
    assert.ok(s.db.rows('pv_notifications').every((n) => n.status === 'pending'))
  })
})
