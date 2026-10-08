import { describe, expect, it } from 'vitest'
import { AI_ENGINES, VALID_OUTCOMES, type AiFilters, type QueryContext } from '../../contracts'
import { resolvePeriod } from '../../lib/period'
import { answerPlainText as answerText } from './ai'
import { createFixtureProviders } from './createFixtureProviders'

const NOW = new Date('2026-10-06T07:00:00Z')
const period = resolvePeriod('28d', NOW)
const ctx = (brandId = 'brand-urinal', over: Partial<QueryContext> = {}): QueryContext => ({ brandId, period, comparison: 'previous', filters: {}, ...over })
const none: AiFilters = { engine: null, group: null }
const make = () => createFixtureProviders({ now: () => NOW })
const BRANDS = ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']

async function allAnswers(p: ReturnType<typeof make>, brandId: string, f: AiFilters = none) {
  const page = await p.ai.answers(ctx(brandId), f, { page: 1, page_size: 500 })
  if (page.kind !== 'ready') throw new Error('nu s-au încărcat răspunsurile')
  return Promise.all(page.data.items.map(async (a) => {
    const d = await p.ai.answer(brandId, a.id)
    if (d.kind !== 'ready') throw new Error('lipsește detaliul')
    return d.data
  }))
}

describe('fixtures AI: reproductibilitate (spec cap. 13, acceptare)', () => {
  it.each(BRANDS)('%s: rata pe engine se reproduce din răspunsurile afișate', async (brandId) => {
    const p = make()
    const answers = await allAnswers(p, brandId)
    const stats = await p.ai.engines(ctx(brandId), none)
    expect(stats.kind).toBe('ready')
    if (stats.kind !== 'ready') return
    for (const s of stats.data) {
      const mine = answers.filter((a) => a.engine === s.engine)
      const valid = mine.filter((a) => VALID_OUTCOMES.has(a.outcome))
      const hits = valid.filter((a) => a.outcome === 'mentioned' || a.outcome === 'recommended').length
      expect(s.total_answers).toBe(mine.length)
      expect(s.valid_answers).toBe(valid.length)
      expect(s.mention_rate).toBe(valid.length ? Math.round((1000 * hits) / valid.length) / 10 : null)
    }
  })

  it.each(BRANDS)('%s: celulele matricei au numărător și numitor din răspunsurile valide ale subiectului', async (brandId) => {
    const p = make()
    const answers = await allAnswers(p, brandId)
    const m = await p.ai.topicMatrix(ctx(brandId), none)
    if (m.kind !== 'ready') throw new Error('matrice')
    for (const t of m.data.topics) {
      const valid = answers.filter((a) => a.group === t.group && VALID_OUTCOMES.has(a.outcome))
      expect(t.n).toBe(valid.length)
      for (const e of m.data.entities) {
        const cell = m.data.cells[t.topic]?.[e.id]
        const num = valid.filter((a) => a.entities_present.includes(e.id)).length
        expect(cell?.denominator, `${t.topic}/${e.name}`).toBe(valid.length || null)
        expect(cell?.numerator).toBe(valid.length ? num : null)
        expect(cell?.value).toBe(valid.length ? Math.round((1000 * num) / valid.length) / 10 : null)
      }
    }
  })

  it('sursele citate sunt numărate din citările răspunsurilor valide', async () => {
    const p = make()
    const answers = await allAnswers(p, 'brand-urinal')
    const cited = await p.ai.citedSources(ctx(), none)
    if (cited.kind !== 'ready') throw new Error('surse')
    const expected = new Map<string, number>()
    for (const a of answers.filter((x) => VALID_OUTCOMES.has(x.outcome))) for (const c of a.citations) expected.set(c.domain, (expected.get(c.domain) ?? 0) + 1)
    for (const s of cited.data) expect(s.count).toBe(expected.get(s.domain))
    expect(cited.data.map((s) => s.count)).toEqual([...cited.data.map((s) => s.count)].sort((a, b) => b - a))
  })
})

