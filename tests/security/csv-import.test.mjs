// Atacuri prin HTTP real pe Edge Function csv-import și pe tabelele importate (Supabase local, `supabase functions serve`).
// Obiective: doar agency_admin / account cu brand_access importă; izolare pe tenant și brand; nimic nu se scrie fără drept.
// Vezi docs/security-tests.md (secțiunea E). Date sintetice, doar aici.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { ANON_KEY, SERVICE_ROLE_KEY, U, T1, B1A, B1B, B2A, signJwt, userToken, req, rest, asService } from './helpers.mjs'

const FN = '/functions/v1/csv-import'
const b64 = (s) => Buffer.from(s).toString('base64')
const csv = (campaign, spend = 10) => `date,campaign_id,campaign_name,spend,clicks\n2026-10-05,${campaign},${campaign},${spend},5\n`
const declared = { currency: 'RON', timezone: 'Europe/Bucharest' }
const stamp = Date.now()
let n = 0
const unique = () => `camp-${stamp}-${++n}`

const fn = (body, token) => req(FN, { method: 'POST', body, token })
const preview = (brand, content, token, source = 'tiktok_ads') =>
  fn({ action: 'preview', brand_id: brand, source, file_name: 'x.csv', content_base64: b64(content), declared }, token)

before(async () => {
  const ready = await fn({}, ANON_KEY)
  assert.notEqual(ready.status, 404, 'Edge Function csv-import nu e servită: `supabase functions serve`')
})

describe('E1. Fără identitate de utilizator', () => {
  const now = Math.floor(Date.now() / 1000)
  const cases = [
    ['fără Authorization', undefined],
    ['cheia anon ca Bearer', ANON_KEY],
    ['cheia service role ca Bearer', SERVICE_ROLE_KEY],
    ['JWT cu alt secret (sub = admin T1)', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 600 }, 'alt-secret-cu-cel-putin-32-de-caractere!!')],
    ['JWT alg none', signJwt({ sub: U.admin1, role: 'authenticated', aud: 'authenticated', exp: now + 600 }, '', { alg: 'none', typ: 'JWT' })],
    ['JWT expirat', userToken(U.admin1, { iat: now - 7200, exp: now - 3600 })],
  ]
  for (const [label, token] of cases) {
    test(`${label}: 401, nimic scris`, async () => {
      const before = (await asService('import_batches?select=id')).json.length
      const res = await preview(B1A, csv(unique()), token)
      assert.equal(res.status, 401)
      assert.equal((await asService('import_batches?select=id')).json.length, before)
    })
  }
})

