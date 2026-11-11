// AdSy AI (Etapa 4, deciziile M, O, P): atacuri prin HTTP real pe funcția server `adsy-ai` și pe suprafețele ei din
// bază (jurnalul cererilor, politica brandului, ciornele generate, documentele aprobate, căutarea), pe Supabase local.
// Obiective: fără identitate validă nu se întâmplă nimic; un utilizator nu ajunge la brandul sau clientul altcuiva prin
// chat, generare, cache ori căutare; AI-ul rămâne oprit până la o decizie explicită; clientul nu poate scrie ciorne, cereri
// sau documente; nimic generat nu se publică singur.
// Local, funcția rulează FĂRĂ cheie de model: dincolo de porți, răspunsul așteptat e `not_configured`, deci niciun test
// nu cheamă un model real. Vezi docs/security-tests.md (secțiunea N).
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ANON_KEY, SERVICE_ROLE_KEY, U, T1, B1A, B1B, signJwt, userToken, req, rest, asService, representation } from './helpers.mjs'

const FN = '/functions/v1/adsy-ai'
const RUN = Date.now()
const PERIOD = { start: '2026-10-01', end: '2026-10-28' }
const DOC_TITLE = `Document de test ${RUN}`
const WORD = `cuvantunic${RUN}`

const fn = (body, token) => req(FN, { method: 'POST', body, token })
const chat = (brand, token, extra = {}) => fn({ action: 'chat', brand_id: brand, question: 'Cum au mers sesiunile?', period: PERIOD, ...extra }, token)
const generate = (brand, token) => fn({ action: 'generate_insight', brand_id: brand, period: PERIOD }, token)
const tok = (id) => userToken(id)

async function requestsOf(brand) {
  const r = await asService(`ai_requests?select=id&brand_id=eq.${brand}`)
  assert.equal(r.status, 200)
  return r.json.length
}
async function generatedInsights(brand) {
  const r = await asService(`insights?select=id&brand_id=eq.${brand}&origin=eq.adsy_ai`)
  assert.equal(r.status, 200)
  return r.json.length
}
async function setPolicy(values) {
  // Politica o scrie agency_admin, cu sesiunea lui: inserare la prima rulare, actualizare apoi.
  const body = { tenant_id: T1, brand_id: B1A, updated_by: U.admin1, ...values }
  const inserted = await rest('ai_brand_policies', { method: 'POST', token: tok(U.admin1), body })
  if (inserted.status === 201) return
  const { tenant_id: _t, brand_id: _b, ...patch } = body
  const updated = await rest(`ai_brand_policies?brand_id=eq.${B1A}`, { method: 'PATCH', token: tok(U.admin1), body: patch, headers: representation })
  assert.equal(updated.status, 200, JSON.stringify(updated.json))
  assert.equal(updated.json.length, 1)
}
const refused = (r) => r.status === 401 || r.status === 403

before(async () => {
  // `supabase functions serve` pornește toate funcțiile; prima cerere poate găsi runtime-ul încă pornind.
  let status = 0
  for (let i = 0; i < 45; i++) {
    status = (await fn({ action: 'status', brand_id: B1A }, ANON_KEY)).status
    if (status === 401) break
    await new Promise((r) => setTimeout(r, 2000))
  }
  assert.equal(status, 401, 'Edge Function adsy-ai nu e servită: rulează `supabase functions serve`')
  // Stare curată: fără politică, fără preferințe și fără cereri pe brandurile de test.
  await asService(`ai_user_preferences?brand_id=in.(${B1A},${B1B})`, { method: 'DELETE' })
  await asService(`ai_brand_policies?brand_id=in.(${B1A},${B1B})`, { method: 'DELETE' })
})

after(async () => {
  await asService(`ai_user_preferences?brand_id=in.(${B1A},${B1B})`, { method: 'DELETE' })
  await asService(`ai_brand_policies?brand_id=in.(${B1A},${B1B})`, { method: 'DELETE' })
})

