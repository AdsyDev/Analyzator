import { describe, expect, it } from 'vitest'
import { METRIC_STATUSES, type MetricResponse, type MetricStatus, type QueryContext } from '../../contracts'
import { resolvePeriod } from '../../lib/period'
import { createFixtureProviders } from './createFixtureProviders'

const NOW = new Date('2026-10-06T07:00:00Z')
const period = resolvePeriod('28d', NOW)
const ctx = (brandId: string, over: Partial<QueryContext> = {}): QueryContext => ({ brandId, period, comparison: 'previous', filters: {}, ...over })
const make = (role: 'strategist' | 'client_viewer' = 'strategist') => createFixtureProviders({ now: () => NOW, getRole: () => role })

// Chei pe ecran (spec 12-21). Paid și Social sunt module pe bază de import: toate `not_connected` (UI-4).
const SCREENS: Record<string, string[]> = {
  overview: ['ai_mention_rate', 'gsc_clicks', 'ga4_sessions', 'ga4_key_events', 'paid_spend', 'listening_mentions'],
  ai: ['ai_mention_rate', 'ai_recommendation_rate', 'ai_owned_citation_rate', 'ai_sov', 'ai_valid_answers'],
  seo: ['gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position', 'seomonitor_keywords_top3', 'seomonitor_keywords_top10', 'seomonitor_visibility'],
  traffic: ['ga4_sessions', 'ga4_engaged_sessions', 'ga4_key_events', 'ga4_active_users', 'clarity_rage_click_sessions', 'clarity_dead_click_sessions', 'clarity_quickback_sessions', 'clarity_scroll_depth'],
  listening: ['listening_mentions', 'listening_sov', 'listening_negative_share'],
}

describe('fixtures: contract', () => {
  it('toate metricile trec prin parserul real al contractului și au chei coerente', async () => {
    const p = make()
    const keys = Object.values(SCREENS).flat()
    for (const brand of ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']) {
      const { data, meta } = await p.metrics.metrics(ctx(brand), keys)
      expect(data.map((m) => m.metric_key)).toEqual(keys)
      expect(meta.brand_id).toBe(brand)
      for (const m of data) {
        expect(METRIC_STATUSES).toContain(m.status)
        expect(m.evidence_query.brand_id).toBe(brand)
        expect(m.source).not.toBeNull()
        if (m.coverage !== null) expect(m.coverage).toBeGreaterThanOrEqual(0)
        if (m.coverage !== null) expect(m.coverage).toBeLessThanOrEqual(1)
      }
    }
  })

  it('null, zero și eroare nu se confundă: fără sursă, value e null și nu există variații', async () => {
    const { data } = await make().metrics.metrics(ctx('brand-urinal'), ['paid_spend', 'ai_owned_citation_rate'])
    for (const m of data) {
      expect(m.status).toBe('not_connected')
      expect(m.value).toBeNull()
      expect(m.absolute_change).toBeNull()
      expect(m.relative_change).toBeNull()
      expect(m.coverage).toBeNull()
    }
  })

  it('o cheie necunoscută nu primește valori inventate', async () => {
    const { data } = await make().metrics.metrics(ctx('brand-urinal'), ['cheie_inexistenta'])
    expect(data[0]?.status).toBe('not_connected')
    expect(data[0]?.value).toBeNull()
  })

  it('e determinist: aceleași cereri dau aceleași valori', async () => {
    const a = await make().metrics.metrics(ctx('brand-urinal'), SCREENS.overview!)
    const b = await make().metrics.metrics(ctx('brand-urinal'), SCREENS.overview!)
    expect(a.data).toEqual(b.data)
  })

  it('valorile diferă între branduri și între perioade', async () => {
    const p = make()
    const u = (await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])).data[0]!
    const m = (await p.metrics.metrics(ctx('brand-minimartieni'), ['ga4_sessions'])).data[0]!
    const w = (await p.metrics.metrics(ctx('brand-urinal', { period: resolvePeriod('7d', NOW) }), ['ga4_sessions'])).data[0]!
    expect(u.value).not.toBe(m.value)
    expect(u.value).not.toBe(w.value)
  })
})