describe('E2. Rol și brand_access', () => {
  test('account T1 (acces 1B): importă în 1B', async () => {
    const res = await preview(B1B, csv(unique()), userToken(U.account1))
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.status, 'validated')
    const batch = (await asService(`import_batches?select=tenant_id,brand_id,uploaded_by,status&id=eq.${res.json.batch_id}`)).json[0]
    assert.deepEqual(batch, { tenant_id: T1, brand_id: B1B, uploaded_by: U.account1, status: 'validated' })
  })

  test('account T1 în 1A (fără brand_access): 404; nimic scris', async () => {
    const before = (await asService('import_batches?select=id')).json.length
    const res = await preview(B1A, csv(unique()), userToken(U.account1))
    assert.equal(res.status, 404)
    assert.equal((await asService('import_batches?select=id')).json.length, before)
  })

  test('strategist și client_viewer cu acces la 1A: 403', async () => {
    for (const user of [U.strat1, U.client1]) {
      const res = await preview(B1A, csv(unique()), userToken(user))
      assert.equal(res.status, 403, `${user}: ${res.status}`)
    }
  })

  test('client fără brand_access și admin T2 pe brand din T1: 404', async () => {
    assert.equal((await preview(B1A, csv(unique()), userToken(U.clientNone))).status, 404)
    assert.equal((await preview(B1A, csv(unique()), userToken(U.admin2))).status, 404)
  })

  test('admin T1 importă pe orice brand din tenant; tenant_id trimis de client e ignorat', async () => {
    const res = await fn({ action: 'preview', brand_id: B1A, tenant_id: '10000000-0000-0000-0000-000000000002', source: 'tiktok_ads',
      file_name: 'x.csv', content_base64: b64(csv(unique())), declared }, userToken(U.admin1))
    assert.equal(res.status, 200)
    const batch = (await asService(`import_batches?select=tenant_id&id=eq.${res.json.batch_id}`)).json[0]
    assert.equal(batch.tenant_id, T1)
  })

  test('revocarea accesului se aplică la confirmare (același JWT)', async () => {
    const p = await preview(B1B, csv(unique()), userToken(U.account1))
    assert.equal(p.status, 200)
    await asService(`brand_access?user_id=eq.${U.account1}&brand_id=eq.${B1B}`, { method: 'PATCH', body: { revoked_at: new Date().toISOString() } })
    try {
      const c = await fn({ action: 'confirm', batch_id: p.json.batch_id }, userToken(U.account1))
      assert.equal(c.status, 404)
      const rows = (await asService(`paid_daily?select=id&import_batch_id=eq.${p.json.batch_id}`)).json
      assert.deepEqual(rows, [])
    } finally {
      await asService(`brand_access?user_id=eq.${U.account1}&brand_id=eq.${B1B}`, { method: 'PATCH', body: { revoked_at: null } })
    }
  })
})