describe('N1. Fără identitate validă de utilizator', () => {
  const now = Math.floor(Date.now() / 1000)
  const cases = [
    ['fără Authorization', undefined],
    ['cheia anon ca Bearer', ANON_KEY],
    ['cheia service role ca Bearer', SERVICE_ROLE_KEY],
    ['JWT semnat cu alt secret (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 600 }, 'alt-secret-cu-cel-putin-32-de-caractere!!')],
    ['JWT alg none (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 600 }, '', { alg: 'none', typ: 'JWT' })],
    ['JWT expirat (admin T1)', userToken(U.admin1, { iat: now - 7200, exp: now - 3600 })],
    ['JWT valid pentru un utilizator inexistent', userToken('39999999-0000-0000-0000-000000000099')],
  ]
  for (const [name, token] of cases) {
    test(`${name}: nicio acțiune nu trece și nimic nu se scrie`, async () => {
      const before = await requestsOf(B1A)
      for (const r of [await fn({ action: 'status', brand_id: B1A }, token), await chat(B1A, token), await generate(B1A, token)]) {
        assert.ok(refused(r), `status ${r.status}: ${JSON.stringify(r.json)}`)
        assert.ok(!('answer' in (r.json ?? {})) && !('insight_id' in (r.json ?? {})))
      }
      assert.equal(await requestsOf(B1A), before)
    })
  }
})

describe('N2. Brandul sau clientul altcuiva', () => {
  const cases = [
    ['client fără acces la niciun brand', U.clientNone, B1A],
    ['adminul altui client', U.admin2, B1A],
    ['strategist cu acces doar la 1A cere 1B', U.strat1, B1B],
    ['clientul lui 1A cere 1B', U.client1, B1B],
  ]
  for (const [name, user, brand] of cases) {
    test(`${name}: 403 la status, chat și generare, cu același mesaj ca pentru un brand inexistent`, async () => {
      const missing = await chat('2fffffff-0000-0000-0000-00000000ffff', tok(user))
      for (const r of [await fn({ action: 'status', brand_id: brand }, tok(user)), await chat(brand, tok(user)), await generate(brand, tok(user))]) {
        assert.equal(r.status, 403, JSON.stringify(r.json))
        assert.deepEqual(r.json, missing.json, 'răspunsul nu trebuie să deosebească „fără acces” de „inexistent”')
      }
    })
  }

  test('nicio cerere refuzată nu a lăsat urme în jurnal', async () => {
    assert.equal(await requestsOf(B1A), 0)
    assert.equal(await requestsOf(B1B), 0)
  })
})

describe('N3. Oprit până la o decizie explicită', () => {
  test('fără politică salvată: chatul și generarea răspund ai_off, oricine ar întreba', async () => {
    for (const user of [U.client1, U.strat1, U.admin1]) {
      assert.deepEqual((await chat(B1A, tok(user))).json, { status: 'ai_off', blocked_by: 'policy' })
    }
    assert.deepEqual((await generate(B1A, tok(U.strat1))).json, { status: 'ai_off', blocked_by: 'policy' })
    assert.equal(await requestsOf(B1A), 0)
  })

  test('politica nu o poate scrie decât agency_admin al clientului', async () => {
    const body = { tenant_id: T1, brand_id: B1A, chat_enabled: true, generation_enabled: true, display_enabled: true }
    for (const user of [U.client1, U.strat1, U.account1, U.admin2]) {
      const r = await rest('ai_brand_policies', { method: 'POST', token: tok(user), body: { ...body, updated_by: user } })
      assert.ok(refused(r), `${user}: ${r.status}`)
    }
    // Nici adminul nu poate semna politica în numele altcuiva.
    assert.ok(refused(await rest('ai_brand_policies', { method: 'POST', token: tok(U.admin1), body: { ...body, updated_by: U.strat1 } })))
    assert.deepEqual((await chat(B1A, tok(U.client1))).json, { status: 'ai_off', blocked_by: 'policy' })
  })

  test('cu politica pornită, dincolo de porți nu există model configurat local: not_configured, fără nicio cerere scrisă', async () => {
    await setPolicy({ chat_enabled: true, generation_enabled: true, display_enabled: true })
    assert.deepEqual((await chat(B1A, tok(U.client1))).json, { status: 'not_configured' }, 'testele locale rulează fără cheie de model')
    assert.deepEqual((await generate(B1A, tok(U.strat1))).json, { status: 'not_configured' })
    assert.equal(await requestsOf(B1A), 0)
    assert.equal(await generatedInsights(B1A), 0)
  })

  test('politica unui brand nu pornește nimic pe alt brand al aceluiași client', async () => {
    assert.deepEqual((await chat(B1B, tok(U.admin1))).json, { status: 'ai_off', blocked_by: 'policy' })
  })

  test('clientul nu poate cere o ciornă, oricum ar fi politica', async () => {
    const r = await generate(B1A, tok(U.client1))
    assert.equal(r.status, 403)
    assert.equal(await generatedInsights(B1A), 0)
  })

  test('preferința personală oprește chatul doar pentru cel care a setat-o și nu o poate scrie altcineva', async () => {
    const mine = { tenant_id: T1, brand_id: B1A, user_id: U.client1, chat_enabled: false, display_enabled: true }
    assert.ok(refused(await rest('ai_user_preferences', { method: 'POST', token: tok(U.strat1), body: mine })), 'preferința altui utilizator')
    assert.equal((await rest('ai_user_preferences', { method: 'POST', token: tok(U.client1), body: mine })).status, 201)
    assert.deepEqual((await chat(B1A, tok(U.client1))).json, { status: 'ai_off', blocked_by: 'preference' })
    assert.deepEqual((await chat(B1A, tok(U.strat1))).json, { status: 'not_configured' })
    const seen = await rest(`ai_user_preferences?select=user_id&brand_id=eq.${B1A}`, { token: tok(U.admin1) })
    assert.deepEqual(seen.json, [], 'nici agency_admin nu citește preferințele altora')
  })

  test('generarea are nevoie și de afișare; cu generarea oprită, la fel', async () => {
    await setPolicy({ chat_enabled: true, generation_enabled: true, display_enabled: false })
    assert.deepEqual((await generate(B1A, tok(U.strat1))).json, { status: 'ai_off', blocked_by: 'policy' })
    await setPolicy({ chat_enabled: true, generation_enabled: false, display_enabled: true })
    assert.deepEqual((await generate(B1A, tok(U.strat1))).json, { status: 'ai_off', blocked_by: 'policy' })
  })

  test('cereri invalide: 400 înaintea oricărei alte verificări de conținut', async () => {
    for (const body of [
      { action: 'chat', brand_id: 'nu-e-uuid', question: 'q?', period: PERIOD },
      { action: 'chat', brand_id: B1A, question: '', period: PERIOD },
      { action: 'chat', brand_id: B1A, question: 'x'.repeat(1001), period: PERIOD },
      { action: 'chat', brand_id: B1A, question: 'Cum?', period: { start: '2026-10-28', end: '2026-10-01' } },
      { action: 'generate_insight', brand_id: B1A, period: { start: '2020-01-01', end: '2026-10-28' } },
      { action: 'altceva', brand_id: B1A },
    ]) {
      assert.equal((await fn(body, tok(U.strat1))).status, 400, JSON.stringify(body).slice(0, 80))
    }
    assert.equal((await req(FN, { method: 'GET', token: tok(U.strat1) })).status, 405)
  })
})

describe('N4. Jurnalul cererilor și cache-ul', () => {
  let requestId
  before(async () => {
    const r = await asService('ai_requests', {
      method: 'POST',
      headers: representation,
      body: {
        tenant_id: T1, brand_id: B1A, user_id: U.strat1, task: 'generate_insight', model_id: 'model-test', prompt_version: 'insight-v1',
        period_start: PERIOD.start, period_end: PERIOD.end, data_snapshot_id: 'a'.repeat(64), cache_key: 'b'.repeat(64), status: 'ok',
        response: { status: 'ok', title: 'Text din cache', summary: 'secret-de-cache' }, total_tokens: 10,
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.json))
    requestId = r.json[0].id
  })
  after(async () => {
    await asService(`insights?ai_request_id=eq.${requestId}`, { method: 'DELETE' })
    await asService(`ai_requests?id=eq.${requestId}`, { method: 'DELETE' })
  })

  test('nimeni nu își scrie singur cereri sau răspunsuri în cache', async () => {
    const body = { tenant_id: T1, brand_id: B1A, task: 'chat', model_id: 'm', prompt_version: 'v', period_start: PERIOD.start, period_end: PERIOD.end, data_snapshot_id: 'c'.repeat(64), cache_key: 'd'.repeat(64), status: 'ok', response: { summary: 'fals' } }
    for (const user of [U.client1, U.strat1, U.admin1, U.admin2]) {
      assert.ok(refused(await rest('ai_requests', { method: 'POST', token: tok(user), body: { ...body, user_id: user } })), user)
    }
    for (const user of [U.strat1, U.admin1]) {
      assert.ok(refused(await rest(`ai_requests?id=eq.${requestId}`, { method: 'PATCH', token: tok(user), body: { response: { summary: 'rescris' } } })), `PATCH ${user}`)
      assert.ok(refused(await rest(`ai_requests?id=eq.${requestId}`, { method: 'DELETE', token: tok(user) })), `DELETE ${user}`)
    }
    const kept = await asService(`ai_requests?select=response&id=eq.${requestId}`)
    assert.equal(kept.json[0].response.summary, 'secret-de-cache')
  })

  test('cererea o vede cel care a făcut-o și agency_admin al clientului; nimeni altcineva', async () => {
    const read = async (user) => (await rest(`ai_requests?select=id,response&id=eq.${requestId}`, { token: tok(user) })).json
    assert.equal((await read(U.strat1)).length, 1)
    assert.equal((await read(U.admin1)).length, 1)
    for (const user of [U.client1, U.account1, U.clientNone, U.admin2, U.strat2]) {
      assert.deepEqual(await read(user), [], user)
    }
    const all = await rest('ai_requests?select=tenant_id', { token: tok(U.admin2) })
    assert.ok(all.json.every((r) => r.tenant_id !== T1), 'adminul altui client nu vede nicio cerere a lui T1')
  })

  test('o ciornă marcată adsy_ai cere cererea reușită a aceluiași utilizator, pe același brand și aceeași perioadă', async () => {
    const draft = (user, extra = {}) =>
      rest('insights', {
        method: 'POST', token: tok(user), headers: representation,
        body: { tenant_id: T1, brand_id: B1A, author_id: user, title: `Ciornă ${RUN}`, period_start: PERIOD.start, period_end: PERIOD.end, summary: 's', interpretation: 'i', limits: 'l', origin: 'adsy_ai', ai_request_id: requestId, ...extra },
      })
    assert.ok(refused(await draft(U.client1)), 'clientul')
    assert.ok(refused(await draft(U.admin1)), 'alt utilizator decât cel al cererii')
    assert.ok(refused(await draft(U.strat1, { period_start: '2026-09-01', period_end: '2026-09-30' })), 'altă perioadă')
    assert.ok(refused(await draft(U.strat1, { ai_request_id: '5fffffff-0000-0000-0000-00000000ffff' })), 'cerere inexistentă')
    assert.equal(await generatedInsights(B1A), 0)

    const ok = await draft(U.strat1)
    assert.equal(ok.status, 201, JSON.stringify(ok.json))
    assert.deepEqual([ok.json[0].status, ok.json[0].origin], ['draft', 'adsy_ai'])
    const id = ok.json[0].id
    assert.ok(refused(await draft(U.strat1)) || (await generatedInsights(B1A)) === 1, 'o cerere produce o singură ciornă')
    assert.equal(await generatedInsights(B1A), 1)

    // Eticheta nu se poate șterge, iar ciorna nu ajunge la client și nu se publică singură.
    const relabel = await rest(`insights?id=eq.${id}`, { method: 'PATCH', token: tok(U.strat1), body: { origin: 'human' }, headers: representation })
    assert.ok(refused(relabel), `rescrierea provenienței: ${relabel.status}`)
    const publish = await rest(`insights?id=eq.${id}`, { method: 'PATCH', token: tok(U.strat1), body: { status: 'published' }, headers: representation })
    assert.ok(refused(publish), `publicare directă: ${publish.status}`)
    const kept = await asService(`insights?select=origin,status&id=eq.${id}`)
    assert.deepEqual(kept.json, [{ origin: 'adsy_ai', status: 'draft' }])
    assert.deepEqual((await rest(`insights?select=id&id=eq.${id}`, { token: tok(U.client1) })).json, [], 'clientul nu vede ciorna')
    assert.deepEqual((await rest(`insights?select=id&id=eq.${id}`, { token: tok(U.admin2) })).json, [], 'alt client nu vede ciorna')
  })

  test('cu afișarea oprită, brand_insights nu întoarce analiza generată; cu ea pornită, o întoarce echipei, marcată', async () => {
    const list = async (user) => {
      const r = await rest('rpc/brand_insights', { method: 'POST', token: tok(user), body: { p_brand_id: B1A, p_start: PERIOD.start, p_end: PERIOD.end } })
      assert.equal(r.status, 200, JSON.stringify(r.json))
      return r.json.filter((i) => i.title === `Ciornă ${RUN}`)
    }
    await setPolicy({ chat_enabled: true, generation_enabled: true, display_enabled: false })
    assert.deepEqual(await list(U.strat1), [])
    await setPolicy({ chat_enabled: true, generation_enabled: true, display_enabled: true })
    const seen = await list(U.strat1)
    assert.deepEqual(seen.map((i) => [i.origin, i.status]), [['adsy_ai', 'draft']])
    assert.deepEqual(await list(U.client1), [], 'clientul nu vede o ciornă nici cu afișarea pornită')
  })

  test('brand_ai_settings: consumul brandului îl vede doar agency_admin; alt client e refuzat', async () => {
    const settings = (user) => rest('rpc/brand_ai_settings', { method: 'POST', token: tok(user), body: { p_brand_id: B1A } })
    assert.equal((await settings(U.admin1)).json.month_tokens, 10)
    assert.equal((await settings(U.strat1)).json.month_tokens, null)
    assert.equal((await settings(U.client1)).json.month_tokens, null)
    assert.deepEqual([(await settings(U.admin1)).json.can_generate, (await settings(U.client1)).json.can_generate], [true, false])
    for (const user of [U.admin2, U.clientNone]) assert.ok(refused(await settings(user)), user)
    assert.ok(refused(await rest('rpc/brand_ai_settings', { method: 'POST', token: ANON_KEY, body: { p_brand_id: B1A } })), 'anon')
  })
})

describe('N5. Documente aprobate și căutarea', () => {
  let docId
  const search = (user, brand = B1A, query = WORD) => rest('rpc/brand_document_search', { method: 'POST', token: tok(user), body: { p_brand_id: brand, p_query: query, p_on: null, p_limit: 5 } })
  const docBody = (user, extra = {}) => ({ tenant_id: T1, brand_id: B1A, title: DOC_TITLE, doc_type: 'faq', country: 'RO', language: 'ro', version: '1', owner: 'Test', valid_from: '2020-01-01', created_by: user, ...extra })

  test('clientul și alt client nu introduc documente; statusul trimis la inserare e ignorat', async () => {
    for (const user of [U.client1, U.clientNone, U.admin2]) {
      assert.ok(refused(await rest('brand_documents', { method: 'POST', token: tok(user), body: docBody(user) })), user)
    }
    const r = await rest('brand_documents', { method: 'POST', token: tok(U.account1), body: docBody(U.account1), headers: representation })
    assert.ok(refused(r), 'account fără acces la 1A')
    const made = await rest('brand_documents', { method: 'POST', token: tok(U.strat1), body: docBody(U.strat1), headers: representation })
    assert.equal(made.status, 201, JSON.stringify(made.json))
    assert.equal(made.json[0].status, 'draft')
    docId = made.json[0].id
    const frag = await rest('brand_document_fragments', { method: 'POST', token: tok(U.strat1), body: { tenant_id: T1, brand_id: B1A, document_id: docId, position: 1, section_ref: 'Test', content: `Fragment cu ${WORD} pentru testul de izolare.` } })
    assert.equal(frag.status, 201, JSON.stringify(frag.json))
    // Un fragment nu poate fi agățat de documentul altui brand.
    const cross = await rest('brand_document_fragments', { method: 'POST', token: tok(U.admin1), body: { tenant_id: T1, brand_id: B1B, document_id: docId, position: 2, content: 'alt brand' } })
    assert.ok(cross.status >= 400, `fragment pe alt brand: ${cross.status}`)
  })

  test('o ciornă nu intră în căutare și nu e vizibilă clientului', async () => {
    assert.deepEqual((await search(U.strat1)).json, [])
    assert.deepEqual((await rest(`brand_documents?select=id&id=eq.${docId}`, { token: tok(U.client1) })).json, [])
    assert.deepEqual((await rest(`brand_document_fragments?select=id&document_id=eq.${docId}`, { token: tok(U.client1) })).json, [])
  })

  test('aprobarea: nu de către client; după ea, documentul apare în căutare doar pentru cei cu acces la brand', async () => {
    const approve = (user) => rest(`brand_documents?id=eq.${docId}`, { method: 'PATCH', token: tok(user), body: { status: 'approved' }, headers: representation })
    const byClient = await approve(U.client1)
    assert.ok(refused(byClient) || byClient.json.length === 0, 'clientul nu aprobă')
    const byOther = await approve(U.admin2)
    assert.ok(refused(byOther) || byOther.json.length === 0, 'alt client nu aprobă')
    assert.equal((await asService(`brand_documents?select=status&id=eq.${docId}`)).json[0].status, 'draft')

    const ok = await approve(U.strat1)
    assert.equal(ok.status, 200, JSON.stringify(ok.json))
    assert.deepEqual([ok.json[0].status, ok.json[0].approved_by], ['approved', U.strat1])

    for (const user of [U.strat1, U.client1, U.admin1]) {
      const r = await search(user)
      assert.equal(r.status, 200)
      assert.deepEqual(r.json.map((f) => f.title), [DOC_TITLE], user)
    }
    for (const user of [U.admin2, U.clientNone, U.account1]) assert.ok(refused(await search(user)), user)
    assert.ok(refused(await rest('rpc/brand_document_search', { method: 'POST', token: ANON_KEY, body: { p_brand_id: B1A, p_query: WORD } })), 'anon')
    // Același cuvânt, căutat în alt brand al aceluiași client: nimic.
    assert.deepEqual((await search(U.admin1, B1B)).json, [])
    assert.deepEqual((await rest(`brand_document_fragments?select=id&document_id=eq.${docId}`, { token: tok(U.admin2) })).json, [])
  })

  test('un document aprobat nu se rescrie: nici textul, nici valabilitatea, nici cu cheia de service', async () => {
    const edit = await rest(`brand_documents?id=eq.${docId}`, { method: 'PATCH', token: tok(U.admin1), body: { title: 'Rescris' }, headers: representation })
    assert.ok(edit.status >= 400, `editare: ${edit.status}`)
    const more = await rest('brand_document_fragments', { method: 'POST', token: tok(U.admin1), body: { tenant_id: T1, brand_id: B1A, document_id: docId, position: 2, content: 'adăugat după aprobare' } })
    assert.ok(more.status >= 400, `fragment nou: ${more.status}`)
    const byService = await asService(`brand_document_fragments?document_id=eq.${docId}`, { method: 'PATCH', body: { content: 'rescris de server' } })
    assert.ok(byService.status >= 400, `rescriere cu cheia de service: ${byService.status}`)
    const kept = await asService(`brand_document_fragments?select=content&document_id=eq.${docId}`)
    assert.equal(kept.json.length, 1)
    assert.match(kept.json[0].content, new RegExp(WORD))
    assert.equal((await asService(`brand_documents?select=title&id=eq.${docId}`)).json[0].title, DOC_TITLE)
  })

  test('întrebarea e text: caracterele speciale nu schimbă ce se caută', async () => {
    for (const q of [`${WORD}'); drop table public.brand_documents; --`, `${WORD} | ! & ( ) :* <->`, `%${WORD}%`]) {
      const r = await search(U.strat1, B1A, q)
      assert.equal(r.status, 200, q)
      assert.deepEqual(r.json.map((f) => f.title), [DOC_TITLE], q)
    }
    assert.equal((await asService(`brand_documents?select=id&id=eq.${docId}`)).json.length, 1)
  })

  test('retragerea: nu de către client; după ea, documentul iese din căutare și rămâne în istoric', async () => {
    const retire = (user) => rest(`brand_documents?id=eq.${docId}`, { method: 'PATCH', token: tok(user), body: { status: 'retired' }, headers: representation })
    const byClient = await retire(U.client1)
    assert.ok(refused(byClient) || byClient.json.length === 0)
    assert.equal((await search(U.client1)).json.length, 1)
    assert.equal((await retire(U.strat1)).status, 200)
    assert.deepEqual((await search(U.strat1)).json, [])
    assert.deepEqual((await rest(`brand_documents?select=id&id=eq.${docId}`, { token: tok(U.client1) })).json, [], 'clientul nu mai vede documentul retras')
    assert.equal((await asService(`brand_documents?select=status&id=eq.${docId}`)).json[0].status, 'retired')
  })
})