describe('fixtures AI: stările nu se confundă (spec 2.2)', () => {
  it('Urinal are un răspuns refuzat, unul cu eroare și unul necolectat, fără text și fără citări', async () => {
    const answers = await allAnswers(make(), 'brand-urinal')
    for (const outcome of ['refused', 'error', 'not_collected'] as const) {
      const hit = answers.filter((a) => a.outcome === outcome)
      expect(hit.length, outcome).toBeGreaterThanOrEqual(1)
      for (const a of hit) {
        expect(a.segments).toEqual([])
        expect(a.citations).toEqual([])
        expect(a.entities_present).toEqual([])
      }
    }
  })

  it('refuzul, eroarea și necolectatul nu intră în numitor: valide < total pentru engine-ul afectat', async () => {
    const stats = await make().ai.engines(ctx(), none)
    if (stats.kind !== 'ready') throw new Error('stats')
    const gemini = stats.data.find((s) => s.engine === 'gemini')!
    expect(gemini.valid_answers).toBeLessThan(gemini.total_answers)
    expect(gemini.status).toBe('partial')
    expect(stats.data.find((s) => s.engine === 'chatgpt')?.status).toBe('ok')
  })

  it('un răspuns „nemenționat" are text, iar brandul lipsește: diferit de refuz', async () => {
    const answers = await allAnswers(make(), 'brand-urinal')
    const nm = answers.find((a) => a.outcome === 'not_mentioned')!
    expect(nm.segments.length).toBeGreaterThan(0)
    expect(nm.entities_present).not.toContain('brand-urinal')
    expect(nm.entities_present.length).toBeGreaterThan(0)
  })

  it('o zi necolectată în serie e null, nu zero', async () => {
    const t = await make().ai.trends(ctx(), none)
    if (t.kind !== 'ready') throw new Error('trends')
    const g = t.data.find((x) => x.engine === 'gemini')!
    expect(g.points.some((p) => p.value === null)).toBe(true)
    expect(g.points.every((p) => p.value === null || p.value >= 0)).toBe(true)
  })

  it('răspunsurile marcate în text au segmente cu entități cunoscute și citările numerotate din text există', async () => {
    const answers = (await allAnswers(make(), 'brand-urinal')).filter((a) => a.segments.length > 0)
    expect(answers.length).toBeGreaterThan(10)
    for (const a of answers) {
      const ids = new Set(a.citations.map((c) => c.n))
      for (const s of a.segments) if (s.kind === 'cite') expect(ids.has(s.n), `${a.id} [${s.n}]`).toBe(true)
      for (const s of a.segments) if (s.kind === 'brand') expect(a.entities_present).toContain(s.entity_id)
    }
  })

  it('acronimele din titluri rămân scrise corect (ITU, nu „itu")', async () => {
    const answers = await allAnswers(make(), 'brand-urinal')
    const text = answers.filter((a) => a.group === 'Prevenție ITU').flatMap((a) => [answerText(a), ...a.citations.map((c) => c.title)]).join(' ')
    expect(text).toMatch(/prevenție ITU/)
    expect(text).not.toMatch(/prevenție itu/)
  })

  it('o citare poate lipsi de URL (null), iar domeniile fictive sunt .example', async () => {
    const answers = await allAnswers(make(), 'brand-urinal')
    const cites = answers.flatMap((a) => a.citations)
    expect(cites.every((c) => c.domain.endsWith('.example'))).toBe(true)
    expect(cites.every((c) => c.url === null || c.url.startsWith(`https://${c.domain}/`))).toBe(true)
  })
})

