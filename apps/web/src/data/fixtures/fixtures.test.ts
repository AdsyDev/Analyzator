import { describe, expect, it } from 'vitest'
import { META_FIELDS, METRIC_FIELDS } from '@analytics/contracts/metric-response'
import { METRIC_STATUSES, type MetricItem, type MetricStatus, type QueryContext } from '../../contracts'
import { resolvePeriod } from '../../lib/period'
import { createFixtureProviders } from './createFixtureProviders'

const NOW = new Date('2026-10-06T07:00:00Z')
const period = resolvePeriod('28d', NOW)
const ctx = (brandId: string, over: Partial<QueryContext> = {}): QueryContext => ({ brandId, period, comparison: 'previous', filters: {}, ...over })
const make = (role: 'strategist' | 'client_viewer' = 'strategist') => createFixtureProviders({ now: () => NOW, getRole: () => role })
const BRANDS = ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']

// Chei pe ecran. Cheile din afara registrului (ai_*, paid_*, listening_*, social_*) nu au date fictive:
// primesc `not_connected`, ca providerul real.
const ABSENT = ['ai_mention_rate', 'paid_spend', 'listening_mentions', 'social_reach']
const SCREENS: Record<string, string[]> = {
  overview: ['gsc_clicks', 'ga4_sessions', 'ga4_key_events', 'ai_mention_rate', 'paid_spend', 'listening_mentions'],
  seo: ['gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position', 'seomonitor_keywords_top3', 'seomonitor_keywords_top10', 'seomonitor_visibility', 'seomonitor_visibility_latest'],
  traffic: ['ga4_sessions', 'ga4_engaged_sessions', 'ga4_key_events', 'ga4_active_users', 'clarity_rage_click_sessions', 'clarity_dead_click_sessions', 'clarity_quickback_sessions', 'clarity_scroll_depth'],
}
const REGISTRY_KEYS = [...new Set(Object.values(SCREENS).flat())].filter((k) => !ABSENT.includes(k))

