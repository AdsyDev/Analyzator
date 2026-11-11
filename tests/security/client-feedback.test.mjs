// Răspunsul clientului la recomandări și comentariile pe analize (deciziile S), prin API-ul real (PostgREST), pe Supabase
// local. Obiective: doar clientul brandului răspunde la o recomandare, și doar pe o analiză publicată; nimeni nu scrie în
// numele altcuiva; istoricul nu se rescrie și nu se șterge; nimic nu se vede sau nu se scrie în afara brandului.
// Date sintetice, doar aici. Vezi docs/security-tests.md (secțiunea O).
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { ANON_KEY, U, T1, B1A, userToken, rest, asService } from './helpers.mjs'

const RUN = Date.now()
const TITLE = `Analiză cu recomandări ${RUN}`
const representation = { Prefer: 'return=representation' }
const post = (path, body, user) => rest(path, { method: 'POST', body, token: userToken(user), headers: representation })
const get = (path, user) => rest(path, { token: userToken(user) })
const denied = (r) => r.status === 401 || r.status === 403

let publishedId
let draftId
let recId
let draftRecId

const respond = (user, body) => post('recommendation_responses', { recommendation_id: recId, response: 'accepted', ...body }, user)
const comment = (user, body) => post('insight_comments', { insight_id: publishedId, body: 'Comentariu', ...body }, user)
const responses = async () => (await asService(`recommendation_responses?select=response,comment,user_id,brand_id,tenant_id&recommendation_id=eq.${recId}&order=created_at.asc`)).json
const comments = async () => (await asService(`insight_comments?select=body,author_id,author_role,brand_id&insight_id=eq.${publishedId}&order=created_at.asc`)).json

before(async () => {
  const base = { tenant_id: T1, brand_id: B1A, author_id: U.strat1, period_start: '2026-07-01', period_end: '2026-07-28', summary: 'Constatare', interpretation: 'Interpretare', limits: 'Limite' }
  const made = await post('insights', { ...base, title: TITLE }, U.strat1)
  assert.equal(made.status, 201, JSON.stringify(made.json))
  publishedId = made.json[0].id
  const draft = await post('insights', { ...base, title: `${TITLE} (ciornă)` }, U.strat1)
  assert.equal(draft.status, 201, JSON.stringify(draft.json))
  draftId = draft.json[0].id
  const rec = (insight) => post('recommendations', { tenant_id: T1, brand_id: B1A, insight_id: insight, problem: 'Problemă', action: 'Acțiune', expected_benefit: 'Beneficiu', priority: 1 }, U.strat1)
  const r1 = await rec(publishedId)
  assert.equal(r1.status, 201, JSON.stringify(r1.json))
  recId = r1.json[0].id
  const r2 = await rec(draftId)
  assert.equal(r2.status, 201, JSON.stringify(r2.json))
  draftRecId = r2.json[0].id
  const ev = await post('evidence_links', { tenant_id: T1, brand_id: B1A, insight_id: publishedId, kind: 'metric', metric_key: 'gsc_clicks' }, U.strat1)
  assert.equal(ev.status, 201, JSON.stringify(ev.json))
  for (const to of ['in_review', 'published']) {
    const t = await post('insight_transitions', { insight_id: publishedId, to_status: to }, U.strat1)
    assert.equal(t.status, 201, `${to}: ${JSON.stringify(t.json)}`)
  }
})

