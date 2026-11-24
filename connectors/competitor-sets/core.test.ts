import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSets, discover, discoveryReport, normalizeDomain, validateSet } from './core.ts'
import { FakeDb } from '../shared/test-helpers.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const TODAY = '2026-11-24'

const db = () =>
  new FakeDb({
    brands: [
      { id: B1, tenant_id: T1, slug: 'proenzi', name: 'Proenzi', domain: 'https://www.proenzi.ro/', status: 'active' },
      { id: B2, tenant_id: T2, slug: 'alt-brand', name: 'Alt brand', domain: null, status: 'active' },
    ],
    competitor_sets: [],
    competitor_set_members: [],
    competitor_trackers: [
      { tenant_id: T1, brand_id: B1, source: 'planable_listening', external_id: 'k1', label: 'Artrostop', display_name: null, covered_to: '2026-11-23' },
      { tenant_id: T1, brand_id: B1, source: 'planable_competitors', external_id: 'sp1', label: 'flexamin.ro', display_name: 'Flexamin', covered_to: '2026-11-23' },
    ],
    competitor_mentions: [
      { tenant_id: T1, brand_id: B1, keyword_id: 'k1', published_at: '2026-11-20T10:00:00Z' },
      { tenant_id: T1, brand_id: B1, keyword_id: 'k1', published_at: '2026-11-21T10:00:00Z' },
    ],
    competitor_social_daily: [
      { tenant_id: T1, brand_id: B1, profile_id: 'sp1', is_own: false, date: '2026-11-22', followers: 1200, posts: 2 },
      { tenant_id: T1, brand_id: B1, profile_id: 'sp1', is_own: false, date: '2026-11-23', followers: 1210, posts: 1 },
    ],
    ai_brand_observations: [
      { tenant_id: T1, brand_id: B1, observed_domain: 'www.flexamin.ro', keyword_id: 'q1', present: true, is_own_brand: false, crawl_at: '2026-11-20' },
      { tenant_id: T1, brand_id: B1, observed_domain: 'flexamin.ro', keyword_id: 'q2', present: true, is_own_brand: false, crawl_at: '2026-11-20' },
      { tenant_id: T1, brand_id: B1, observed_domain: 'proenzi.ro', keyword_id: 'q3', present: true, is_own_brand: false, crawl_at: '2026-11-20' },
    ],
  })

describe('validateSet: aceleași reguli ca create_competitor_set_version', () => {
  const ok = { effective_from: '2026-01-01', members: [{ name: 'Flexamin', domain: 'HTTPS://www.Flexamin.ro/produse', social_handles: ['@Flexamin.RO'], ads_advertiser_ids: [' ar12345 '] }] }
  test('normalizează domeniul, profilurile și ID-urile; prima versiune poate începe în trecut', () => {
    const v = validateSet(ok, { today: TODAY, firstVersion: true, existingDates: [] })
    assert.ok(v.ok)
    assert.deepEqual(v.members[0], { name: 'Flexamin', domain: 'www.flexamin.ro', listening_keywords: [], social_handles: ['flexamin.ro'], ads_advertiser_ids: ['AR12345'] })
  })
  test('o versiune următoare nu poate începe în trecut; o dată folosită e refuzată', () => {
    assert.equal(validateSet(ok, { today: TODAY, firstVersion: false, existingDates: [] }).ok, false)
    assert.equal(validateSet({ ...ok, effective_from: TODAY }, { today: TODAY, firstVersion: false, existingDates: [TODAY] }).ok, false)
  })
  test('cuvântul unui competitor nu poate fi numele altuia; același profil sau advertiser la doi competitori e refuzat', () => {
    const r = validateSet(
      { effective_from: TODAY, members: [{ name: 'A', listening_keywords: ['Beta'], social_handles: ['x'], ads_advertiser_ids: ['AR11111'] }, { name: 'beta', social_handles: ['X'], ads_advertiser_ids: ['AR11111'] }] },
      { today: TODAY, firstVersion: true, existingDates: [] },
    )
    assert.ok(!r.ok)
    assert.equal(r.errors.length, 3)
  })
  test('între 1 și 10 competitori; nume obligatoriu', () => {
    assert.equal(validateSet({ effective_from: TODAY, members: [] }, { today: TODAY, firstVersion: true, existingDates: [] }).ok, false)
    assert.equal(validateSet({ effective_from: TODAY, members: [{ name: ' ' }] }, { today: TODAY, firstVersion: true, existingDates: [] }).ok, false)
  })
  test('normalizeDomain', () => {
    assert.equal(normalizeDomain('https://user@Ex.RO:443/cale?x'), 'ex.ro')
    assert.equal(normalizeDomain('  '), null)
  })
})