describe('fixtures: forma contractului', () => {
  it('fiecare metrică are exact câmpurile contractului plus cele trei alipiri UI (diferențe documentate)', async () => {
    const { items } = await make().metrics.metrics(ctx('brand-urinal'), REGISTRY_KEYS)
    for (const m of items) {
      const keys = Object.keys(m).sort()
      expect(keys, m.metric_key).toEqual([...METRIC_FIELDS, 'metric_key', 'source', 'warnings'].sort())
    }
  })

  it('meta are exact câmpurile din contract', async () => {
    const { meta } = await make().metrics.metrics(ctx('brand-urinal'), REGISTRY_KEYS)
    expect(Object.keys(meta ?? {}).sort()).toEqual([...META_FIELDS].sort())
  })

  it('toate metricile trec prin parserul real; statusurile, acoperirea și cheia dovezii respectă contractul', async () => {
    const p = make()
    for (const brand of BRANDS) {
      const { items, meta } = await p.metrics.metrics(ctx(brand), REGISTRY_KEYS)
      expect(items.map((m) => m.metric_key)).toEqual(REGISTRY_KEYS)
      expect(meta?.brand_id).toBe(brand)
      expect(typeof meta?.tenant_id).toBe('string')
      for (const m of items) {
        expect(METRIC_STATUSES).toContain(m.status)
        expect(m.evidence_query.brand_id).toBe(brand)
        expect(m.source).not.toBeNull()
        if (m.coverage !== null) {
          expect(m.coverage).toBeGreaterThanOrEqual(0)
          expect(m.coverage).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('e determinist: aceleași cereri dau aceleași valori', async () => {
    const a = await make().metrics.metrics(ctx('brand-urinal'), SCREENS.overview!)
    const b = await make().metrics.metrics(ctx('brand-urinal'), SCREENS.overview!)
    expect(a.items).toEqual(b.items)
  })

  it('valorile diferă între branduri și între perioade', async () => {
    const p = make()
    const u = (await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])).items[0]!
    const m = (await p.metrics.metrics(ctx('brand-minimartieni'), ['ga4_sessions'])).items[0]!
    const w = (await p.metrics.metrics(ctx('brand-urinal', { period: resolvePeriod('7d', NOW) }), ['ga4_sessions'])).items[0]!
    expect(u.value).not.toBe(m.value)
    expect(u.value).not.toBe(w.value)
  })
})

describe('fixtures: cheile din afara registrului', () => {
  it.each(ABSENT)('%s: not_connected, fără valori, variații sau acoperire (nu 0, nu inventat)', async (key) => {
    for (const brand of BRANDS) {
      const m = (await make().metrics.metrics(ctx(brand), [key])).items[0]!
      expect(m.status).toBe('not_connected')
      expect(m.value).toBeNull()
      expect(m.comparison_value).toBeNull()
      expect(m.absolute_change).toBeNull()
      expect(m.relative_change).toBeNull()
      expect(m.coverage).toBeNull()
      expect(m.source).toBeNull()
    }
  })

  it('nu au definiție în registru și nici seria nu are puncte', async () => {
    const p = make()
    const defs = await p.metrics.definitions(ABSENT)
    expect(defs.kind === 'ready' && defs.data).toEqual([])
    for (const s of await p.metrics.trends(ctx('brand-urinal'), ABSENT)) {
      expect(s.points).toEqual([])
      expect(s.status).toBe('not_connected')
    }
  })

  it('dovada lor e not_connected, nu o listă goală', async () => {
    const p = make()
    const { items } = await p.metrics.metrics(ctx('brand-urinal'), ['paid_spend'])
    expect((await p.metrics.evidence('brand-urinal', items[0]!.evidence_query)).kind).toBe('not_connected')
  })
})

describe('fixtures: acoperirea stărilor', () => {
  it('Urinal are partial, stale și not_connected pe Overview, SEO și Trafic', async () => {
    const p = make()
    for (const [screen, keys] of Object.entries(SCREENS)) {
      const { items } = await p.metrics.metrics(ctx('brand-urinal'), keys)
      const statuses = new Set(items.map((m) => m.status))
      for (const s of ['partial', 'stale', 'not_connected'] as const) expect(statuses, `ecranul ${screen}, ${s}`).toContain(s)
    }
  })

  it('toate cele opt statusuri apar undeva în previzualizare', async () => {
    const p = make()
    const seen = new Set<MetricStatus>()
    for (const brand of BRANDS) for (const m of (await p.metrics.metrics(ctx(brand), REGISTRY_KEYS)).items) seen.add(m.status)
    expect([...METRIC_STATUSES].filter((s) => !seen.has(s))).toEqual([])
  })

  it('variațiile merg în ambele direcții', async () => {
    const p = make()
    const all: MetricItem[] = []
    for (const brand of BRANDS) all.push(...(await p.metrics.metrics(ctx(brand), REGISTRY_KEYS)).items)
    const changes = all.map((m) => m.relative_change).filter((c): c is number => c !== null)
    expect(changes.some((c) => c > 0)).toBe(true)
    expect(changes.some((c) => c < 0)).toBe(true)
  })

  it('partial cu zero neconfirmat: value null, nu 0', async () => {
    const m = (await make().metrics.metrics(ctx('brand-minimartieni'), ['clarity_dead_click_sessions'])).items[0]!
    expect(m.status).toBe('partial')
    expect(m.value).toBeNull()
    expect(m.warnings.map((w) => w.code)).toContain('zero_not_confirmed')
  })

  it('stale: data_as_of rămâne în urma perioadei, cu condiția secundară „partial"', async () => {
    const m = (await make().metrics.metrics(ctx('brand-urinal'), ['ga4_key_events'])).items[0]!
    expect(m.status).toBe('stale')
    expect(m.data_as_of).toBe('2026-10-02')
    expect(m.warnings.map((w) => w.code)).toContain('partial')
  })

  it('base_zero: bază de comparație 0, fără variație relativă', async () => {
    const m = (await make().metrics.metrics(ctx('brand-proenzi'), ['seomonitor_keywords_top3'])).items[0]!
    expect(m.status).toBe('base_zero')
    expect(m.comparison_value).toBe(0)
    expect(m.relative_change).toBeNull()
    expect(m.value).not.toBeNull()
  })

  it('insufficient_sample: valoare prezentă, marcată', async () => {
    const m = (await make().metrics.metrics(ctx('brand-proenzi'), ['ga4_key_events'])).items[0]!
    expect(m.status).toBe('insufficient_sample')
    expect(m.value).not.toBeNull()
  })

  it('cannot_compute și unavailable nu au valoare și au avertismentul serverului', async () => {
    const p = make()
    const c = (await p.metrics.metrics(ctx('brand-proenzi'), ['gsc_ctr'])).items[0]!
    expect(c.status).toBe('cannot_compute')
    expect(c.value).toBeNull()
    expect(c.warnings.map((w) => w.code)).toContain('zero_denominator')
    const u = (await p.metrics.metrics(ctx('brand-minimartieni'), ['gsc_average_position'])).items[0]!
    expect(u.status).toBe('unavailable')
    expect(u.warnings.map((w) => w.code)).toContain('query_failed')
  })

  it('luna curentă (MTD) are comparația ca la server și nota „perioadă incompletă"', async () => {
    const { items, meta } = await make().metrics.metrics(ctx('brand-urinal', { period: resolvePeriod('month', NOW) }), ['ga4_sessions'])
    expect(meta?.comparison_period).toEqual({ start: '2026-09-01', end: '2026-09-05' })
    expect(items[0]?.warnings.map((w) => w.code)).toContain('incomplete_period')
  })
})

describe('fixtures: serii și dovezi', () => {
  it('zilele fără date sunt null în serie, nu zero', async () => {
    const [partial] = await make().metrics.trends(ctx('brand-urinal'), ['gsc_clicks'])
    expect(partial?.points).toHaveLength(28)
    expect(partial?.points.some((p) => p.value === null)).toBe(true)
    expect(partial?.points.every((p) => p.value === null || p.value > 0)).toBe(true)
  })

  it('seria are comparație aliniată pe aceeași lungime', async () => {
    const [s] = await make().metrics.trends(ctx('brand-urinal'), ['ga4_sessions'])
    expect(s?.comparison_points).toHaveLength(28)
  })

  it('dovada se rezolvă din cheia metricii și poartă importul și hash-ul', async () => {
    const p = make()
    const { items } = await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])
    const r = await p.metrics.evidence('brand-urinal', items[0]!.evidence_query)
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') {
      expect(r.data.records).toHaveLength(10)
      expect(r.data.total_records).toBe(28)
      expect(r.data.payload_hash).toMatch(/^[0-9a-f]{32}$/)
      expect(r.data.imported_at).not.toBeNull()
    }
  })

  it('definițiile includ calificativul și starea draft ale metricilor din registru', async () => {
    const r = await make().metrics.definitions(['seomonitor_visibility', 'ga4_sessions'])
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') {
      const v = r.data.find((d) => d.metric_key === 'seomonitor_visibility')!
      expect(v.lifecycle).toBe('draft')
      expect(v.aggregation_label).toBe('medie în perioadă')
      expect(r.data.find((d) => d.metric_key === 'gsc_average_position')).toBeUndefined()
    }
  })
})

