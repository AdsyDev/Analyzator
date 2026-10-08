// Statusul surselor, actualitatea, istoricul și alertele de refresh prin API-ul real (PostgREST). Supabase local.
// Obiective: clientul vede doar actualitatea datelor (fără erori, conexiuni sau istoric); agenția vede doar brandurile ei;
// alte tenanți nu văd nimic; alertele și contactele sunt ale agency_admin. Date sintetice, doar aici.
// Vezi docs/security-tests.md (secțiunea G).
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { U, T1, B1A, B1B, B2A, userToken, rest, asService } from './helpers.mjs'

const get = (path, user) => rest(path, { token: userToken(user) })
const denied = (res) => [401, 403].includes(res.status)
const RUN = 'a0000000-0000-0000-0000-0000000000f1'

before(async () => {
  const r = await asService('sync_runs', {
    method: 'POST',
    body: {
      id: RUN, tenant_id: T1, brand_id: B1A, source: 'gsc', period_start: '2026-09-01', period_end: '2026-09-30', status: 'failed',
      errors: [{ code: 'access_denied', message: 'detaliu intern' }], started_at: '2026-10-01T10:00:00Z', finished_at: '2026-10-01T10:00:05Z',
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.json))
})

describe('G1. source_status și sync_history (agenția)', () => {
  test('strategist (acces 1A): doar brandul lui, 9 surse; vede eșecul și codurile', async () => {
    const rows = (await get('source_status?select=brand_id,source,state,last_run_status,last_run_error_count', U.strat1)).json
    assert.deepEqual([...new Set(rows.map((r) => r.brand_id))], [B1A])
    assert.equal(rows.length, 9)
    const gsc = rows.find((r) => r.source === 'gsc')
    assert.equal(gsc.last_run_status, 'failed')
    const hist = (await get(`sync_history?select=id,status,error_codes,duration_seconds&id=eq.${RUN}`, U.strat1)).json
    assert.deepEqual(hist.map((h) => [h.status, h.error_codes, Number(h.duration_seconds)]), [['failed', ['access_denied'], 5]])
  })

  test('account (acces 1B) nu vede nimic din 1A; admin T1 vede ambele branduri; admin T2 nimic din T1', async () => {
    assert.deepEqual([...new Set((await get('source_status?select=brand_id', U.account1)).json.map((r) => r.brand_id))], [B1B])
    assert.deepEqual((await get(`sync_history?select=id&id=eq.${RUN}`, U.account1)).json, [])
    assert.deepEqual([...new Set((await get('source_status?select=brand_id', U.admin1)).json.map((r) => r.brand_id))].sort(), [B1A, B1B])
    assert.deepEqual((await get(`source_status?select=brand_id&tenant_id=eq.${T1}`, U.admin2)).json, [])
    assert.deepEqual((await get(`sync_history?select=id&id=eq.${RUN}`, U.admin2)).json, [])
  })

  test('clientul (cu și fără acces) nu vede statusul, istoricul sau zilele cu date', async () => {
    for (const user of [U.client1, U.clientNone]) {
      for (const view of ['source_status', 'sync_history']) assert.deepEqual((await get(`${view}?select=*`, user)).json, [], `${user} ${view}`)
    }
    assert.deepEqual((await get('source_status?select=*', U.clientNone)).json, [])
    assert.deepEqual((await get('source_dataset_days?select=*', U.clientNone)).json, [])
  })

  test('view-urile nu se pot scrie și nu expun coloane de conexiune clientului', async () => {
    for (const view of ['source_status', 'source_freshness', 'sync_history', 'source_dataset_days']) {
      const post = await rest(view, { method: 'POST', token: userToken(U.admin1), body: {}, headers: { Prefer: 'return=representation' } })
      assert.ok(denied(post) || post.status >= 400, `${view}: ${post.status}`)
    }
    const fresh = (await get('source_freshness?select=*', U.client1)).json
    assert.ok(fresh.length > 0)
    assert.deepEqual(Object.keys(fresh[0]).sort(), ['brand_id', 'data_as_of', 'freshness', 'grace_days', 'source', 'tenant_id'])
  })
})

describe('G2. source_freshness (clientul)', () => {
  test('clientul cu acces vede doar brandul lui; fără acces / alt tenant: nimic', async () => {
    const rows = (await get('source_freshness?select=brand_id,source,freshness', U.client1)).json
    assert.deepEqual([...new Set(rows.map((r) => r.brand_id))], [B1A])
    assert.ok(rows.every((r) => ['no_data', 'current', 'delayed'].includes(r.freshness)))
    assert.deepEqual((await get('source_freshness?select=*', U.clientNone)).json, [])
    assert.deepEqual((await get(`source_freshness?select=*&brand_id=eq.${B1A}`, U.admin2)).json, [])
    assert.ok((await get(`source_freshness?select=brand_id&brand_id=eq.${B2A}`, U.admin2)).json.length > 0)
  })
})

describe('G3. Contacte și alerte', () => {
  test('doar agency_admin gestionează contactele; coada e vizibilă doar lui', async () => {
    const body = { tenant_id: T1, email: `ops-${Date.now()}@agentie.ro` }
    for (const user of [U.strat1, U.client1, U.admin2]) {
      assert.ok(denied(await rest('alert_contacts', { method: 'POST', token: userToken(user), body })), `contact ${user}`)
    }
    const ok = await rest('alert_contacts', { method: 'POST', token: userToken(U.admin1), body, headers: { Prefer: 'return=representation' } })
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    const q = await asService('ops_notifications', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: { tenant_id: T1, brand_id: B1A, sync_run_id: RUN, kind: 'refresh_failed', source: 'gsc', subject: 's', body: 'b' },
    })
    assert.equal(q.status, 201, JSON.stringify(q.json))
    assert.equal((await get('ops_notifications?select=status', U.admin1)).json[0].status, 'pending')
    for (const user of [U.strat1, U.client1, U.admin2]) {
      assert.deepEqual((await get('ops_notifications?select=id', user)).json, [], `coadă ${user}`)
      assert.deepEqual((await get('alert_contacts?select=id', user)).json, [], `contacte ${user}`)
    }
    const patch = await rest('ops_notifications?status=eq.pending', { method: 'PATCH', token: userToken(U.admin1), body: { status: 'sent' }, headers: { Prefer: 'return=representation' } })
    assert.ok(denied(patch) || patch.json.length === 0, `coada nu se modifică de utilizatori: ${patch.status}`)
  })
})
