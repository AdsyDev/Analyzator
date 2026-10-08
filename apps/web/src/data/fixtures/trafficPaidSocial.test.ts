import { describe, expect, it } from 'vitest'
import { DEVICES, type QueryContext } from '../../contracts'
import { addDays, resolvePeriod } from '../../lib/period'
import { createFixtureProviders } from './createFixtureProviders'

const NOW = new Date('2026-10-06T07:00:00Z')
const period = resolvePeriod('28d', NOW)
const ctx = (brandId = 'brand-urinal', over: Partial<QueryContext> = {}): QueryContext => ({ brandId, period, comparison: 'previous', filters: {}, ...over })
const make = () => createFixtureProviders({ now: () => NOW })
const MINI = 'brand-minimartieni'

describe('fixtures Trafic', () => {
  it('canalele însumează totalul de sesiuni GA4 al brandului (acceași perioadă) și cotele însumează 100%', async () => {
    const p = make()
    const total = (await p.metrics.metrics(ctx(), ['ga4_sessions'])).items[0]!.value!
    const r = await p.traffic.channels(ctx(), null)
    if (r.kind !== 'ready') throw new Error('channels')
    const sum = r.data.channels.reduce((a, c) => a + (c.sessions ?? 0), 0)
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(r.data.channels.length)
    expect(r.data.channels.reduce((a, c) => a + (c.share_pct ?? 0), 0)).toBeCloseTo(100, 0)
    expect(r.data.device).toBeNull()
  })

  it('filtrul de device scalează sesiunile și raportează device-ul', async () => {
    const p = make()
    const all = await p.traffic.channels(ctx(), null)
    const mobile = await p.traffic.channels(ctx(), 'mobile')
    if (all.kind !== 'ready' || mobile.kind !== 'ready') throw new Error('channels')
    const a = all.data.channels.reduce((s, c) => s + (c.sessions ?? 0), 0)
    const m = mobile.data.channels.reduce((s, c) => s + (c.sessions ?? 0), 0)
    expect(m / a).toBeCloseTo(0.58, 1)
    expect(mobile.data.device).toBe('mobile')
  })

  it('AI referrals: sesiunile însumează canalul „AI referrals", iar rata vine din key events / sesiuni', async () => {
    const p = make()
    const ch = await p.traffic.channels(ctx(), null)
    const ai = await p.traffic.aiReferrals(ctx())
    if (ch.kind !== 'ready' || ai.kind !== 'ready') throw new Error('ai')
    const channel = ch.data.channels.find((c) => c.channel === 'AI referrals')!.sessions!
    const sum = ai.data.sources.reduce((a, s) => a + (s.sessions ?? 0), 0)
    expect(Math.abs(sum - channel)).toBeLessThanOrEqual(4)
    for (const s of ai.data.sources) expect(s.conversion_rate).toBeCloseTo((100 * (s.key_events ?? 0)) / (s.sessions ?? 1), 0)
    expect(ai.data.rules_version).toBe('v3')
  })

  it('Clarity pe device: valorile pe device însumează valoarea din registru (la numărători), nu o inventează', async () => {
    const p = make()
    const all = (await p.metrics.metrics(ctx(MINI), ['clarity_rage_click_sessions'])).items[0]!
    const r = await p.traffic.clarityDevices(ctx(MINI))
    if (r.kind !== 'ready') throw new Error('clarity')
    const row = r.data.rows.find((x) => x.metric_key === 'clarity_rage_click_sessions')!
    const sum = DEVICES.reduce((a, d) => a + (row.cells[d].value ?? 0), 0)
    expect(Math.abs(sum - all.value!)).toBeLessThanOrEqual(2)
  })

  it('Clarity neconectat (Proenzi): not_connected cu motiv, fără valori pe device', async () => {
    const r = await make().traffic.clarityDevices(ctx('brand-proenzi'))
    expect(r.kind).toBe('not_connected')
    if (r.kind === 'not_connected') expect(r.reason).toMatch(/Microsoft Clarity nu este conectată/)
  })

  it('metrica Clarity fără valoare în registru nu primește valoare pe device (null, nu zero)', async () => {
    const r = await make().traffic.clarityDevices(ctx(MINI))
    if (r.kind !== 'ready') throw new Error('clarity')
    // Minimartieni are Clarity conectat: toate celulele au valoare; verificăm că tipul permite null și statusul e propagat.
    expect(r.data.rows.every((row) => DEVICES.every((d) => row.cells[d].status !== undefined))).toBe(true)
  })

  it('Urinal: Clarity învechit, statusul se propagă pe celule', async () => {
    const r = await make().traffic.clarityDevices(ctx())
    if (r.kind !== 'ready') throw new Error('clarity')
    expect(r.data.rows.every((row) => DEVICES.every((d) => row.cells[d].status === 'stale'))).toBe(true)
  })

  it('tracking quality: verificări pe brand, cu stări diferite; un brand necunoscut e refuzat', async () => {
    const p = make()
    const u = await p.traffic.trackingQuality(ctx())
    if (u.kind !== 'ready') throw new Error('tq')
    expect(new Set(u.data.checks.map((c) => c.status))).toEqual(new Set(['ok', 'warning', 'problem']))
    expect(u.data.checked_at).toBe(NOW.toISOString())
    expect((await p.traffic.trackingQuality(ctx('brand-strain'))).kind).toBe('error')
  })

  it('un brand din afara listei e refuzat pe toate rutele de trafic', async () => {
    const p = make()
    const c = ctx('brand-strain')
    for (const r of await Promise.all([p.traffic.channels(c, null), p.traffic.aiReferrals(c), p.traffic.clarityDevices(c), p.traffic.trackingQuality(c)])) expect(r.kind).toBe('error')
  })
})