describe('discover: ce există deja în date, fără scriere', () => {
  test('cuvinte cu mențiuni, profiluri cu urmăritori, domenii SEOmonitor fără domeniul propriu; nimic scris', async () => {
    const d = db()
    const out = await discover(d, TODAY)
    const p = out.find((b) => b.brand.slug === 'proenzi')!
    assert.deepEqual(p.planable_keywords, [{ keyword: 'Artrostop', mentions_35d: 2, covered_to: '2026-11-23' }])
    assert.deepEqual(p.planable_profiles, [{ handle: 'flexamin.ro', name: 'Flexamin', followers: 1210, posts_35d: 3 }])
    assert.deepEqual(p.seomonitor_domains, [{ domain: 'flexamin.ro', keywords: 2 }], 'www. unificat, domeniul propriu exclus')
    assert.ok(!d.log.some((l) => l.op !== 'select'), 'doar citiri')
    assert.match(discoveryReport(out), /Artrostop \(2\)/)
    const other = out.find((b) => b.brand.slug === 'alt-brand')!
    assert.deepEqual([other.planable_keywords, other.planable_profiles, other.seomonitor_domains], [[], [], []], 'datele unui client nu ajung la altul')
  })
})

describe('createSets', () => {
  const input = { proenzi: { effective_from: '2026-01-01', note: 'Din datele surselor', members: [{ name: 'Flexamin', domain: 'flexamin.ro', social_handles: ['flexamin.ro'] }, { name: 'Artrostop' }] } }

  test('fără apply: doar arată, nu scrie', async () => {
    const d = db()
    const out = await createSets(d, input, { today: TODAY, apply: false })
    assert.deepEqual(out.map((o) => [o.brand, o.status, o.version]), [['Proenzi', 'dry_run', 1]])
    assert.equal(d.tables.competitor_sets!.length, 0)
  })

  test('cu apply: setul și membrii, în ordinea dată, pe clientul și brandul corecte', async () => {
    const d = db()
    const out = await createSets(d, input, { today: TODAY, apply: true })
    assert.equal(out[0]!.status, 'created')
    const set = d.tables.competitor_sets![0]!
    assert.deepEqual([set.tenant_id, set.brand_id, set.version, set.effective_from, set.note, set.created_by], [T1, B1, 1, '2026-01-01', 'Din datele surselor', null])
    assert.deepEqual(d.tables.competitor_set_members!.map((m) => [m.name, m.sort_order, m.competitor_set_id, m.tenant_id]), [['Flexamin', 0, set.id, T1], ['Artrostop', 1, set.id, T1]])
  })

  test('a doua versiune: de azi înainte, numărul următor', async () => {
    const d = db()
    await createSets(d, input, { today: TODAY, apply: true })
    const again = await createSets(d, input, { today: TODAY, apply: true })
    assert.equal(again[0]!.status, 'invalid', 'a doua versiune nu poate începe în trecut')
    const next = await createSets(d, { proenzi: { ...input.proenzi, effective_from: TODAY } }, { today: TODAY, apply: true })
    assert.deepEqual([next[0]!.status, next[0]!.version], ['created', 2])
  })

  test('membrii nu se pot scrie: setul abia creat se șterge', async () => {
    const d = db()
    d.upsert = async () => {
      throw new Error('HTTP 500')
    }
    await assert.rejects(createSets(d, input, { today: TODAY, apply: true }), /setul a fost anulat/)
    assert.equal(d.tables.competitor_sets!.length, 0)
  })

  test('brand inexistent sau slug nevalid: nimic scris', async () => {
    const d = db()
    const out = await createSets(d, { 'nu-exista': input.proenzi, "x'; drop": input.proenzi }, { today: TODAY, apply: true })
    assert.deepEqual(out.map((o) => o.status), ['not_found', 'not_found'])
    assert.equal(d.tables.competitor_sets!.length, 0)
  })
})