describe('E3. Fluxul complet și izolarea datelor importate', () => {
  const campaign = unique()
  let batchId

  test('previzualizare → confirmare: rândurile apar în paid_daily cu proveniență', async () => {
    const p = await preview(B1B, csv(campaign, 42.5), userToken(U.account1))
    assert.equal(p.status, 200)
    batchId = p.json.batch_id
    assert.deepEqual((await asService(`paid_daily?select=id&import_batch_id=eq.${batchId}`)).json, [], 'previzualizarea nu scrie în țintă')
    const c = await fn({ action: 'confirm', batch_id: batchId }, userToken(U.admin1))
    assert.equal(c.status, 200, JSON.stringify(c.json))
    const rows = (await asService(`paid_daily?select=tenant_id,brand_id,spend,currency,collection_method,source&import_batch_id=eq.${batchId}`)).json
    assert.deepEqual(rows, [{ tenant_id: T1, brand_id: B1B, spend: 42.5, currency: 'RON', collection_method: 'csv', source: 'tiktok_ads' }])
    const audit = (await asService(`audit_events?select=action,actor_user_id&entity_id=eq.${batchId}&action=like.import_*&order=id.asc`)).json
    assert.deepEqual(audit.filter((a) => a.action.startsWith('import_')).map((a) => [a.action, a.actor_user_id]).slice(-2), [['import_previewed', U.account1], ['import_confirmed', U.admin1]])
  })

  test('același fișier a doua oară: 409; reconfirmare: 409', async () => {
    assert.equal((await preview(B1B, csv(campaign, 42.5), userToken(U.account1))).status, 409)
    assert.equal((await fn({ action: 'confirm', batch_id: batchId }, userToken(U.admin1))).status, 409)
  })

  test('admin T2, client fără acces, strategist și client cu rol nepermis nu pot confirma / citi raportul lotului', async () => {
    const p = await preview(B1B, csv(unique()), userToken(U.account1))
    for (const [user, status] of [[U.admin2, 404], [U.clientNone, 404], [U.strat1, 404], [U.client1, 404]]) {
      const c = await fn({ action: 'confirm', batch_id: p.json.batch_id }, userToken(user))
      assert.equal(c.status, status, `confirm ${user}: ${c.status}`)
      const r = await fn({ action: 'report', batch_id: p.json.batch_id }, userToken(user))
      assert.equal(r.status, status, `report ${user}: ${r.status}`)
    }
    assert.deepEqual((await asService(`paid_daily?select=id&import_batch_id=eq.${p.json.batch_id}`)).json, [])
  })

  test('RLS: datele importate sunt vizibile doar celor cu acces la brand', async () => {
    // 1B: admin T1 și account (acces 1B) văd; client T1 (acces doar 1A), client fără acces și admin T2 nu văd.
    for (const [user, expected] of [[U.admin1, 1], [U.account1, 1], [U.client1, 0], [U.clientNone, 0], [U.admin2, 0]]) {
      const res = await rest(`paid_daily?select=spend&import_batch_id=eq.${batchId}`, { token: userToken(user) })
      assert.equal(res.json.length, expected, `${user}: ${JSON.stringify(res.json)}`)
    }
  })

  test('RLS: loturile și rândurile respinse sunt vizibile doar agenției cu acces; clientul nu le vede', async () => {
    assert.equal((await rest(`import_batches?select=id&id=eq.${batchId}`, { token: userToken(U.account1) })).json.length, 1)
    assert.equal((await rest(`import_batches?select=id&id=eq.${batchId}`, { token: userToken(U.client1) })).json.length, 0)
    assert.equal((await rest(`import_batch_rows?select=row_number&batch_id=eq.${batchId}`, { token: userToken(U.admin2) })).json.length, 0)
  })

  test('scrierea directă în tabelele importate e refuzată pentru orice utilizator, inclusiv admin', async () => {
    const row = {
      tenant_id: T1, brand_id: B1B, source: 'tiktok_ads', campaign_id: 'atac', date: '2026-10-05', spend: 1, currency: 'RON',
      import_batch_id: batchId, row_number: 99, collected_at: new Date().toISOString(), payload_hash: 'f'.repeat(64), source_timezone: 'UTC', schema_version: 'x',
    }
    for (const user of [U.admin1, U.account1, U.strat1, U.client1]) {
      const post = await rest('paid_daily', { method: 'POST', token: userToken(user), body: row })
      assert.ok([401, 403].includes(post.status), `POST ${user}: ${post.status}`)
      const patch = await rest(`paid_daily?import_batch_id=eq.${batchId}`, { method: 'PATCH', token: userToken(user), body: { spend: 999 }, headers: { Prefer: 'return=representation' } })
      assert.ok([401, 403].includes(patch.status) || (patch.status === 200 && patch.json.length === 0), `PATCH ${user}: ${patch.status}`)
      const del = await rest(`paid_daily?import_batch_id=eq.${batchId}`, { method: 'DELETE', token: userToken(user), headers: { Prefer: 'return=representation' } })
      assert.ok([401, 403].includes(del.status) || (del.status === 200 && del.json.length === 0), `DELETE ${user}: ${del.status}`)
    }
    const check = (await asService(`paid_daily?select=spend&import_batch_id=eq.${batchId}`)).json
    assert.deepEqual(check, [{ spend: 42.5 }])
    // loturile: un utilizator nu își poate marca singur lotul ca importat
    const hijack = await rest(`import_batches?id=eq.${batchId}`, { method: 'PATCH', token: userToken(U.account1), body: { status: 'validated' }, headers: { Prefer: 'return=representation' } })
    assert.ok([401, 403].includes(hijack.status) || (hijack.status === 200 && hijack.json.length === 0), `PATCH import_batches: ${hijack.status}`)
  })

  test('izolare între tenanți: același fișier importat în T2 nu atinge datele din T1', async () => {
    const p = await preview(B2A, csv(campaign, 7), userToken(U.admin2))
    assert.equal(p.status, 200, JSON.stringify(p.json))
    assert.equal((await fn({ action: 'confirm', batch_id: p.json.batch_id }, userToken(U.admin2))).status, 200)
    const t1 = (await asService(`paid_daily?select=spend&tenant_id=eq.${T1}&campaign_id=eq.${campaign}`)).json
    assert.deepEqual(t1, [{ spend: 42.5 }], 'datele din T1 neschimbate')
    const t2 = (await rest(`paid_daily?select=spend,tenant_id`, { token: userToken(U.admin2) })).json
    assert.ok(t2.every((r) => r.tenant_id !== T1))
  })
})