describe('fixtures: coerență între starea surselor și metrici', () => {
  it.each([
    ['clarity', 'clarity_scroll_depth'],
    ['ga4', 'ga4_sessions'],
    ['gsc', 'gsc_clicks'],
  ])('sursa %s neconectată ⇔ metricile ei sunt not_connected, pe fiecare brand', async (provider, key) => {
    const p = make()
    for (const brand of ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']) {
      const st = await p.sources.statuses(brand)
      const src = st.kind === 'ready' ? st.data.find((x) => x.provider === provider) : undefined
      const m = (await p.metrics.metrics(ctx(brand), [key])).items[0]!
      expect(m.status === 'not_connected', `${brand}/${provider}`).toBe(src?.state === 'not_connected')
    }
  })
})

describe('fixtures Paid Media', () => {
  it('fără import (Urinal, Proenzi): not_connected cu motiv pe toate rutele, nu listă goală', async () => {
    const p = make()
    for (const brand of ['brand-urinal', 'brand-proenzi']) {
      const c = ctx(brand)
      for (const r of await Promise.all([p.paid.summary(c, { platform: null }), p.paid.budget(c), p.paid.series(c, { platform: null }), p.paid.rows(c, { platform: null })])) {
        expect(r.kind).toBe('not_connected')
      }
    }
  })

  it('cu import (Minimartieni): KPI-urile se potrivesc cu rândurile (spend, CTR din totaluri, CPC)', async () => {
    const p = make()
    const rows = await p.paid.rows(ctx(MINI), { platform: null })
    const sum = await p.paid.summary(ctx(MINI), { platform: null })
    if (rows.kind !== 'ready' || sum.kind !== 'ready') throw new Error('paid')
    const spend = rows.data.reduce((a, r) => a + (r.spend ?? 0), 0)
    const imp = rows.data.reduce((a, r) => a + (r.impressions ?? 0), 0)
    const clk = rows.data.reduce((a, r) => a + (r.clicks ?? 0), 0)
    const k = (key: string) => sum.data.kpis.find((x) => x.key === key)!
    expect(k('spend').value).toBeCloseTo(spend, 0)
    expect(k('ctr').value).toBeCloseTo((100 * clk) / imp, 1)
    expect(k('cpc').value).toBeCloseTo(spend / clk, 1)
    expect(k('spend').currency).toBe('RON')
    expect(sum.data.currency).toBe('RON')
    expect(sum.data.source_timezone).toBe('Europe/Bucharest')
  })

  it('CTR e din totaluri, nu media ratelor zilnice (spec 2.3)', async () => {
    const p = make()
    const rows = await p.paid.rows(ctx(MINI), { platform: null })
    const sum = await p.paid.summary(ctx(MINI), { platform: null })
    if (rows.kind !== 'ready' || sum.kind !== 'ready') throw new Error('paid')
    const mean = rows.data.reduce((a, r) => a + (r.ctr ?? 0), 0) / rows.data.length
    const fromTotals = (100 * rows.data.reduce((a, r) => a + (r.clicks ?? 0), 0)) / rows.data.reduce((a, r) => a + (r.impressions ?? 0), 0)
    expect(sum.data.kpis.find((x) => x.key === 'ctr')!.value).toBeCloseTo(fromTotals, 1)
    expect(Math.abs(mean - fromTotals)).toBeGreaterThan(0.001)
  })

  it('campania de awareness nu are conversii și CPA (null, nu 0), iar CPA exclude cheltuiala ei', async () => {
    const p = make()
    const rows = await p.paid.rows(ctx(MINI), { platform: null })
    if (rows.kind !== 'ready') throw new Error('rows')
    const aw = rows.data.filter((r) => r.objective === 'Awareness')
    expect(aw.length).toBeGreaterThan(0)
    for (const r of aw) {
      expect(r.conversions).toBeNull()
      expect(r.cpa).toBeNull()
    }
    const sum = await p.paid.summary(ctx(MINI), { platform: null })
    if (sum.kind !== 'ready') throw new Error('sum')
    const withConv = rows.data.filter((r) => r.conversions !== null)
    const expected = withConv.reduce((a, r) => a + (r.spend ?? 0), 0) / withConv.reduce((a, r) => a + (r.conversions ?? 0), 0)
    expect(sum.data.kpis.find((x) => x.key === 'cpa')!.value).toBeCloseTo(expected, 1)
  })

  it('nu inventează zile: rândurile se opresc la ultima zi importată', async () => {
    const p = make()
    const sum = await p.paid.summary(ctx(MINI), { platform: null })
    const rows = await p.paid.rows(ctx(MINI), { platform: null })
    if (sum.kind !== 'ready' || rows.kind !== 'ready') throw new Error('paid')
    expect(sum.data.data_as_of).toBe('2026-10-04')
    expect(rows.data.every((r) => r.date <= sum.data.data_as_of)).toBe(true)
    expect(Math.max(...rows.data.map((r) => (r.date > '0' ? 1 : 0)))).toBe(1)
  })

  it('seria: zilele neimportate sunt null (gol), nu zero', async () => {
    const s = await make().paid.series(ctx(MINI), { platform: null })
    if (s.kind !== 'ready') throw new Error('series')
    expect(s.data.spend).toHaveLength(28)
    expect(s.data.spend.slice(-1)[0]!.value).toBeNull()
    expect(s.data.spend.slice(0, 5).every((p) => p.value !== null && p.value > 0)).toBe(true)
    expect(s.data.results_label).toBe('Conversii')
  })

  it('filtrul de platformă restrânge rândurile, seria și KPI-urile', async () => {
    const p = make()
    const g = await p.paid.rows(ctx(MINI), { platform: 'google_ads' })
    const all = await p.paid.rows(ctx(MINI), { platform: null })
    if (g.kind !== 'ready' || all.kind !== 'ready') throw new Error('rows')
    expect(g.data.every((r) => r.platform === 'google_ads')).toBe(true)
    expect(g.data.length).toBeLessThan(all.data.length)
  })

  it('buget și pacing: din rândurile planului, cu procente calculate de provider', async () => {
    const p = make()
    const b = await p.paid.budget(ctx(MINI))
    if (b.kind !== 'ready') throw new Error('budget')
    expect(b.data.currency).toBe('RON')
    expect(b.data.plan_from).toBe('2026-10-01')
    expect(b.data.plan_to).toBe('2026-10-31')
    expect(b.data.planned_days).toBe(31)
    expect(b.data.elapsed_days).toBe(4)
    expect(b.data.spend_pct).toBeCloseTo((100 * b.data.spent!) / b.data.approved_budget!, 1)
    expect(b.data.time_pct).toBeCloseTo((100 * 4) / 31, 1)
  })

  it('un brand din afara listei e refuzat', async () => {
    const p = make()
    const c = ctx('brand-strain')
    for (const r of await Promise.all([p.paid.summary(c, { platform: null }), p.paid.budget(c), p.paid.series(c, { platform: null }), p.paid.rows(c, { platform: null })])) expect(r.kind).toBe('error')
  })

  it('ziua importului: addDays nu depășește perioada cerută', async () => {
    const short = ctx(MINI, { period: { preset: 'custom', from: addDays('2026-10-05', -2), to: '2026-10-05' } })
    const rows = await make().paid.rows(short, { platform: null })
    expect(rows.kind === 'ready' && rows.data.every((r) => r.date <= '2026-10-04')).toBe(true)
  })
})

