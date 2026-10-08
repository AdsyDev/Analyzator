// Analize, acțiuni și farmacovigilență prin API-ul real (PostgREST) și Edge Function `notify`. Supabase local.
// Obiective: clientul nu vede drafturi, jurnalul PV sau coada; statusul nu se schimbă direct; tranzițiile cer rolul potrivit;
// izolare pe tenant și brand; coada de notificări nu pierde nimic fără secret. Date sintetice, doar aici.
// Vezi docs/security-tests.md (secțiunea F). Testul nu creează contacte PV, deci nu poate trimite e-mailuri nici dacă
// RESEND_API_KEY e setat local.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { U, T1, B1A, B1B, B2A, userToken, req, rest, asService } from './helpers.mjs'

const stamp = Date.now()
const post = (path, body, user) => rest(path, { method: 'POST', body, token: userToken(user), headers: { Prefer: 'return=representation' } })
const patch = (path, body, user) => rest(path, { method: 'PATCH', body, token: userToken(user), headers: { Prefer: 'return=representation' } })
const get = (path, user) => rest(path, { token: userToken(user) })
const denied = (res) => [401, 403].includes(res.status)

let insightId
const content = { summary: `Constatare ${stamp}`, interpretation: 'Interpretare', limits: 'Limite' }

before(async () => {
  // metrică cu date: gsc_clicks pe 1A (service role; doar în test)
  const conn = await asService('source_connections', {
    method: 'POST',
    body: { id: '50000000-0000-0000-0000-0000000000f1', tenant_id: T1, brand_id: B1A, provider: 'gsc', external_account_id: 'sc-domain:api-test' },
  })
  assert.equal(conn.status, 201, JSON.stringify(conn.json))
  const r = await asService('search_daily', {
    method: 'POST',
    body: {
      tenant_id: T1, brand_id: B1A, date: '2026-08-01', device: 'DESKTOP', clicks: 12, impressions: 100, position: 3,
      source_id: '50000000-0000-0000-0000-0000000000f1', collected_at: new Date().toISOString(), payload_hash: 'a'.repeat(64),
      source_timezone: 'America/Los_Angeles', data_state: 'final', schema_version: 'test',
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.json))
})

describe('F1. Ciclul unei analize prin REST', () => {
  test('strategist cu acces creează draft; status și autor nu se pot falsifica', async () => {
    const base = { tenant_id: T1, brand_id: B1A, title: 'x', period_start: '2026-08-01', period_end: '2026-08-07' }
    assert.ok(denied(await post('insights', { ...base, author_id: U.strat1, status: 'published' }, U.strat1)), 'status la inserare')
    assert.ok(denied(await post('insights', { ...base, author_id: U.admin1 }, U.strat1)), 'autor fals')
    const ok = await post('insights', { ...base, title: `Analiză API ${stamp}`, author_id: U.strat1, ...content }, U.strat1)
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    insightId = ok.json[0].id
    assert.equal(ok.json[0].status, 'draft')
  })

  test('account fără acces la 1A, client și admin T2 nu creează / nu văd draftul', async () => {
    const mk = (user) => post('insights', { tenant_id: T1, brand_id: B1A, title: 'intrus', period_start: '2026-08-01', period_end: '2026-08-07', author_id: user }, user)
    for (const user of [U.account1, U.client1, U.admin2]) assert.ok(denied(await mk(user)), `creare ${user}`)
    for (const user of [U.client1, U.clientNone, U.admin2, U.account1]) {
      assert.deepEqual((await get(`insights?id=eq.${insightId}`, user)).json, [], `citire ${user}`)
    }
  })

  test('status și autor nu se actualizează direct, nici de autor, nici de admin', async () => {
    for (const user of [U.strat1, U.admin1]) {
      assert.ok(denied(await patch(`insights?id=eq.${insightId}`, { status: 'published' }, user)), `status ${user}`)
      assert.ok(denied(await patch(`insights?id=eq.${insightId}`, { author_id: U.admin1 }, user)), `autor ${user}`)
    }
    assert.equal((await get(`insights?select=status&id=eq.${insightId}`, U.strat1)).json[0].status, 'draft')
  })

  test('dovezi și trimitere la review; fără dovezi → 400', async () => {
    const early = await post('insight_transitions', { insight_id: insightId, to_status: 'in_review' }, U.strat1)
    assert.equal(early.status, 400, JSON.stringify(early.json))
    assert.match(JSON.stringify(early.json), /dovezi/)
    const ev = (extra) => post('evidence_links', { tenant_id: T1, brand_id: B1A, insight_id: insightId, ...extra }, U.strat1)
    assert.equal((await ev({ kind: 'metric', metric_key: 'gsc_clicks' })).status, 201)
    assert.equal((await ev({ kind: 'record', record_table: 'mentions', record_id: 'm-api' })).status, 201)
    assert.equal((await ev({ kind: 'metric', metric_key: 'nu_exista' })).status, 400)
    const ok = await post('insight_transitions', { insight_id: insightId, to_status: 'in_review' }, U.strat1)
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    assert.equal(ok.json[0].from_status, 'draft')
    assert.equal(ok.json[0].actor_id, U.strat1)
  })

  test('tranziții interzise: client, admin T2, strategist din alt tenant, account fără acces; corp falsificat', async () => {
    for (const user of [U.client1, U.admin2, U.strat2, U.account1]) {
      const res = await post('insight_transitions', { insight_id: insightId, to_status: 'published' }, user)
      assert.ok(denied(res), `${user}: ${res.status}`)
    }
    assert.equal((await get(`insights?select=status&id=eq.${insightId}`, U.strat1)).json[0].status, 'in_review')
    // tenant, brand, actor și from_status vin din trigger, nu din corpul cererii
    const forged = await post(
      'insight_transitions',
      { insight_id: insightId, to_status: 'published', tenant_id: T1, brand_id: B2A, actor_id: U.admin1, from_status: 'in_review' },
      U.client1,
    )
    assert.ok(denied(forged), `corp falsificat: ${forged.status}`)
  })

  test('publicare: snapshot cu valoarea din metrics.compute; clientul vede analiza, dovezile și snapshotul, nu jurnalul', async () => {
    const pub = await post('insight_transitions', { insight_id: insightId, to_status: 'published' }, U.strat1)
    assert.equal(pub.status, 201, JSON.stringify(pub.json))
    const snaps = (await get(`insight_snapshots?select=metric_key,result&insight_id=eq.${insightId}`, U.client1)).json
    assert.equal(snaps.length, 1)
    assert.equal(snaps[0].metric_key, 'gsc_clicks')
    assert.equal(Number(snaps[0].result.metric.value), 12)
    const client = (await get(`insights?select=title,status&id=eq.${insightId}`, U.client1)).json
    assert.deepEqual(client.map((r) => r.status), ['published'])
    assert.equal((await get(`evidence_links?select=id&insight_id=eq.${insightId}`, U.client1)).json.length, 2)
    assert.deepEqual((await get('insight_transitions?select=id', U.client1)).json, [])
    for (const user of [U.clientNone, U.admin2]) {
      assert.deepEqual((await get(`insight_snapshots?select=id&insight_id=eq.${insightId}`, user)).json, [], user)
    }
  })

  test('analiza publicată nu se editează (nici de service role) și nu se șterge; snapshotul e imutabil', async () => {
    await patch(`insights?id=eq.${insightId}`, { title: 'rescris' }, U.strat1)
    const svc = await asService(`insights?id=eq.${insightId}`, { method: 'PATCH', body: { title: 'rescris de service role' } })
    assert.ok(denied(svc), `service role: ${svc.status}`)
    const del = await asService(`insights?id=eq.${insightId}`, { method: 'DELETE' })
    assert.ok(denied(del), `delete: ${del.status}`)
    const snap = await asService(`insight_snapshots?insight_id=eq.${insightId}`, { method: 'PATCH', body: { result: {} } })
    assert.ok(denied(snap), `snapshot: ${snap.status}`)
    assert.equal((await get(`insights?select=title&id=eq.${insightId}`, U.strat1)).json[0].title, `Analiză API ${stamp}`)
  })
})

describe('F2. Acțiuni', () => {
  test('creare, tranziții, vizibilitate pentru client', async () => {
    const mk = (extra) => post('actions', { tenant_id: T1, brand_id: B1A, insight_id: insightId, title: 'x', ...extra }, U.strat1)
    assert.equal((await mk({ responsible_user_id: U.client1 })).status, 400, 'responsabilul trebuie să fie din agenție')
    const created = await mk({ title: `Acțiune ${stamp}`, responsible_user_id: U.strat1, due_date: '2026-11-30' })
    assert.equal(created.status, 201, JSON.stringify(created.json))
    const actionId = created.json[0].id
    assert.equal(created.json[0].status, 'proposed')
    assert.deepEqual((await get(`actions?select=id&id=eq.${actionId}`, U.client1)).json, [], 'clientul nu vede propunerile')
    assert.ok(denied(await patch(`actions?id=eq.${actionId}`, { status: 'done' }, U.strat1)), 'status direct')
    assert.equal((await post('action_transitions', { action_id: actionId, to_status: 'done' }, U.strat1)).status, 400, 'proposed → done')
    assert.equal((await post('action_transitions', { action_id: actionId, to_status: 'agreed' }, U.strat1)).status, 201)
    assert.equal((await get(`actions?select=id&id=eq.${actionId}`, U.client1)).json.length, 1, 'clientul vede acțiunea agreată')
    for (const user of [U.client1, U.admin2, U.strat2]) {
      assert.ok(denied(await post('action_transitions', { action_id: actionId, to_status: 'in_progress' }, user)), `tranziție ${user}`)
    }
    assert.deepEqual((await get(`actions?select=id&id=eq.${actionId}`, U.admin2)).json, [])
  })
})

describe('F3. Farmacovigilență', () => {
  let flagId

  test('marcare: doar agenția cu acces la brand; tenant și autor din trigger; snapshot etichetat', async () => {
    const body = { brand_id: B1A, entity_type: 'review', entity_ref: `r-${stamp}`, text_snapshot: 'Text din review (test)', link: 'https://magazin.example/r' }
    for (const user of [U.client1, U.account1, U.admin2, U.clientNone]) assert.ok(denied(await post('pv_flags', body, user)), `marcare ${user}`)
    const forged = await post('pv_flags', { ...body, tenant_id: '10000000-0000-0000-0000-000000000002', flagged_by: U.admin1, status: 'closed' }, U.strat1)
    assert.ok(denied(forged), `câmpuri falsificate: ${forged.status}`)
    const ok = await post('pv_flags', body, U.strat1)
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    flagId = ok.json[0].id
    assert.deepEqual([ok.json[0].tenant_id, ok.json[0].flagged_by, ok.json[0].status, ok.json[0].snapshot_source], [T1, U.strat1, 'open', 'user_provided'])
  })

  test('vizibilitate: clientul și admin T2 nu văd nimic; autorul vede marcajul, nu jurnalul; agency_admin vede tot', async () => {
    for (const table of ['pv_flags', 'pv_flag_events', 'pv_notifications', 'pv_contacts']) {
      assert.deepEqual((await get(`${table}?select=*`, U.client1)).json, [], `client ${table}`)
      assert.deepEqual((await get(`${table}?select=*`, U.admin2)).json, [], `admin T2 ${table}`)
    }
    assert.equal((await get(`pv_flags?select=id&id=eq.${flagId}`, U.strat1)).json.length, 1)
    assert.deepEqual((await get('pv_flag_events?select=id', U.strat1)).json, [])
    assert.equal((await get(`pv_flags?select=id&id=eq.${flagId}`, U.admin1)).json.length, 1)
    const events = (await get(`pv_flag_events?select=event_type&flag_id=eq.${flagId}`, U.admin1)).json
    assert.deepEqual(events.map((e) => e.event_type), ['marked'])
  })

  test('coada: notificarea e pending (fără trimitere nu se pierde); marcajul e imutabil', async () => {
    const q = (await get(`pv_notifications?select=status,attempts&flag_id=eq.${flagId}`, U.admin1)).json
    assert.deepEqual(q, [{ status: 'pending', attempts: 0 }])
    assert.ok(denied(await patch(`pv_flags?id=eq.${flagId}`, { text_snapshot: 'rescris' }, U.strat1)))
    assert.ok(denied(await patch(`pv_flags?id=eq.${flagId}`, { status: 'closed' }, U.admin1)))
    const del = await asService(`pv_flags?id=eq.${flagId}`, { method: 'DELETE' })
    assert.ok(denied(del), `delete: ${del.status}`)
  })

  test('jurnalul: doar agency_admin scrie transmitted / closed / note; „marked” și „notification_sent” nu', async () => {
    for (const user of [U.strat1, U.client1, U.admin2]) {
      assert.ok(denied(await post('pv_flag_events', { flag_id: flagId, event_type: 'note' }, user)), `jurnal ${user}`)
    }
    for (const type of ['marked', 'notification_sent']) assert.ok(denied(await post('pv_flag_events', { flag_id: flagId, event_type: type }, U.admin1)), type)
    assert.equal((await post('pv_flag_events', { flag_id: flagId, event_type: 'closed' }, U.admin1)).status, 400, 'open → closed')
    assert.equal((await post('pv_flag_events', { flag_id: flagId, event_type: 'transmitted', note: 'test' }, U.admin1)).status, 201)
    assert.equal((await get(`pv_flags?select=status&id=eq.${flagId}`, U.admin1)).json[0].status, 'transmitted')
  })

  test('contacte PV: doar agency_admin; fără contacte, dispatch-ul nu trimite și nu pierde notificarea', async () => {
    assert.ok(denied(await post('pv_contacts', { tenant_id: T1, email: 'x@agentie.ro' }, U.strat1)))
    assert.ok(denied(await post('pv_contacts', { tenant_id: T1, email: 'x@agentie.ro' }, U.client1)))
    assert.ok(denied(await post('pv_contacts', { tenant_id: '10000000-0000-0000-0000-000000000002', email: 'x@agentie.ro' }, U.admin1)))
    const res = await req('/functions/v1/notify', { method: 'POST', body: { action: 'dispatch' }, token: userToken(U.strat1) })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.sent, 0)
    assert.ok(['secret_missing', 'ok'].includes(res.json.state), res.json.state)
    const q = (await get(`pv_notifications?select=status&flag_id=eq.${flagId}`, U.admin1)).json
    assert.equal(q[0].status, 'pending', 'notificarea rămâne în coadă')
  })

  test('Edge Function notify: client / fără JWT / JWT expirat → refuzat', async () => {
    assert.equal((await req('/functions/v1/notify', { method: 'POST', body: { action: 'dispatch' }, token: userToken(U.client1) })).status, 403)
    assert.equal((await req('/functions/v1/notify', { method: 'POST', body: { action: 'dispatch' } })).status, 401)
    assert.equal((await req('/functions/v1/notify', { method: 'POST', body: { action: 'dispatch' }, token: userToken(U.admin1, { exp: 1 }) })).status, 401)
  })
})

describe('F4. Izolare între branduri', () => {
  test('account cu acces la 1B nu vede analiza lui 1A; strategist cu acces la 1A nu creează în 1B', async () => {
    assert.deepEqual((await get(`insights?select=id&id=eq.${insightId}`, U.account1)).json, [])
    const res = await post('insights', { tenant_id: T1, brand_id: B1B, title: 'în 1B', period_start: '2026-08-01', period_end: '2026-08-07', author_id: U.strat1 }, U.strat1)
    assert.ok(denied(res), `creare în 1B: ${res.status}`)
  })
})
