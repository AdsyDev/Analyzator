import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'
import { createUnconfiguredAuth } from '../../auth/createAuthSource'
import type { AuthSource } from '../../auth/types'
import { failed, notConnected, ready, type DataProviders, type Insight, type MetricItem, type Role, type SentimentDistribution } from '../../contracts'
import { createFixtureProviders } from '../../data/fixtures/createFixtureProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { createPreviewAuth } from '../../preview/previewAuth'
import { KPI_KEYS, OVERVIEW_CARDS } from './slots'

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}

interface Opts {
  role?: Role
  route?: string
  wrap?: (base: DataProviders) => DataProviders
}

function setup({ role = 'agency_admin', route = '/brands/brand-urinal/overview', wrap }: Opts = {}) {
  const auth: AuthSource = createPreviewAuth(role)
  const base = createFixtureProviders({ getRole: () => auth.preview?.role ?? role })
  const providers = wrap ? wrap(base) : base
  render(
    <MemoryRouter initialEntries={[route]}>
      <App env={{ providers, auth }} />
      <Where />
    </MemoryRouter>,
  )
  return { providers, auth }
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  document.documentElement.removeAttribute('data-az-theme')
  window.localStorage.removeItem('az-ai-panel')
})

const card = (name: string) => screen.getByRole('article', { name })
const section = (name: string) => screen.getByRole('region', { name })
const loaded = async () => {
  await screen.findByRole('heading', { level: 1, name: H1 })
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Se încarcă' })).toBeNull())
}

/** Înlocuiește variațiile venite de la provider, ca semnalele să nu depindă de data rulării. */
const withChanges = (changes: Record<string, Partial<MetricItem>>) => (b: DataProviders): DataProviders => ({
  ...b,
  metrics: {
    ...b.metrics,
    metrics: async (c, k) => {
      const r = await b.metrics.metrics(c, k)
      return { ...r, items: r.items.map((i) => ({ ...i, relative_change: 1, ...(i.value === null ? {} : (changes[i.metric_key] ?? {})) })) }
    },
  },
})

const H1 = 'Imaginea completă a brandului'
const NAMES = { sov: 'AI SoV în setul urmărit', ai: 'AI Mention Rate', seo: 'Visibility SEOmonitor (ultima observație)', sentiment: 'Sentiment pozitiv (mențiuni revizuite)', clicks: 'Clicks (Search Console)', position: 'Locul în setul de competitori (AI)' }
const ORDER = [NAMES.sov, NAMES.ai, NAMES.seo, NAMES.sentiment, NAMES.clicks, NAMES.position]
const sentimentOf = (o: Partial<SentimentDistribution>): SentimentDistribution => ({ total: 4, positive: 3, neutral: 1, negative: 0, unreviewed: 2, owned_excluded: 0, shares: { positive: 75, neutral: 25, negative: 0 }, ...o })