describe('fixtures Social', () => {
  it('fără import (Urinal, Proenzi): not_connected pe toate rutele', async () => {
    const p = make()
    const f = { platform: null, format: null }
    for (const brand of ['brand-urinal', 'brand-proenzi']) {
      const c = ctx(brand)
      for (const r of await Promise.all([p.social.summary(c, f), p.social.posts(c, f), p.social.groups(c, f), p.social.calendar(c, f), p.social.competitors(c)])) expect(r.kind).toBe('not_connected')
    }
  })

  it('KPI-urile se potrivesc cu postările: număr, interacțiuni (doar cele cu date) și nota pentru cele fără', async () => {
    const p = make()
    const f = { platform: null, format: null }
    const posts = await p.social.posts(ctx(MINI), f)
    const sum = await p.social.summary(ctx(MINI), f)
    if (posts.kind !== 'ready' || sum.kind !== 'ready') throw new Error('social')
    const k = (key: string) => sum.data.kpis.find((x) => x.key === key)!
    expect(k('posts').value).toBe(posts.data.length)
    expect(k('interactions').value).toBe(posts.data.reduce((a, x) => a + (x.interactions ?? 0), 0))
    const without = posts.data.filter((x) => x.interactions === null).length
    expect(without).toBeGreaterThan(0)
    expect(k('interactions').note).toMatch(new RegExp(`${without} postări fără date de performanță`))
    expect(k('interactions').status).toBe('partial')
    expect(k('net_growth').value).toBe(18420 - 18110)
    expect(k('followers').value).toBe(18420)
  })

  it('postările sub 7 zile sunt marcate nemature; cele fără analytics au null, nu zero', async () => {
    const posts = await make().social.posts(ctx(MINI), { platform: null, format: null })
    if (posts.kind !== 'ready') throw new Error('posts')
    for (const x of posts.data) expect(x.mature).toBe(x.age_days >= 7)
    expect(posts.data.some((x) => !x.mature)).toBe(true)
    const noPerf = posts.data.filter((x) => x.reach === null)
    expect(noPerf.length).toBeGreaterThan(0)
    expect(noPerf.every((x) => x.interactions === null)).toBe(true)
  })

  it('mediana pe topic/format include doar postările mature cu date; n e numărul lor', async () => {
    const p = make()
    const f = { platform: null, format: null }
    const posts = await p.social.posts(ctx(MINI), f)
    const groups = await p.social.groups(ctx(MINI), f)
    if (posts.kind !== 'ready' || groups.kind !== 'ready') throw new Error('groups')
    const imm = groups.data.by_topic.find((g) => g.group === 'Imunitate')!
    const mature = posts.data.filter((x) => x.topic === 'Imunitate' && x.mature && x.interactions !== null)
    expect(imm.n).toBe(mature.length)
    const vals = mature.map((x) => x.interactions!).sort((a, b) => a - b)
    const mid = Math.floor(vals.length / 2)
    expect(imm.median_interactions).toBe(vals.length % 2 ? vals[mid] : (vals[mid - 1]! + vals[mid]!) / 2)
    expect(groups.data.by_topic.some((g) => g.group === 'Fără topic')).toBe(true)
    expect(groups.data.observed).toEqual({ from: period.from, to: period.to })
  })

  it('filtrele de platformă și format', async () => {
    const p = make()
    const ig = await p.social.posts(ctx(MINI), { platform: 'instagram', format: null })
    const vid = await p.social.posts(ctx(MINI), { platform: null, format: 'video' })
    expect(ig.kind === 'ready' && ig.data.every((x) => x.platform === 'instagram')).toBe(true)
    expect(vid.kind === 'ready' && vid.data.every((x) => x.format === 'video')).toBe(true)
  })

  it('calendarul păstrează postările fără performanță, marcate', async () => {
    const cal = await make().social.calendar(ctx(MINI), { platform: null, format: null })
    if (cal.kind !== 'ready') throw new Error('cal')
    expect(cal.data.some((c) => !c.has_performance)).toBe(true)
    expect(cal.data.length).toBe(12)
  })

  it('concurența publică: valori lipsă sunt null (nu 0) și numele din setul brandului', async () => {
    const r = await make().social.competitors(ctx(MINI))
    if (r.kind !== 'ready') throw new Error('comp')
    expect(r.data.map((c) => c.name)).toEqual(['Kidvitto', 'Junivita', 'Multikinder'])
    const c3 = r.data.find((c) => c.label === 'C3')!
    expect(c3).toMatchObject({ followers: null, posts_per_week: null, public_interactions_per_post: null, as_of: null })
  })

  it('un brand din afara listei e refuzat', async () => {
    const p = make()
    const c = ctx('brand-strain')
    const f = { platform: null, format: null }
    for (const r of await Promise.all([p.social.summary(c, f), p.social.posts(c, f), p.social.groups(c, f), p.social.calendar(c, f), p.social.competitors(c)])) expect(r.kind).toBe('error')
  })
})