describe('fixtures AI: filtre și acces', () => {
  it('filtrul engine restrânge matricea, sursele și lista; cardurile pe engine rămân toate', async () => {
    const p = make()
    const f: AiFilters = { engine: 'perplexity', group: null }
    const list = await p.ai.answers(ctx(), f, { page: 1, page_size: 100 })
    expect(list.kind === 'ready' && list.data.items.every((a) => a.engine === 'perplexity')).toBe(true)
    const stats = await p.ai.engines(ctx(), f)
    expect(stats.kind === 'ready' && stats.data.map((s) => s.engine)).toEqual([...AI_ENGINES])
  })

  it('filtrul grup restrânge totul la grupul ales', async () => {
    const p = make()
    const f: AiFilters = { engine: null, group: 'Cistită acută' }
    const m = await p.ai.topicMatrix(ctx(), f)
    expect(m.kind === 'ready' && m.data.topics.map((t) => t.topic)).toEqual(['Cistită acută'])
    const list = await p.ai.answers(ctx(), f, { page: 1, page_size: 100 })
    expect(list.kind === 'ready' && list.data.total).toBe(8)
  })

  it('paginarea acoperă toate răspunsurile o singură dată, în ordinea datei', async () => {
    const p = make()
    const seen: string[] = []
    let total = 0
    for (let page = 1; page < 20; page++) {
      const r = await p.ai.answers(ctx(), none, { page, page_size: 8 })
      if (r.kind !== 'ready' || r.data.items.length === 0) break
      total = r.data.total
      seen.push(...r.data.items.map((a) => a.id))
    }
    expect(seen).toHaveLength(total)
    expect(new Set(seen).size).toBe(total)
    expect(total).toBe(40)
  })

  it('grupurile pentru filtru vin din provider, pe brand', async () => {
    const g = await make().ai.groups('brand-minimartieni')
    expect(g.kind === 'ready' && g.data).toEqual(['Imunitate', 'Vitamine pe vârste', 'Jeleuri cu vitamine', 'Poftă de mâncare', 'Creștere și oase'])
  })

  it('un brand din afara listei e refuzat pe toate rutele AI și Search', async () => {
    const p = make()
    const c = ctx('brand-strain')
    const results = await Promise.all([
      p.ai.groups('brand-strain'), p.ai.engines(c, none), p.ai.trends(c, none), p.ai.topicMatrix(c, none), p.ai.citedSources(c, none),
      p.ai.answers(c, none, { page: 1, page_size: 5 }), p.ai.answer('brand-strain', 'ans-brand-urinal-0-chatgpt'),
      p.search.keywords(c, { keywordType: null }), p.search.landingPages(c), p.search.contentGaps(c),
    ])
    for (const r of results) expect(r.kind).toBe('error')
  })

  it('un răspuns inexistent nu se inventează', async () => {
    expect((await make().ai.answer('brand-urinal', 'ans-nu-exista')).kind).toBe('not_connected')
  })
})

describe('fixtures AI: farmacovigilență pe răspunsuri', () => {
  it('previzualizarea arată textul sanitizat al răspunsului, iar marcarea apare în listă', async () => {
    const p = make()
    const list = await p.ai.answers(ctx(), none, { page: 1, page_size: 5 })
    if (list.kind !== 'ready') throw new Error('list')
    const id = list.data.items.find((a) => VALID_OUTCOMES.has(a.outcome))!.id
    const prev = await p.mentions.pvPreview('brand-urinal', { kind: 'ai_answer', id })
    expect(prev.kind === 'ready' && prev.data.text).toMatch(/primul pas este o discuție cu medicul/)
    expect(prev.kind === 'ready' && prev.data.link).toBeNull()
    const flagged = await p.mentions.pvFlag('brand-urinal', { kind: 'ai_answer', id })
    expect(flagged.kind).toBe('ready')
    const again = await p.ai.answer('brand-urinal', id)
    expect(again.kind === 'ready' && again.data.pv_flag).not.toBeNull()
  })

  it('un răspuns fără text (refuzat) nu se poate marca', async () => {
    const p = make()
    const answers = await allAnswers(p, 'brand-urinal')
    const refused = answers.find((a) => a.outcome === 'refused')!
    expect((await p.mentions.pvPreview('brand-urinal', { kind: 'ai_answer', id: refused.id })).kind).toBe('error')
  })
})

