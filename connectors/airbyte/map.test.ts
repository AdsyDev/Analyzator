import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PgSession, PgTarget } from '../../supabase/functions/airbyte/inspect.ts'
import { FakeDb } from '../shared/test-helpers.ts'
import { mapAirbyte } from './map-core.ts'

const T = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const KEY = 'c0000000-0000-4000-8000-000000000001'
const PRO = 'b1111111-1111-4111-8111-111111111111'
const AFL = 'b2222222-2222-4222-8222-222222222222'
const GEL = 'b3333333-3333-4333-8333-333333333333'

const cols = (table: string, c: Array<[string, string]>) => c.map(([column, data_type]) => ({ schema: 'public', table, column, data_type }))
const COLUMNS = [
  ...cols('ads_insights', [['account_id', 'text'], ['account_name', 'text'], ['date_start', 'date'], ['spend', 'numeric']]),
  ...cols('customer', [['customer_id', 'bigint'], ['customer_descriptive_name', 'text']]),
]
const acct = (account_id: string, name: string) => ({ account_id, name, rows: '10', first_date: '2026-04-01', last_date: '2026-09-18', last_synced_at: null })

function setup(existing: Array<Record<string, unknown>> = []) {
  const db = new FakeDb({
    tenants: [{ id: T, name: 'STADA România' }, { id: T2, name: 'Alt client' }],
    brands: [
      { id: PRO, tenant_id: T, name: 'Proenzi', domain: 'proenzi.ro', status: 'active' },
      { id: AFL, tenant_id: T, name: 'Aflamin', domain: 'aflamin.ro', status: 'active' },
      { id: GEL, tenant_id: T, name: 'Aflamin Gel', domain: null, status: 'active' },
      { id: 'b9999999-9999-4999-8999-999999999999', tenant_id: T2, name: 'Proenzi', domain: null, status: 'active' },
    ],
    source_connections: [{ id: KEY, tenant_id: T, brand_id: null, provider: 'airbyte_postgres', external_account_id: 'Airbyte', status: 'active', credential_status: 'valid' }, ...existing],
  })
  db.rpcs.get_source_token = () => 'postgresql://ro:p@airbyte.exemplu.ro:5498/reporting?sslmode=require'
  const session: PgSession = {
    async query<X>(text: string): Promise<X[]> {
      if (text.includes('information_schema.columns')) return COLUMNS as unknown as X[]
      if (text.includes('from "public"."ads_insights"')) return [acct('111', 'Proenzi RO (EUR)'), acct('222', 'Aflamin RO'), acct('333', 'Centrul Medis')] as X[]
      if (text.includes('from "public"."customer"')) return [{ account_id: '4408043813', name: 'Proenzi' }, { account_id: '555', name: 'Aflamin Gel Search' }] as X[]
      return []
    },
  }
  const connect = async <R>(_t: PgTarget, run: (s: PgSession) => Promise<R>) => run(session)
  return { db, connect }
}

test('doar propunerea: nimic scris; unice propuse, ambigue și fără potrivire raportate', async () => {
  const { db, connect } = setup()
  const [r] = await mapAirbyte({ db, connect, resolve: async () => ['89.41.38.210'], apply: false })
  assert.equal(r!.error, null)
  assert.deepEqual(r!.proposed.map((p) => [p.account.id, p.brand_id]).sort(), [['google_ads:4408043813', PRO], ['google_ads:555', GEL], ['meta_ads:111', PRO]])
  assert.deepEqual(r!.ambiguous.map((a) => [a.account.id, [...a.candidates].sort()]), [['meta_ads:222', [AFL, GEL].sort()]])
  assert.deepEqual(r!.unmatched.map((a) => a.id), ['meta_ads:333'])
  assert.equal(db.tables.source_connections!.length, 1)
})

test('cu apply: leagă doar propunerile unice, pe site-urile clientului; contul legat deja nu se atinge', async () => {
  const { db, connect } = setup([{ id: 'a0000000-0000-4000-8000-000000000001', tenant_id: T, brand_id: PRO, provider: 'airbyte', external_account_id: 'meta_ads:111', status: 'active', credential_status: 'unverified' }])
  const [r] = await mapAirbyte({ db, connect, resolve: async () => ['89.41.38.210'], apply: true })
  assert.deepEqual(r!.already.map((a) => a.account.id), ['meta_ads:111'])
  assert.ok(r!.proposed.every((p) => p.linked))
  const added = db.tables.source_connections!.filter((c) => c.provider === 'airbyte' && c.external_account_id !== 'meta_ads:111')
  assert.deepEqual(added.map((c) => [c.tenant_id, c.brand_id, c.external_account_id, c.display_name]).sort(), [
    [T, PRO, 'google_ads:4408043813', 'Proenzi'],
    [T, GEL, 'google_ads:555', 'Aflamin Gel Search'],
  ])
})

test('adresă privată: nicio conexiune, eroare raportată', async () => {
  const { db, connect } = setup()
  let connected = false
  const [r] = await mapAirbyte({ db, connect: async (t, run) => { connected = true; return connect(t, run) }, resolve: async () => ['10.0.0.1'], apply: true })
  assert.match(r!.error!, /privat|intern|public/i)
  assert.equal(connected, false)
})