describe('fixtures: acces și roluri', () => {
  it('un brand din afara listei e refuzat, nu ghicit', async () => {
    const p = make()
    expect((await p.sources.statuses('brand-strain')).kind).toBe('error')
    expect((await p.brands.competitorSet('brand-strain')).kind).toBe('error')
    expect((await p.insights.list(ctx('brand-strain'))).kind).toBe('error')
    const { items } = await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])
    expect((await p.metrics.evidence('brand-strain', items[0]!.evidence_query)).kind).toBe('error')
  })

  it('agenția vede toate statusurile analizelor, clientul doar pe cele publicate', async () => {
    const agency = await make('strategist').insights.list(ctx('brand-urinal'))
    const client = await make('client_viewer').insights.list(ctx('brand-urinal'))
    expect(agency.kind === 'ready' && new Set(agency.data.map((i) => i.status))).toEqual(new Set(['published', 'in_review', 'draft', 'superseded']))
    expect(client.kind === 'ready' && client.data.every((i) => i.status === 'published')).toBe(true)
    expect(client.kind === 'ready' && client.data.length).toBe(1)
  })

  it('clientul nu vede conexiunile, credențialele sau jurnalul PV', async () => {
    const p = make('client_viewer')
    expect((await p.sources.connections('brand-urinal')).kind).toBe('error')
    expect((await p.mentions.pvLog(ctx('brand-urinal'))).kind).toBe('error')
  })

  it('agenția vede conexiunile cu bugetul zilnic de 10 apeluri și tokenul niciodată', async () => {
    const r = await make().sources.connections('brand-urinal')
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') {
      expect(r.data.every((c) => c.daily_call_budget === 10)).toBe(true)
      expect(JSON.stringify(r.data)).not.toMatch(/token":/i)
    }
  })

  it('lista de branduri conține cele trei branduri ale pilotului, cu domenii .example', async () => {
    const r = await make().brands.list()
    expect(r.kind === 'ready' && r.data.map((b) => b.name)).toEqual(['Urinal', 'Minimartieni', 'Proenzi'])
    expect(r.kind === 'ready' && r.data.every((b) => b.domain?.endsWith('.example'))).toBe(true)
  })
})