describe('E4. Intrări malițioase', () => {
  test('ID-uri cu filtre PostgREST și acțiuni necunoscute: 400', async () => {
    const t = userToken(U.admin1)
    for (const body of [
      { action: 'confirm', batch_id: `${T1}&brand_id=neq.x` },
      { action: 'report', batch_id: 'not.is.null' },
      { action: 'preview', brand_id: `${B1A},${B1B}`, source: 'tiktok_ads', content_base64: b64(csv('x')), declared },
      { action: 'drop_tables' },
      { action: 'get_token', batch_id: B1A },
    ]) {
      const res = await fn(body, t)
      assert.equal(res.status, 400, JSON.stringify(body))
    }
  })

  test('moneda/fusul nedeclarate: 422; sursă necunoscută: 400', async () => {
    const t = userToken(U.admin1)
    const noCurrency = await fn({ action: 'preview', brand_id: B1A, source: 'tiktok_ads', content_base64: b64(csv(unique())), declared: { timezone: 'Europe/Bucharest' } }, t)
    assert.deepEqual([noCurrency.status, noCurrency.json.code], [422, 'currency_required'])
    const noTz = await fn({ action: 'preview', brand_id: B1A, source: 'tiktok_ads', content_base64: b64(csv(unique())), declared: { currency: 'RON' } }, t)
    assert.deepEqual([noTz.status, noTz.json.code], [422, 'timezone_required'])
    assert.equal((await fn({ action: 'preview', brand_id: B1A, source: 'snapchat_ads', content_base64: b64('a,b'), declared }, t)).status, 400)
  })

  test('răspunsurile nu conțin chei, tokenuri sau JWT-uri', async () => {
    const res = await preview(B1A, csv(unique()), userToken(U.admin1))
    const text = JSON.stringify(res.json)
    assert.doesNotMatch(text, new RegExp(`${SERVICE_ROLE_KEY.slice(-20)}|${ANON_KEY.slice(-20)}`))
  })
})

describe('E5. Mențiuni: corecția umană are prioritate', () => {
  test('reimport cu alt sentiment: sentimentul revizuit rămâne; textul se actualizează', async () => {
    const id = `m-${stamp}`
    const first = `native_id,url,published_at,text,sentiment\n${id},https://exemplu.ro/${id},2026-10-05T10:00:00Z,vechi,positive\n`
    const p1 = await fn({ action: 'preview', brand_id: B1A, source: 'planable_listening', file_name: 'm.csv', content_base64: b64(first), declared: { timezone: 'Europe/Bucharest' } }, userToken(U.admin1))
    assert.equal(p1.status, 200, JSON.stringify(p1.json))
    assert.equal((await fn({ action: 'confirm', batch_id: p1.json.batch_id }, userToken(U.admin1))).status, 200)
    await asService(`mentions?native_id=eq.${id}&brand_id=eq.${B1A}`, {
      method: 'PATCH', body: { sentiment: 'negative', sentiment_reviewed_by: U.admin1, sentiment_reviewed_at: new Date().toISOString() },
    })
    const second = `native_id,url,published_at,text,sentiment\n${id},https://exemplu.ro/${id},2026-10-05T10:00:00Z,nou,positive\n`
    const p2 = await fn({ action: 'preview', brand_id: B1A, source: 'planable_listening', file_name: 'm2.csv', content_base64: b64(second), declared: { timezone: 'Europe/Bucharest' } }, userToken(U.admin1))
    assert.equal((await fn({ action: 'confirm', batch_id: p2.json.batch_id }, userToken(U.admin1))).status, 200)
    const m = (await asService(`mentions?select=sentiment,text,sentiment_reviewed_by&native_id=eq.${id}&brand_id=eq.${B1A}`)).json
    assert.deepEqual(m, [{ sentiment: 'negative', text: 'nou', sentiment_reviewed_by: U.admin1 }])
  })
})
