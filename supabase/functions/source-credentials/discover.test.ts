import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { discover, GA4_ACCOUNTS_URL, GOOGLE_TOKEN_URL, GSC_SITES_URL } from './discover.ts'

// Răspunsurile de test sunt construite după documentația fiecărui API („derivat din documentație, neconfirmat”).
const NOW = new Date('2026-10-12T10:00:00Z')
let serviceAccount = ''
let publicKey: import('node:crypto').webcrypto.CryptoKey

before(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  publicKey = pair.publicKey
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  let bin = ''
  for (const b of der) bin += String.fromCharCode(b)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`
  serviceAccount = JSON.stringify({ type: 'service_account', client_email: 'analyzator@proiect.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://evil.example/token' })
})

type Call = { url: string; init?: RequestInit }
function fakeFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    if (!key) throw new Error(`neașteptat: ${url}`)
    return routes[key]!({ url, init })
  }
  return { fetch, calls }
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })

/** Endpointul de token Google: verifică semnătura JWT cu cheia publică și scope-ul cerut. */
async function googleToken(call: Call, scope: string): Promise<Response> {
  const assertion = new URLSearchParams(String(call.init?.body)).get('assertion') ?? ''
  const [h, p, s] = assertion.split('.')
  const dec = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((x.length + 3) % 4)), (c) => c.charCodeAt(0))
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, dec(s!), new TextEncoder().encode(`${h}.${p}`))
  const claims = JSON.parse(new TextDecoder().decode(dec(p!))) as { iss: string; scope: string; aud: string; exp: number; iat: number }
  assert.ok(ok, 'semnătura JWT e validă')
  assert.equal(claims.iss, 'analyzator@proiect.iam.gserviceaccount.com')
  assert.equal(claims.aud, GOOGLE_TOKEN_URL, 'audiența e adresa fixă Google, nu token_uri din cheie')
  assert.equal(claims.scope, scope)
  assert.equal(claims.exp - claims.iat, 3600)
  return json({ access_token: 'ya29.acces', expires_in: 3600 })
}

describe('Google: proprietăți GA4 și site-uri Search Console', () => {
  test('GA4: proprietățile din toate conturile, cu paginare; tokenul de acces doar la Google', async () => {
    const { fetch, calls } = fakeFetch({
      [GOOGLE_TOKEN_URL]: (c) => googleToken(c, 'https://www.googleapis.com/auth/analytics.readonly'),
      [GA4_ACCOUNTS_URL]: (c) =>
        c.url.includes('pageToken=p2')
          ? json({ accountSummaries: [{ displayName: 'STADA', propertySummaries: [{ property: 'properties/222', displayName: 'Proenzi' }] }] })
          : json({ accountSummaries: [{ displayName: 'STADA', propertySummaries: [{ property: 'properties/111', displayName: 'Minimartieni' }, { property: 'gresit' }] }], nextPageToken: 'p2' }),
    })
    const r = await discover('ga4', serviceAccount, fetch, NOW)
    assert.deepEqual(r, { ok: true, truncated: false, accounts: [{ id: '111', name: 'Minimartieni', detail: 'STADA' }, { id: '222', name: 'Proenzi', detail: 'STADA' }] })
    assert.ok(calls.every((c) => !c.url.includes('evil.example')))
    assert.equal((calls[1]!.init?.headers as Record<string, string>).Authorization, 'Bearer ya29.acces')
  })

  test('GA4: Admin API neactivat → mesaj care spune ce API trebuie activat', async () => {
    const { fetch } = fakeFetch({
      [GOOGLE_TOKEN_URL]: (c) => googleToken(c, 'https://www.googleapis.com/auth/analytics.readonly'),
      [GA4_ACCOUNTS_URL]: () => json({ error: { code: 403, status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, 403),
    })
    const r = await discover('ga4', serviceAccount, fetch, NOW)
    assert.equal(r.ok, false)
    assert.ok(!r.ok && r.reason === 'api_disabled' && r.message.includes('Google Analytics Admin API'))
  })

  test('Search Console: site-urile verificate, fără cele neverificate', async () => {
    const { fetch } = fakeFetch({
      [GOOGLE_TOKEN_URL]: (c) => googleToken(c, 'https://www.googleapis.com/auth/webmasters.readonly'),
      [GSC_SITES_URL]: () => json({ siteEntry: [{ siteUrl: 'sc-domain:minimartieni.ro', permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'https://x.ro/', permissionLevel: 'siteUnverifiedUser' }] }),
    })
    const r = await discover('gsc', serviceAccount, fetch, NOW)
    assert.deepEqual(r, { ok: true, truncated: false, accounts: [{ id: 'sc-domain:minimartieni.ro', name: 'sc-domain:minimartieni.ro', detail: 'Domain property' }] })
  })

  test('cheia refuzată la schimbul de token → invalid, fără alte cereri', async () => {
    const { fetch, calls } = fakeFetch({ [GOOGLE_TOKEN_URL]: () => json({ error: 'invalid_grant' }, 400) })
    const r = await discover('gsc', serviceAccount, fetch, NOW)
    assert.ok(!r.ok && r.reason === 'invalid')
    assert.equal(calls.length, 1)
  })

  test('o cheie care nu e service account → invalid, fără nicio cerere', async () => {
    const { fetch, calls } = fakeFetch({})
    const r = await discover('ga4', '{"web":{}}', fetch, NOW)
    assert.ok(!r.ok && r.reason === 'invalid')
    assert.equal(calls.length, 0)
  })
})

describe('Planable, Meta, SEOmonitor', () => {
  test('Planable: workspace-urile tokenului', async () => {
    const { fetch } = fakeFetch({ 'https://api.planable.io/api/v1/workspaces': () => json({ data: [{ id: 'ws1', name: 'Minimartieni', timezone: 'Europe/Bucharest' }, { name: 'fără id' }] }) })
    assert.deepEqual(await discover('planable', 'pln_x', fetch, NOW), { ok: true, truncated: false, accounts: [{ id: 'ws1', name: 'Minimartieni', detail: 'Europe/Bucharest' }] })
  })

  test('Planable 401 → token refuzat', async () => {
    const { fetch } = fakeFetch({ 'https://api.planable.io/': () => json({ error: { code: 'UNAUTHORIZED' } }, 401) })
    const r = await discover('planable', 'pln_x', fetch, NOW)
    assert.ok(!r.ok && r.reason === 'invalid')
  })

  test('Meta: conturile de ads, cu paginare doar pe Graph API', async () => {
    const { fetch, calls } = fakeFetch({
      'https://graph.facebook.com/v26.0/me/adaccounts': () => json({ data: [{ id: 'act_1', name: 'Minimartieni RO', currency: 'RON' }], paging: { next: 'https://graph.facebook.com/v26.0/me/adaccounts?after=x' } }),
    })
    const r = await discover('meta_ads', 'EAAG', fetch, NOW)
    assert.ok(r.ok)
    assert.deepEqual(r.ok && r.accounts[0], { id: 'act_1', name: 'Minimartieni RO', detail: 'RON' })
    assert.equal(calls.length, 5, 'plafonul de pagini')
    assert.ok(r.ok && r.truncated)
  })

  test('Meta: o pagină „next” spre altă adresă nu se urmează (tokenul nu pleacă)', async () => {
    const { fetch, calls } = fakeFetch({
      'https://graph.facebook.com/': () => json({ data: [{ id: 'act_2', name: 'X' }], paging: { next: 'https://evil.example/next' } }),
    })
    await discover('meta_ads', 'EAAG', fetch, NOW)
    assert.equal(calls.length, 1)
  })

  test('SEOmonitor: campaniile cu domeniul; tokenul brut în Authorization', async () => {
    const { fetch, calls } = fakeFetch({
      'https://apigw.seomonitor.com/v3/dashboard/v3.0/campaigns/tracked': () => json([{ campaign_info: { id: 501, name: 'Minimartieni', domain: 'minimartieni.ro' } }, { campaign_info: {} }]),
    })
    assert.deepEqual(await discover('seomonitor', 'jwt', fetch, NOW), { ok: true, truncated: false, accounts: [{ id: '501', name: 'Minimartieni', detail: 'minimartieni.ro' }] })
    assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, 'jwt')
  })

  test('eroare de rețea → provider_error, nu invalid', async () => {
    const r = await discover('seomonitor', 'jwt', async () => { throw new Error('ECONNRESET') }, NOW)
    assert.ok(!r.ok && r.reason === 'provider_error')
  })
})