describe('fixtures: surse și mențiuni', () => {
  it('Urinal: SourceStatus acoperă conectat, parțial, învechit, eroare și neconectat', async () => {
    const r = await make().sources.statuses('brand-urinal')
    expect(r.kind === 'ready' && new Set(r.data.map((s) => s.state))).toEqual(new Set(['connected', 'partial', 'stale', 'error', 'not_connected']))
  })

  it('sursa neconectată nu are date, importul sau notă', async () => {
    const r = await make().sources.statuses('brand-urinal')
    const planable = r.kind === 'ready' ? r.data.find((s) => s.provider === 'planable') : null
    expect(planable).toMatchObject({ state: 'not_connected', data_as_of: null, imported_at: null })
  })

  it('mențiunile se filtrează pe sentiment și sursă și se paginează', async () => {
    const p = make()
    const neg = await p.mentions.list(ctx('brand-urinal'), { sentiment: 'negative', source: null, page: 1, page_size: 10 })
    expect(neg.kind === 'ready' && neg.data.items.every((m) => m.sentiment === 'negative')).toBe(true)
    const page = await p.mentions.list(ctx('brand-urinal'), { sentiment: null, source: null, page: 2, page_size: 4 })
    expect(page.kind === 'ready' && page.data.items.length).toBe(2)
    expect(page.kind === 'ready' && page.data.total).toBe(6)
  })

  it('fiecare mențiune are sentiment revizuit de un om', async () => {
    const r = await make().mentions.list(ctx('brand-urinal'), { sentiment: null, source: null, page: 1, page_size: 50 })
    expect(r.kind === 'ready' && r.data.items.every((m) => m.sentiment !== null && !!m.reviewed_by)).toBe(true)
  })

  it('farmacovigilență: previzualizare exactă, marcare, persistență și jurnal', async () => {
    const p = make()
    const item = { kind: 'mention' as const, id: 'm-u-5' }
    const prev = await p.mentions.pvPreview('brand-urinal', item)
    expect(prev.kind === 'ready' && prev.data.text).toMatch(/erupție/)
    expect(prev.kind === 'ready' && prev.data.notify.length).toBeGreaterThan(0)
    const flagged = await p.mentions.pvFlag('brand-urinal', item)
    expect(flagged.kind).toBe('ready')
    const again = await p.mentions.pvFlag('brand-urinal', item)
    expect(again.kind === 'ready' && flagged.kind === 'ready' && again.data.id).toBe(flagged.kind === 'ready' ? flagged.data.id : '')
    const list = await p.mentions.list(ctx('brand-urinal'), { sentiment: null, source: null, page: 1, page_size: 50 })
    expect(list.kind === 'ready' && list.data.items.find((m) => m.id === 'm-u-5')?.pv_flag).not.toBeNull()
    const log = await p.mentions.pvLog(ctx('brand-urinal'))
    expect(log.kind === 'ready' && log.data).toHaveLength(1)
  })

  it('o mențiune inexistentă nu poate fi marcată', async () => {
    const r = await make().mentions.pvPreview('brand-urinal', { kind: 'mention', id: 'nu-exista' })
    expect(r.kind).toBe('error')
  })
})