describe('O1. Cine răspunde la o recomandare', () => {
  test('echipa agenției, un client fără acces, alt client și anon sunt refuzați; nimic nu se scrie', async () => {
    for (const user of [U.strat1, U.admin1, U.account1, U.clientNone, U.admin2, U.strat2]) {
      assert.ok(denied(await respond(user, {})), `utilizator ${user}`)
    }
    const anon = await rest('recommendation_responses', { method: 'POST', token: ANON_KEY, body: { recommendation_id: recId, response: 'accepted' } })
    assert.ok(denied(anon), `anon: ${anon.status}`)
    assert.deepEqual(await responses(), [])
  })

  test('pe o ciornă, pe o recomandare inexistentă sau cu un răspuns necunoscut: refuz', async () => {
    assert.ok(denied(await post('recommendation_responses', { recommendation_id: draftRecId, response: 'accepted' }, U.client1)), 'ciornă')
    assert.ok(denied(await post('recommendation_responses', { recommendation_id: '5fffffff-0000-0000-0000-00000000ffff', response: 'accepted' }, U.client1)), 'inexistentă')
    assert.ok((await respond(U.client1, { response: 'refuzată' })).status >= 400, 'răspuns necunoscut')
    assert.ok((await respond(U.client1, { response: 'adjustment_requested' })).status >= 400, 'ajustare fără motiv')
    assert.ok((await respond(U.client1, { response: 'adjustment_requested', comment: '   ' })).status >= 400, 'motiv din spații')
    assert.deepEqual(await responses(), [])
  })

  test('clientul nu poate semna răspunsul cu alt utilizator, alt brand sau alt client', async () => {
    for (const extra of [{ user_id: U.admin1 }, { brand_id: '20000000-0000-0000-0000-000000000012' }, { tenant_id: '10000000-0000-0000-0000-000000000002' }, { insight_id: draftId }, { created_at: '2020-01-01T00:00:00Z' }]) {
      const r = await respond(U.client1, extra)
      assert.ok(denied(r), `${Object.keys(extra)[0]}: ${r.status}`)
    }
    assert.deepEqual(await responses(), [])
  })

  test('clientul brandului cere o ajustare, apoi acceptă: ambele rămân în istoric, cu brandul și autorul puse de server', async () => {
    const first = await respond(U.client1, { response: 'adjustment_requested', comment: '  Vrem alt termen.  ' })
    assert.equal(first.status, 201, JSON.stringify(first.json))
    const second = await respond(U.client1, {})
    assert.equal(second.status, 201, JSON.stringify(second.json))
    assert.deepEqual(await responses(), [
      { response: 'adjustment_requested', comment: 'Vrem alt termen.', user_id: U.client1, brand_id: B1A, tenant_id: T1 },
      { response: 'accepted', comment: null, user_id: U.client1, brand_id: B1A, tenant_id: T1 },
    ])
  })

  test('istoricul nu se rescrie și nu se șterge, nici de către autor, nici de către echipă', async () => {
    for (const user of [U.client1, U.admin1, U.strat1]) {
      const upd = await rest(`recommendation_responses?recommendation_id=eq.${recId}`, { method: 'PATCH', token: userToken(user), body: { response: 'accepted', comment: 'rescris' }, headers: representation })
      assert.ok(denied(upd) || (upd.status === 200 && upd.json.length === 0), `PATCH ${user}: ${upd.status}`)
      const del = await rest(`recommendation_responses?recommendation_id=eq.${recId}`, { method: 'DELETE', token: userToken(user), headers: representation })
      assert.ok(denied(del) || (del.status === 200 && del.json.length === 0), `DELETE ${user}: ${del.status}`)
    }
    const byService = await asService(`recommendation_responses?recommendation_id=eq.${recId}`, { method: 'PATCH', body: { comment: 'rescris de server' } })
    assert.ok(byService.status >= 400, `cheia de service: ${byService.status}`)
    assert.equal((await responses()).length, 2)
    assert.equal((await responses())[0].comment, 'Vrem alt termen.')
  })

  test('acceptarea nu schimbă analiza și nu creează acțiuni', async () => {
    assert.equal((await asService(`insights?select=status&id=eq.${publishedId}`)).json[0].status, 'published')
    assert.deepEqual((await asService(`actions?select=id&insight_id=eq.${publishedId}`)).json, [])
  })
})