describe('Overview: compoziția din macheta propunerii', () => {
  it('titlul din machetă, calea, „Exportă raportul”, șase indicatori, cardurile, apoi semnalele, prioritățile și interpretarea; AdSy AI nu e pe pagină până nu e deschis', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    expect(screen.getByText('Brand Intelligence / Overview')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Exportă raportul' })).toHaveAttribute('href', '/brands/brand-urinal/reports?period=7d')
    expect(document.title).toBe('Overview · Urinal · Analyzator')
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(ORDER)
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(titles).toEqual(['Evoluția vizibilității AI', 'Vizibilitate pe platforme', 'SEO și trafic', 'Social listening', 'Competitori', 'Ce s-a schimbat', 'Prioritățile următoare', 'Interpretarea AdSymphony'])
    expect(screen.getByRole('region', { name: 'Starea datelor' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Context' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'AI insights' })).not.toBeChecked()
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
  })

  it('bara de context: client, brand, țară, perioadă, comparație și acoperirea indicatorilor', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=custom&from=2026-09-08&to=2026-10-05' })
    await loaded()
    const bar = screen.getByRole('region', { name: 'Context' })
    expect(bar).toHaveTextContent('Client STADA România')
    expect(bar).toHaveTextContent('Brand Urinal')
    expect(bar).toHaveTextContent('Țară România')
    expect(bar).toHaveTextContent('8 sept. - 5 oct. 2026')
    expect(bar).toHaveTextContent('11 aug. - 7 sept. 2026')
    expect(within(bar).getByLabelText('Acoperirea indicatorilor')).toBeInTheDocument()
  })

  it('acoperirea numără toate metricile din registru de pe pagină, pe stări', async () => {
    setup()
    await loaded()
    const cov = within(screen.getByRole('region', { name: 'Context' })).getByLabelText('Acoperirea indicatorilor')
    const total = ['complete', 'partial', 'stale', 'unavailable'].reduce((n, s) => n + Number(within(cov).queryByTestId(`cov-${s}`)?.textContent ?? 0), 0)
    expect(total).toBe(KPI_KEYS.length)
  })

  it('starea datelor arată sursele modulului cu „date până la" și următoarea actualizare estimată', async () => {
    setup()
    await loaded()
    const strip = screen.getByRole('region', { name: 'Starea datelor' })
    const items = within(within(strip).getByRole('list', { name: 'Date până la, pe sursă' })).getAllByRole('listitem')
    expect(items.map((i) => i.querySelector('span')?.textContent)).toEqual(['SEOmonitor', 'Search Console', 'Google Analytics 4', 'Planable'])
    expect(strip).toHaveTextContent('Următoarea actualizare estimată')
  })
})

describe('Overview: cei șase indicatori', () => {
  it('fiecare are formularea din machetă și, dedesubt, numele exact al indicatorului', async () => {
    setup()
    await loaded()
    OVERVIEW_CARDS.forEach((c, i) => expect(within(card(ORDER[i]!)).getByText(c.category)).toBeInTheDocument())
    expect(within(card(NAMES.clicks)).getByText(NAMES.clicks)).toBeInTheDocument()
  })

  it('o metrică din registru are valoare, variație cu perioada de comparație și tooltip cu formula din registru', async () => {
    const { providers } = setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const c = card(NAMES.clicks)
    expect(c).toHaveAttribute('data-status', 'ok')
    expect(c.textContent).toMatch(/\d/)
    expect(c).toHaveTextContent(/față de .* - .*\d{4}/)
    const defs = await providers.metrics.definitions(['gsc_clicks'])
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(defs.kind === 'ready' ? defs.data[0]!.formula : '—')
  })

  it.each(OVERVIEW_CARDS.map((c) => [c.category, c.detailLabel, c.module] as const))('„%s" duce la detaliu (%s), cu perioada păstrată', async (category, label, module) => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    await userEvent.click(screen.getByRole('link', { name: `${category}: ${label}` }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`/brands/brand-urinal/${module}?period=7d`))
  })

  it('sentimentul pozitiv vine doar din mențiunile revizuite, cu numerele lor', async () => {
    setup({ wrap: (b) => ({ ...b, mentions: { ...b.mentions, sentiment: async () => ready(sentimentOf({})) } }) })
    await loaded()
    const c = card(NAMES.sentiment)
    expect(c).toHaveTextContent('75 %')
    expect(c).toHaveTextContent('3 din 4 revizuite · 2 nerevizuite')
  })

  it('fără mențiuni revizuite, sentimentul e lipsă explicată, nu 0 %', async () => {
    setup({ wrap: (b) => ({ ...b, mentions: { ...b.mentions, sentiment: async () => ready(sentimentOf({ total: 0, positive: 0, neutral: 0, shares: { positive: null, neutral: null, negative: null } })) } }) })
    await loaded()
    const c = card(NAMES.sentiment)
    expect(c).toHaveTextContent('Fără mențiuni revizuite')
    expect(c).toHaveTextContent('Nicio mențiune revizuită încă · 2 nerevizuite.')
    expect(c.textContent).not.toMatch(/%/)
  })

  it('poziția competitivă e locul brandului în set pe AI, din matricea de Concurență; nu e un scor', async () => {
    setup()
    await loaded()
    const c = card(NAMES.position)
    await waitFor(() => expect(c.textContent).toMatch(/#\d din \d/))
    expect(c).toHaveTextContent(/După .+\./)
    expect(within(c).queryByRole('button', { name: /Deschide dovezile/ })).toBeNull()
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Nu e un scor compus.')
  })

  it('setul de competitori neconfigurat: poziția arată motivul, nu un loc inventat', async () => {
    setup({ wrap: (b) => ({ ...b, competition: { ...b.competition, matrix: async () => notConnected('Setul de competitori nu e configurat pentru acest brand.') } }) })
    await loaded()
    const c = card(NAMES.position)
    expect(c).toHaveTextContent('Sursă neconectată')
    expect(c).toHaveTextContent('Setul de competitori nu e configurat pentru acest brand.')
    expect(c.textContent).not.toMatch(/#\d/)
  })

  it('stările parțial și neconectat apar cu motivul lor, nu ca zero', async () => {
    setup()
    await loaded()
    expect(card(NAMES.ai)).toHaveAttribute('data-status', 'partial')
    expect(card(NAMES.ai).textContent).toMatch(/\d/)
    const seo = card(NAMES.seo)
    expect(seo).toHaveAttribute('data-status', 'not_connected')
    expect(seo).toHaveTextContent('Sursă neconectată')
    expect(seo.textContent).not.toMatch(/\d/)
  })

  it('brandul și perioada din URL determină cifrele', async () => {
    const value = () => card(NAMES.clicks).querySelector('p.font-display')?.textContent
    setup({ route: '/brands/brand-urinal/overview' })
    await loaded()
    const urinal28 = value()
    await userEvent.click(within(screen.getByRole('region', { name: 'Filtre' })).getByRole('button', { name: 'Perioadă' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /7 zile/ }))
    await waitFor(() => expect(value()).not.toBe(urinal28))
  })
})

describe('Overview: cardurile de sub indicatori', () => {
  it('evoluția vizibilității AI: seria AI SoV pe perioada aleasă, cu legătură spre modul', async () => {
    setup({ route: '/brands/brand-minimartieni/overview?period=7d' })
    await loaded()
    const s = section('Evoluția vizibilității AI')
    expect(s).toHaveTextContent(NAMES.sov)
    expect(await within(s).findByRole('button', { name: /Vezi ca tabel/ })).toBeInTheDocument()
    expect(within(s).getByRole('link', { name: 'Vizibilitate AI' })).toHaveAttribute('href', '/brands/brand-minimartieni/ai?period=7d')
    // Graficul din machetă: arie sub seria brandului și puncte la capetele ei.
    expect(within(s).getByTestId('chart-area')).toBeInTheDocument()
    expect(within(s).getAllByTestId('chart-end-marker')).toHaveLength(2)
  })

  it('comutatorul 28 / 90 zile de pe grafic schimbă perioada întregii pagini, în URL', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const group = within(section('Evoluția vizibilității AI')).getByRole('group', { name: 'Perioada paginii' })
    expect(within(group).getByRole('button', { name: '28 zile' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(group).getByRole('button', { name: '90 zile' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/brands/brand-minimartieni/overview?period=90d'))
    await loaded()
    expect(within(within(section('Evoluția vizibilității AI')).getByRole('group', { name: 'Perioada paginii' })).getByRole('button', { name: '90 zile' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('vizibilitate pe platforme: engine-urile în ordinea valorii; cel fără date rămâne „Fără date”, fără bară', async () => {
    const stat = (engine: 'chatgpt' | 'gemini' | 'perplexity', mention_rate: number | null) => ({ engine, mention_rate, delta_pp: null, valid_answers: 10, total_answers: 10, status: 'ok' as const })
    setup({ wrap: (b) => ({ ...b, ai: { ...b.ai, engines: async () => ready([stat('chatgpt', 40), stat('gemini', null), stat('perplexity', 55.5)]) } }) })
    await loaded()
    const items = within(await within(section('Vizibilitate pe platforme')).findByRole('list', { name: 'AI Mention Rate pe platformă' })).getAllByRole('listitem')
    expect(items.map((i) => i.textContent?.replace(/\s/g, ' '))).toEqual(['Perplexity55,5 %', 'ChatGPT40 %', 'GeminiFără date'])
    expect(items[2]!.querySelector('[style]')).toBeNull()
  })

  it('SEO și trafic: seria de clickuri și trei indicatori din registru, cu numele lor', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const s = section('SEO și trafic')
    expect(await within(s).findByRole('img', { name: `Evoluție: ${NAMES.clicks}` })).toBeInTheDocument()
    for (const name of ['Keywords în Top 10', 'CTR (Search Console)', 'Sesiuni']) expect(within(s).getByText(name)).toBeInTheDocument()
    expect(within(s).getAllByRole('definition').every((d) => /\d/.test(d.textContent ?? ''))).toBe(true)
  })

  it('Social listening: ponderile vin din mențiunile revizuite; fără revizuiri, „Fără date”, nu 0 %', async () => {
    setup({ wrap: (b) => ({ ...b, mentions: { ...b.mentions, sentiment: async () => ready(sentimentOf({})) } }) })
    await loaded()
    const list = within(await within(section('Social listening')).findByRole('list', { name: 'Sentiment, din mențiunile revizuite' })).getAllByRole('listitem')
    expect(list.map((l) => l.textContent?.replace(/\s/g, ' '))).toEqual(['Pozitiv75 %', 'Neutru25 %', 'Negativ0 %'])
    expect(section('Social listening')).toHaveTextContent('Din 4 mențiuni revizuite de echipă. 2 nerevizuite.')
    expect(within(section('Social listening')).getByRole('img', { name: '4 revizuite' })).toBeInTheDocument()
  })

  it('Social listening fără nicio mențiune revizuită', async () => {
    setup({ wrap: (b) => ({ ...b, mentions: { ...b.mentions, sentiment: async () => ready(sentimentOf({ total: 0, positive: 0, neutral: 0, unreviewed: 0, shares: { positive: null, neutral: null, negative: null } })) } }) })
    await loaded()
    const s = section('Social listening')
    expect(await within(s).findAllByText('Fără date')).toHaveLength(3)
    expect(s).toHaveTextContent('Nicio mențiune revizuită încă')
  })

  it('Competitori: brandul și competitorii pe același indicator AI; ce lipsește rămâne N/A', async () => {
    setup({
      wrap: (b) => ({
        ...b,
        competition: {
          ...b.competition,
          matrix: async (c) => {
            const r = await b.competition.matrix(c)
            if (r.kind !== 'ready') return r
            const row = r.data.groups.find((g) => g.dimension === 'ai')!.rows[0]!
            const competitor = r.data.entities.find((e) => e.kind === 'competitor')!
            row.cells[competitor.id] = { ...row.cells[competitor.id]!, value: null, reason: 'Sursa nu oferă metrica.' }
            return r
          },
        },
      }),
    })
    await loaded()
    const s = section('Competitori')
    const items = within(await within(s).findByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items.some((i) => i.textContent?.startsWith('Urinal'))).toBe(true)
    expect(items[items.length - 1]).toHaveTextContent('N/A')
    expect(within(s).getByRole('link', { name: 'Toată comparația' })).toHaveAttribute('href', '/brands/brand-urinal/competition')
  })

  it('un card căzut are „Reîncearcă” doar la el; restul paginii rămâne', async () => {
    let n = 0
    setup({ wrap: (b) => ({ ...b, ai: { ...b.ai, engines: async (c, f) => (++n === 1 ? failed('Engine-urile nu au putut fi citite.') : b.ai.engines(c, f)) } }) })
    await loaded()
    const s = section('Vizibilitate pe platforme')
    expect(await within(s).findByText('Engine-urile nu au putut fi citite.')).toBeInTheDocument()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(6)
    await userEvent.click(within(s).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(s).findByRole('list', { name: 'AI Mention Rate pe platformă' })).toBeInTheDocument()
  })
})

describe('Overview: sidebarul AdSy AI', () => {
  const toggle = () => screen.getByRole('switch', { name: 'AI insights' })
  /** Deschide sidebarul din comutatorul de lângă titlu, ca un utilizator. */
  const open = async () => {
    await userEvent.click(toggle())
    return screen.findByRole('complementary', { name: 'AdSy AI' })
  }

  it('închis la început: nu e pe pagină și nu cere nimic de la AdSy AI', async () => {
    const calls: string[] = []
    setup({ wrap: (b) => ({ ...b, assistant: { ...b.assistant, settings: async (id) => (calls.push(id), b.assistant.settings(id)) } }) })
    await loaded()
    expect(toggle()).not.toBeChecked()
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
    expect(screen.queryByTestId('panel-scrim')).toBeNull()
    expect(calls).toEqual([])
  })

  it('comutatorul „AI insights” îl deschide: pașii recomandați din ultima analiză publicată și câmpul de întrebare', async () => {
    setup()
    await loaded()
    const p = await open()
    expect(toggle()).toBeChecked()
    await within(p).findByLabelText('Întreabă AdSy AI')
    const steps = within(p).getAllByRole('listitem')
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.length).toBeLessThanOrEqual(3)
    expect(p).toHaveTextContent('Din analiza echipei AdSymphony, nu generate automat.')
    expect(within(p).getByRole('link', { name: 'Deschide AdSy AI' })).toHaveAttribute('href', '/brands/brand-urinal/assistant')
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('AdSy AI')
  })

  it('deschiderea și închiderea nu schimbă nicio setare AdSy AI; dashboardul rămâne același', async () => {
    const saved: unknown[] = []
    setup({
      wrap: (b) => ({
        ...b,
        assistant: { ...b.assistant, savePreference: async (brand, pref) => (saved.push(pref), b.assistant.savePreference(brand, pref)), savePolicy: async (brand, policy) => (saved.push(policy), b.assistant.savePolicy(brand, policy)) },
      }),
    })
    await loaded()
    const p = await open()
    await userEvent.click(within(p).getByRole('button', { name: 'Închide AdSy AI' }))
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
    expect(toggle()).not.toBeChecked()
    expect(toggle()).toHaveFocus()
    await open()
    await userEvent.click(toggle())
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
    expect(saved).toEqual([])
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(6)
    expect(section('Interpretarea AdSymphony')).toBeInTheDocument()
  })

  it('Esc îl închide și întoarce focusul la comutator; pe ecran îngust, și apăsarea pe fundal', async () => {
    setup()
    await loaded()
    const p = await open()
    await userEvent.type(await within(p).findByLabelText('Întreabă AdSy AI'), '{Escape}')
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
    expect(toggle()).toHaveFocus()
    await open()
    await userEvent.click(screen.getByTestId('panel-scrim'))
    expect(screen.queryByRole('complementary', { name: 'AdSy AI' })).toBeNull()
  })

  it('alegerea se reține pe dispozitiv: deschis rămâne deschis la următoarea încărcare', async () => {
    window.localStorage.setItem('az-ai-panel', 'open')
    setup()
    await loaded()
    expect(await screen.findByRole('complementary', { name: 'AdSy AI' })).toBeInTheDocument()
    expect(toggle()).toBeChecked()
    await userEvent.click(toggle())
    expect(window.localStorage.getItem('az-ai-panel')).toBe('closed')
  })

  it('o întrebare primește un răspuns marcat ca generat și nevalidat, cu dovezi care deschid sertarul', async () => {
    setup({ route: '/brands/brand-minimartieni/overview' })
    await loaded()
    const p = await open()
    await userEvent.type(await within(p).findByLabelText('Întreabă AdSy AI'), 'Cum au mers sesiunile?')
    await userEvent.click(within(p).getByRole('button', { name: 'Trimite întrebarea' }))
    const reply = await within(p).findByRole('article', { name: 'Răspuns AdSy AI' })
    expect(reply).toHaveAttribute('data-status', 'ok')
    expect(reply).toHaveTextContent('Generat de AdSy AI')
    expect(reply).toHaveTextContent('Nevalidat de echipă')
    await userEvent.click(within(reply).getByRole('button', { name: 'Sesiuni' }))
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toHaveTextContent('Sesiuni')
  })

  it('chat oprit din preferința personală: sidebarul o spune și trimite la pagina AdSy AI, fără câmp de întrebare', async () => {
    setup({
      wrap: (b) => ({ ...b, assistant: { ...b.assistant, settings: async (id) => { const r = await b.assistant.settings(id); return r.kind === 'ready' ? ready({ ...r.data, preference: { ...r.data.preference, chat: false }, effective: { ...r.data.effective, chat: false } }) : r } } }),
    })
    await loaded()
    const p = await open()
    expect(await within(p).findByText(/Ai oprit chatul din preferințele tale/)).toBeInTheDocument()
    expect(within(p).getByRole('link', { name: 'AdSy AI' })).toHaveAttribute('href', '/brands/brand-urinal/assistant')
    expect(within(p).queryByLabelText('Întreabă AdSy AI')).toBeNull()
  })

  it('chat oprit de politica brandului: sidebarul o spune și nu oferă câmpul de întrebare', async () => {
    setup({
      role: 'client_viewer',
      wrap: (b) => ({ ...b, assistant: { ...b.assistant, settings: async (id) => { const r = await b.assistant.settings(id); return r.kind === 'ready' ? ready({ ...r.data, policy: { ...r.data.policy, chat: false }, effective: { ...r.data.effective, chat: false } }) : r } } }),
    })
    await loaded()
    const p = await open()
    expect(await within(p).findByText(/prin politica brandului/)).toBeInTheDocument()
    expect(within(p).queryByLabelText('Întreabă AdSy AI')).toBeNull()
  })

  it('serverul neconfigurat: întrebarea primește explicația, nu un răspuns', async () => {
    setup({ wrap: (b) => ({ ...b, assistant: { ...b.assistant, ask: async () => ready({ status: 'not_configured' as const, answer: null, blocked_by: null, cached: false, model_id: null, prompt_version: null }) } }) })
    await loaded()
    const p = await open()
    await userEvent.type(await within(p).findByLabelText('Întreabă AdSy AI'), 'Cum au mers sesiunile?')
    await userEvent.click(within(p).getByRole('button', { name: 'Trimite întrebarea' }))
    expect(await within(p).findByText(/AdSy AI nu e configurat încă/)).toBeInTheDocument()
    expect(within(p).queryByRole('article', { name: 'Răspuns AdSy AI' })).toBeNull()
  })
})

describe('Overview: „Ce s-a schimbat"', () => {
  it('oportunitatea și riscul sunt cele mai mari variații, favorabilă și nefavorabilă, etichetate ca semnale automate neconfirmate', async () => {
    setup({ wrap: withChanges({ ga4_sessions: { relative_change: 12.9, status: 'ok' }, ai_mention_rate: { relative_change: -9, absolute_change: -3.8, status: 'ok' } }) })
    await loaded()
    const list = within(section('Ce s-a schimbat')).getAllByRole('listitem')
    expect(list.map((l) => l.getAttribute('aria-label'))).toEqual(['Oportunitate', 'Risc', 'Decizie'])
    expect(list[0]).toHaveTextContent('Sesiuni: +12,9 %')
    expect(list[0]).toHaveTextContent('Google Analytics 4')
    expect(list[0]).toHaveTextContent('Semnal automat, neconfirmat')
    expect(list[0]).toHaveTextContent('Față de')
    expect(list[1]).toHaveTextContent('AI Mention Rate: −3,8 p.p.')
    expect(list[1]).toHaveTextContent('SEOmonitor')
  })

  it('un semnal pe date parțiale o spune; „Vezi dovada" deschide dovezile metricii', async () => {
    setup({ wrap: withChanges({ ai_mention_rate: { relative_change: 20, absolute_change: 6 } }) })
    await loaded()
    const opp = within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Oportunitate' })
    expect(opp).toHaveTextContent('Semnal automat, pe date parțiale')
    await userEvent.click(within(opp).getByRole('button', { name: 'Vezi dovada' }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('AI Mention Rate')
  })

  it('fără variații de cel puțin 5 %, nu se inventează semnale', async () => {
    setup({ wrap: withChanges({}) })
    await loaded()
    const s = section('Ce s-a schimbat')
    expect(within(s).getByRole('listitem', { name: 'Oportunitate' })).toHaveTextContent('Niciun indicator principal nu are o variație favorabilă de cel puțin 5 % în acest interval.')
    expect(within(s).getByRole('listitem', { name: 'Risc' })).toHaveTextContent('Niciun indicator principal nu are o variație nefavorabilă de cel puțin 5 % în acest interval.')
  })

  it('decizia vine din ultima analiză publicată: prima acțiune deschisă, cu responsabil și termen', async () => {
    setup()
    await loaded()
    const d = within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Decizie' })
    expect(d).toHaveTextContent('Verifică paginile citate pentru Prevenție ITU')
    expect(d).toHaveTextContent('Andrei Vasile')
    expect(d).toHaveTextContent('Din analiza publicată de AdSymphony')
  })

  it('fără analize disponibile, decizia rămâne goală, cu explicație', async () => {
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async () => notConnected('Analizele vor fi disponibile după configurarea fluxului editorial.') } }) })
    await loaded()
    expect(within(section('Ce s-a schimbat')).getByRole('listitem', { name: 'Decizie' })).toHaveTextContent('Nicio acțiune deschisă în ultima analiză publicată.')
  })
})

describe('Overview: dovezi (EvidenceDrawer)', () => {
  it('un card deschide dovezile: definiție, interval, înregistrări și hash; Esc închide și restituie focusul', async () => {
    setup()
    await loaded()
    const open = within(card(NAMES.clicks)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.clicks}` })
    await userEvent.click(open)
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(dlg).toHaveTextContent('Overview')
    expect(dlg).toHaveTextContent('Cum se calculează')
    expect(dlg).toHaveTextContent(NAMES.clicks)
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
    expect(within(dlg).getByText(/[0-9a-f]{16}…/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(open).toHaveFocus()
  })

  it.each([NAMES.sov, NAMES.ai, NAMES.seo, NAMES.clicks])('%s se poate deschide cu tastatura (Enter)', async (name) => {
    setup()
    await loaded()
    within(card(name)).getByRole('button', { name: `Deschide dovezile pentru ${name}` }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('o sursă neconectată: „Sursă neconectată", fără valori estimate, cu acțiune spre surse doar pentru agency_admin', async () => {
    setup()
    await loaded()
    await userEvent.click(within(card(NAMES.seo)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.seo}` }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect((await within(dlg).findAllByText(/Nu afișăm valori estimate/)).length).toBeGreaterThan(0)
    await userEvent.click(within(dlg).getByRole('button', { name: 'Vezi sursele' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/clients/brand-urinal'))
  })

  it('pentru strategist nu apare acțiunea spre Surse', async () => {
    setup({ role: 'strategist' })
    await loaded()
    await userEvent.click(within(card(NAMES.seo)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.seo}` }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    await within(dlg).findAllByText(/Nu afișăm valori estimate/)
    expect(within(dlg).queryByRole('button', { name: 'Vezi sursele' })).toBeNull()
  })

  it('o eroare la dovezi afișează „Reîncearcă" fără să închidă drawerul', async () => {
    let n = 0
    setup({
      wrap: (b) => ({ ...b, metrics: { ...b.metrics, evidence: async (id, q) => (++n === 1 ? failed('Timeout.') : b.metrics.evidence(id, q)) } }),
    })
    await loaded()
    await userEvent.click(within(card(NAMES.clicks)).getByRole('button', { name: `Deschide dovezile pentru ${NAMES.clicks}` }))
    const dlg = await screen.findByRole('dialog', { name: 'Dovezi' })
    expect(await within(dlg).findByText('Timeout.')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(dlg).findByText(/Cele mai recente 10 din/)).toBeInTheDocument()
  })
})

describe('Overview: prioritățile următoare și interpretarea AdSymphony', () => {
  const published = 'Vizibilitatea în răspunsurile AI scade pe criteriile de alegere'

  it('agenția vede ultima analiză publicată cu badge de status, autor, perioadă, data publicării și limite', async () => {
    setup()
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    expect(within(c).getByText('Publicat')).toBeInTheDocument()
    expect(c).toHaveTextContent('Ioana Popescu')
    expect(c).toHaveTextContent('Publicată la')
    expect(c).toHaveTextContent('Limite:')
  })

  it('clientul vede aceeași analiză, fără badge de status', async () => {
    setup({ role: 'client_viewer' })
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    expect(within(c).queryByText('Publicat')).toBeNull()
  })

  it('analiza în review sau draft nu apare niciodată ca interpretare publicată', async () => {
    const drafts = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, status: i.status === 'published' ? 'in_review' : i.status, published_at: null }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(drafts(r.data)) : r } } }) })
    await loaded()
    expect(await screen.findByText('Nicio analiză publicată')).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: published })).toBeNull()
  })

  it('„Vezi toate analizele" duce la modul Analize, cu perioada păstrată', async () => {
    setup({ route: '/brands/brand-urinal/overview?period=7d' })
    await loaded()
    await userEvent.click(screen.getByRole('link', { name: 'Vezi toate analizele' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/brands/brand-urinal/insights?period=7d'))
  })

  it('dovada din analiză deschide EvidenceDrawer cu metrica ei', async () => {
    setup()
    await loaded()
    const c = await screen.findByRole('article', { name: published })
    await userEvent.click(within(c).getByRole('button', { name: 'Clicks din search' }))
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toHaveTextContent('Clicks')
  })

  it('priorități: maximum 3, doar acțiuni deschise, cu responsabil, termen și status, în ordinea termenului', async () => {
    setup()
    await loaded()
    const items = within(section('Prioritățile următoare')).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(3)
    expect(items[0]).toHaveTextContent('Verifică paginile citate pentru Prevenție ITU')
    expect(items[0]).toHaveTextContent('În lucru')
    expect(items[0]).toHaveTextContent('Andrei Vasile')
    expect(items[0]).toHaveTextContent('Termen')
    for (const i of items) expect(i).not.toHaveTextContent(/Finalizată|Anulată/)
  })

  it('efortul și KPI-ul urmărit apar doar când au fost completate', async () => {
    const withPlan = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, actions: i.actions.map((a, n) => (n === 0 ? { ...a, effort: '2 zile', tracked_metric: { metric_key: 'ai_mention_rate', label: 'AI Mention Rate' } } : a)) }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(withPlan(r.data)) : r } } }) })
    await loaded()
    const items = within(section('Prioritățile următoare')).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Efort2 zile')
    expect(items[0]).toHaveTextContent('KPI urmăritAI Mention Rate')
    if (items[1]) expect(items[1]).not.toHaveTextContent('Efort')
  })

  it('„Deschide dovezile" dintr-o prioritate deschide drawerul', async () => {
    setup()
    await loaded()
    await userEvent.click(within(section('Prioritățile următoare')).getAllByRole('button', { name: 'Deschide dovezile' })[0]!)
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toBeInTheDocument()
  })

  it('fără acțiuni deschise: stare goală cu explicație', async () => {
    const closed = (list: Insight[]): Insight[] => list.map((i) => ({ ...i, actions: i.actions.map((a) => ({ ...a, status: 'done' as const })) }))
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (c) => { const r = await b.insights.list(c); return r.kind === 'ready' ? ready(closed(r.data)) : r } } }) })
    await loaded()
    expect(await screen.findByText('Nicio prioritate deschisă')).toBeInTheDocument()
  })

  it('analize indisponibile (provider neconectat): motivul, în ambele secțiuni, fără listă goală', async () => {
    setup({ wrap: (b) => ({ ...b, insights: { ...b.insights, list: async () => notConnected('Analizele vor fi disponibile după configurarea fluxului editorial.') } }) })
    await loaded()
    expect(await screen.findAllByText('Analizele vor fi disponibile după configurarea fluxului editorial.')).toHaveLength(2)
  })
})

describe('Overview: izolarea secțiunilor și providerul real', () => {
  it('metrici căzute: indicatorii din registru arată eroarea cu „Reîncearcă", iar analiza și competitorii se încarcă oricum', async () => {
    let n = 0
    setup({ wrap: (b) => ({ ...b, metrics: { ...b.metrics, metrics: async (c, k) => (++n === 1 ? Promise.reject(new Error('Serverul nu a răspuns.')) : b.metrics.metrics(c, k)) } }) })
    await screen.findByRole('heading', { level: 1, name: H1 })
    const grid = await screen.findByTestId('kpi-grid')
    await waitFor(() => expect(within(grid).getAllByText('Nu am putut încărca datele')).toHaveLength(4))
    expect(await screen.findByText('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')).toBeInTheDocument()
    expect(await within(section('Competitori')).findByRole('list')).toBeInTheDocument()
    await userEvent.click(within(grid).getAllByRole('button', { name: 'Reîncearcă' })[0]!)
    await waitFor(() => expect(within(grid).queryAllByText('Nu am putut încărca datele')).toHaveLength(0))
  })

  it('cu providerul supabase (neconectat): niciun card nu inventează valori sau definiții', async () => {
    const auth = createPreviewAuth('agency_admin')
    const real = createSupabaseProviders()
    // Brandurile trebuie să existe ca să se deschidă pagina; restul rămâne providerul real, gol.
    const providers: DataProviders = { ...real, brands: createFixtureProviders({}).brands }
    render(
      <MemoryRouter initialEntries={['/brands/brand-urinal/overview']}>
        <App env={{ providers, auth }} />
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { level: 1, name: H1 })
    const grid = await screen.findByTestId('kpi-grid')
    await waitFor(() => expect(within(grid).getAllByText('Sursă neconectată')).toHaveLength(6))
    expect(within(grid).queryByText(/^\d/)).toBeNull()
    expect(within(grid).queryAllByRole('img')).toHaveLength(0)
    await userEvent.click(within(grid).getAllByRole('button', { name: 'Ce înseamnă indicatorul' })[1]!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Definiția acestui indicator nu este încă în registrul de metrici.')
    expect(within(section('Ce s-a schimbat')).queryByText(/Semnal automat/)).toBeNull()
    expect(screen.queryByText(/supabase|stack/i)).toBeNull()
  })

  it('fără sesiune, Overview nu se montează și nu cere date', () => {
    const auth = createUnconfiguredAuth()
    const providers = createFixtureProviders({})
    const spy = vi.spyOn(providers.metrics, 'metrics')
    render(
      <MemoryRouter initialEntries={['/brands/brand-urinal/overview']}>
        <App env={{ providers, auth }} />
      </MemoryRouter>,
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('un brand nepermis nu declanșează nicio cerere de metrici', async () => {
    const { providers } = setup({ route: '/brands/brand-strain/overview' })
    const spy = vi.spyOn(providers.metrics, 'metrics')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})