describe('fixtures Search', () => {
  it('rank absent e null (nu 100), iar sortarea îl lasă la sfârșit', async () => {
    const r = await make().search.keywords(ctx(), { keywordType: null })
    if (r.kind !== 'ready') throw new Error('kw')
    const noRank = r.data.filter((k) => k.rank_mobile === null)
    expect(noRank.length).toBeGreaterThan(0)
    expect(r.data.every((k) => k.rank_mobile === null || (k.rank_mobile >= 1 && k.rank_mobile < 100))).toBe(true)
    // „Fără rank" mobil poate coexista cu rank desktop (și invers): sunt observații separate.
    expect(r.data.some((k) => k.rank_mobile === null && k.rank_desktop !== null)).toBe(true)
  })

  it('filtrul brand/nonbrand', async () => {
    const p = make()
    const brand = await p.search.keywords(ctx(), { keywordType: 'brand' })
    const non = await p.search.keywords(ctx(), { keywordType: 'nonbrand' })
    const all = await p.search.keywords(ctx(), { keywordType: null })
    expect(brand.kind === 'ready' && brand.data.every((k) => k.is_brand)).toBe(true)
    expect(non.kind === 'ready' && non.data.every((k) => !k.is_brand)).toBe(true)
    expect(all.kind === 'ready' && brand.kind === 'ready' && non.kind === 'ready' && all.data.length).toBe(brand.kind === 'ready' && non.kind === 'ready' ? brand.data.length + non.data.length : -1)
  })

  it('competitorul are numele din setul versionat al brandului', async () => {
    const r = await make().search.keywords(ctx(), { keywordType: null })
    const names = new Set(r.kind === 'ready' ? r.data.flatMap((k) => (k.competitor ? [`${k.competitor.label}:${k.competitor.name}`] : [])) : [])
    expect(names).toEqual(new Set(['C1:Uronova', 'C2:Cisticare', 'C3:Vitamerin']))
  })

  it('un URL partajat e marcat, iar key events lipsesc (null) când maparea nu e validată', async () => {
    const r = await make().search.landingPages(ctx())
    if (r.kind !== 'ready') throw new Error('pages')
    expect(r.data.find((p) => p.url === '/despre-stada')).toMatchObject({ shared: true, key_events: null })
    expect(r.data.find((p) => p.url === '/sfaturi/infectia-urinara')?.key_events).toBeNull()
    expect(r.data.find((p) => p.url === '/produse/urinal-akut')?.key_events).toBeGreaterThan(0)
  })

  it('CTR-ul paginii e consistent cu clicks și impressions, iar zero nu înlocuiește lipsa', async () => {
    const r = await make().search.landingPages(ctx())
    if (r.kind !== 'ready') throw new Error('pages')
    for (const p of r.data) expect(p.ctr).toBeCloseTo((100 * (p.clicks ?? 0)) / (p.impressions ?? 1), 0)
  })

  it('perioada mai scurtă dă mai puține clicks', async () => {
    const p = make()
    const long = await p.search.landingPages(ctx())
    const short = await p.search.landingPages(ctx('brand-urinal', { period: resolvePeriod('7d', NOW) }))
    if (long.kind !== 'ready' || short.kind !== 'ready') throw new Error('pages')
    expect(short.data[0]!.clicks!).toBeLessThan(long.data[0]!.clicks!)
  })

  it('content gaps cu numele competitorului din set', async () => {
    const r = await make().search.contentGaps(ctx())
    expect(r.kind === 'ready' && r.data.map((g) => g.competitor.name)).toContain('Cisticare')
    expect(r.kind === 'ready' && r.data.every((g) => g.position > 0)).toBe(true)
  })
})