describe('O2. Comentarii', () => {
  test('pe o ciornă nu se comentează; un client fără acces, alt client și anon sunt refuzați', async () => {
    for (const user of [U.strat1, U.client1]) assert.ok(denied(await post('insight_comments', { insight_id: draftId, body: 'pe ciornă' }, user)), `ciornă, ${user}`)
    for (const user of [U.clientNone, U.admin2, U.strat2, U.account1]) assert.ok(denied(await comment(user, {})), `utilizator ${user}`)
    assert.ok(denied(await rest('insight_comments', { method: 'POST', token: ANON_KEY, body: { insight_id: publishedId, body: 'anon' } })), 'anon')
    assert.deepEqual(await comments(), [])
  })

  test('nimeni nu semnează cu alt utilizator și clientul nu se poate da drept echipă', async () => {
    for (const extra of [{ author_id: U.strat1 }, { author_role: 'agency' }, { brand_id: '20000000-0000-0000-0000-000000000012' }, { tenant_id: '10000000-0000-0000-0000-000000000002' }]) {
      const r = await comment(U.client1, extra)
      assert.ok(denied(r), `${Object.keys(extra)[0]}: ${r.status}`)
    }
    assert.ok((await comment(U.client1, { body: '   ' })).status >= 400, 'gol')
    assert.ok((await comment(U.client1, { body: 'x'.repeat(2001) })).status >= 400, 'prea lung')
    assert.deepEqual(await comments(), [])
  })

  test('clientul și echipa comentează; autorul și rolul lui sunt puse de server', async () => {
    assert.equal((await comment(U.client1, { body: '  Putem muta termenul?  ' })).status, 201)
    assert.equal((await comment(U.strat1, { body: 'Da, discutăm joi.' })).status, 201)
    assert.deepEqual(await comments(), [
      { body: 'Putem muta termenul?', author_id: U.client1, author_role: 'client', brand_id: B1A },
      { body: 'Da, discutăm joi.', author_id: U.strat1, author_role: 'agency', brand_id: B1A },
    ])
  })

  test('comentariile nu se editează și nu se șterg', async () => {
    for (const user of [U.client1, U.strat1, U.admin1]) {
      const upd = await rest(`insight_comments?insight_id=eq.${publishedId}`, { method: 'PATCH', token: userToken(user), body: { body: 'editat' }, headers: representation })
      assert.ok(denied(upd) || (upd.status === 200 && upd.json.length === 0), `PATCH ${user}: ${upd.status}`)
      const del = await rest(`insight_comments?insight_id=eq.${publishedId}`, { method: 'DELETE', token: userToken(user), headers: representation })
      assert.ok(denied(del) || (del.status === 200 && del.json.length === 0), `DELETE ${user}: ${del.status}`)
    }
    assert.deepEqual((await comments()).map((c) => c.body), ['Putem muta termenul?', 'Da, discutăm joi.'])
  })
})

describe('O3. Cine citește', () => {
  test('răspunsurile și comentariile le văd doar cei cu acces la brand', async () => {
    for (const user of [U.client1, U.strat1, U.admin1]) {
      assert.equal((await get(`recommendation_responses?select=id&recommendation_id=eq.${recId}`, user)).json.length, 2, `răspunsuri, ${user}`)
      assert.equal((await get(`insight_comments?select=id&insight_id=eq.${publishedId}`, user)).json.length, 2, `comentarii, ${user}`)
    }
    for (const user of [U.clientNone, U.admin2, U.strat2, U.account1]) {
      assert.deepEqual((await get(`recommendation_responses?select=id&recommendation_id=eq.${recId}`, user)).json, [], `răspunsuri, ${user}`)
      assert.deepEqual((await get(`insight_comments?select=id&insight_id=eq.${publishedId}`, user)).json, [], `comentarii, ${user}`)
    }
    const all = await get('insight_comments?select=tenant_id', U.admin2)
    assert.ok(all.json.every((c) => c.tenant_id !== T1), 'adminul altui client nu vede niciun comentariu al lui T1')
  })

  test('brand_insights întoarce ultimul răspuns și discuția, fără nume; fiecare își recunoaște doar ce a scris el', async () => {
    const seen = async (user) => {
      const r = await rest('rpc/brand_insights', { method: 'POST', token: userToken(user), body: { p_brand_id: B1A, p_start: '2026-07-01', p_end: '2026-07-28' } })
      assert.equal(r.status, 200, JSON.stringify(r.json))
      return r.json.find((i) => i.id === publishedId)
    }
    const forClient = await seen(U.client1)
    assert.deepEqual([forClient.recommendations[0].client_response.response, forClient.recommendations[0].client_response.own], ['accepted', true])
    assert.deepEqual(forClient.comments.map((c) => [c.author_role, c.own]), [['client', true], ['agency', false]])
    const forTeam = await seen(U.strat1)
    assert.equal(forTeam.recommendations[0].client_response.own, false)
    assert.deepEqual(forTeam.comments.map((c) => c.own), [false, true])
    const text = JSON.stringify([forClient.comments, forClient.recommendations[0].client_response])
    assert.ok(!/@/.test(text), 'niciun e-mail în răspuns')
    for (const c of forClient.comments) assert.match(c.author, /^Utilizator [0-9a-f]{8}$/)
    assert.ok(denied(await rest('rpc/brand_insights', { method: 'POST', token: userToken(U.admin2), body: { p_brand_id: B1A, p_start: '2026-07-01', p_end: '2026-07-28' } })))
  })
})