describe('fixtures: acoperirea stărilor', () => {
  it('Urinal are partial, stale și not_connected pe fiecare ecran cu date', async () => {
    const p = make()
    for (const [screen, keys] of Object.entries(SCREENS)) {
      const { data } = await p.metrics.metrics(ctx('brand-urinal'), keys)
      const statuses = new Set(data.map((m) => m.status))
      expect(statuses, `ecranul ${screen}`).toContain('partial')
      expect(statuses, `ecranul ${screen}`).toContain('stale')
      expect(statuses, `ecranul ${screen}`).toContain('not_connected')
    }
  })

  it('toate cele opt statusuri apar undeva în previzualizare', async () => {
    const p = make()
    const keys = Object.values(SCREENS).flat()
    const seen = new Set<MetricStatus>()
    for (const brand of ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']) {
      for (const m of (await p.metrics.metrics(ctx(brand), keys)).data) seen.add(m.status)
    }
    expect([...METRIC_STATUSES].filter((s) => !seen.has(s))).toEqual([])
  })

  it('variațiile merg în ambele direcții', async () => {
    const p = make()
    const all: MetricResponse[] = []
    for (const brand of ['brand-urinal', 'brand-minimartieni']) all.push(...(await p.metrics.metrics(ctx(brand), Object.values(SCREENS).flat())).data)
    const changes = all.map((m) => m.relative_change).filter((c): c is number => c !== null)
    expect(changes.some((c) => c > 0)).toBe(true)
    expect(changes.some((c) => c < 0)).toBe(true)
  })

  it('Paid și Social sunt not_connected pe toate brandurile (starea implicită fără import)', async () => {
    const p = make()
    for (const brand of ['brand-urinal', 'brand-minimartieni', 'brand-proenzi']) {
      for (const m of (await p.metrics.metrics(ctx(brand), ['paid_spend', 'social_reach'])).data) expect(m.status).toBe('not_connected')
    }
  })

  it('partial cu zero neconfirmat: value null, nu 0', async () => {
    const m = (await make().metrics.metrics(ctx('brand-minimartieni'), ['listening_negative_share'])).data[0]!
    expect(m.status).toBe('partial')
    expect(m.value).toBeNull()
    expect(m.warnings.map((w) => w.code)).toContain('zero_not_confirmed')
  })

  it('stale: data_as_of rămâne în urma perioadei, cu condiția secundară „partial"', async () => {
    const m = (await make().metrics.metrics(ctx('brand-urinal'), ['ga4_key_events'])).data[0]!
    expect(m.status).toBe('stale')
    expect(m.data_as_of).toBe('2026-10-02')
    expect(m.warnings.map((w) => w.code)).toContain('partial')
  })

  it('base_zero: bază de comparație 0, fără variație relativă', async () => {
    const m = (await make().metrics.metrics(ctx('brand-proenzi'), ['ai_owned_citation_rate'])).data[0]!
    expect(m.status).toBe('base_zero')
    expect(m.comparison_value).toBe(0)
    expect(m.relative_change).toBeNull()
    expect(m.value).not.toBeNull()
  })

  it('cannot_compute și unavailable nu au valoare și au avertismentul serverului', async () => {
    const p = make()
    const c = (await p.metrics.metrics(ctx('brand-proenzi'), ['gsc_ctr'])).data[0]!
    expect(c.status).toBe('cannot_compute')
    expect(c.value).toBeNull()
    expect(c.warnings.map((w) => w.code)).toContain('zero_denominator')
    const u = (await p.metrics.metrics(ctx('brand-minimartieni'), ['gsc_average_position'])).data[0]!
    expect(u.status).toBe('unavailable')
    expect(u.warnings.map((w) => w.code)).toContain('query_failed')
  })

  it('luna curentă (MTD) are comparația ca la server și nota „perioadă incompletă"', async () => {
    const { data, meta } = await make().metrics.metrics(ctx('brand-urinal', { period: resolvePeriod('month', NOW) }), ['ga4_sessions'])
    expect(meta.comparison_period).toEqual({ start: '2026-09-01', end: '2026-09-05' })
    expect(data[0]?.warnings.map((w) => w.code)).toContain('incomplete_period')
  })
})

describe('fixtures: serii și dovezi', () => {
  it('zilele fără date sunt null în serie, nu zero', async () => {
    const [partial] = await make().metrics.trends(ctx('brand-urinal'), ['ai_mention_rate'])
    expect(partial?.points).toHaveLength(28)
    expect(partial?.points.some((p) => p.value === null)).toBe(true)
    expect(partial?.points.every((p) => p.value === null || p.value > 0)).toBe(true)
  })

  it('sursa neconectată nu are puncte', async () => {
    const [s] = await make().metrics.trends(ctx('brand-urinal'), ['paid_spend'])
    expect(s?.points).toEqual([])
    expect(s?.status).toBe('not_connected')
  })

  it('seria are comparație aliniată pe aceeași lungime', async () => {
    const [s] = await make().metrics.trends(ctx('brand-urinal'), ['ga4_sessions'])
    expect(s?.comparison_points).toHaveLength(28)
  })

  it('dovada se rezolvă din cheia metricii și poartă importul și hash-ul', async () => {
    const p = make()
    const { data } = await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])
    const r = await p.metrics.evidence('brand-urinal', data[0]!.evidence_query)
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') {
      expect(r.data.records).toHaveLength(10)
      expect(r.data.total_records).toBe(28)
      expect(r.data.payload_hash).toMatch(/^[0-9a-f]{32}$/)
      expect(r.data.imported_at).not.toBeNull()
    }
  })

  it('dovada unei metrici fără sursă e not_connected, nu o listă goală', async () => {
    const p = make()
    const { data } = await p.metrics.metrics(ctx('brand-urinal'), ['paid_spend'])
    expect((await p.metrics.evidence('brand-urinal', data[0]!.evidence_query)).kind).toBe('not_connected')
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
    const { data } = await p.metrics.metrics(ctx('brand-urinal'), ['ga4_sessions'])
    expect((await p.metrics.evidence('brand-strain', data[0]!.evidence_query)).kind).toBe('error')
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

  it('lista de branduri conține cele trei branduri ale pilotului', async () => {
    const r = await make().brands.list()
    expect(r.kind === 'ready' && r.data.map((b) => b.name)).toEqual(['Urinal', 'Minimartieni', 'Proenzi'])
  })

  it('domeniile fictive folosesc TLD-ul rezervat .example', async () => {
    const r = await make().brands.list()
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
