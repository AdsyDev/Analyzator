import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed, ready, type DataProviders } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp, where } from '../../test/renderApp'

const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const ROUTE = '/brands/brand-urinal/ai'
const open = () => pageReady('AI Visibility')

describe('AI Visibility: structura din spec cap. 13', () => {
  it('are KPI-urile, engine-urile, trendurile, matricea, sursele citate și Answer Explorer', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(within(screen.getByTestId('kpi-grid')).getAllByRole('article')).toHaveLength(5)
    for (const h of ['Mention Rate pe engine', 'Trenduri pe engine', 'Subiecte și competitori', 'Surse citate', 'Answer Explorer']) {
      expect(screen.getByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    }
  })

  it.each(['Mention Rate', 'Recommendation Rate', 'Owned Citation Rate', 'SoV în setul urmărit', 'Răspunsuri valide'])('KPI „%s": not_connected, fără cifră și fără definiție inventată', async (name) => {
    renderApp({ route: ROUTE })
    await open()
    const c = screen.getByRole('article', { name })
    expect(c).toHaveAttribute('data-status', 'not_connected')
    expect(within(c).getByText('Sursă neconectată')).toBeInTheDocument()
    expect(within(c).queryByText(/^\d/)).toBeNull()
    await userEvent.click(within(c).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(within(c).getByRole('tooltip')).toHaveTextContent('Definiția acestui indicator nu este încă în registrul de metrici.')
  })

  it('titlul și subtitlul din design', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(screen.getByText(/Cum apare brandul în răspunsurile asistenților AI/)).toBeInTheDocument()
  })
})

describe('AI Visibility: engine-uri', () => {
  it('patru carduri, cu rata, valide/total și acoperire; Gemini e parțial (răspuns cu eroare)', async () => {
    renderApp({ route: ROUTE })
    await open()
    const cards = within(section('Mention Rate pe engine')).getAllByRole('button')
    expect(cards.map((c) => c.textContent)).toEqual([expect.stringContaining('ChatGPT'), expect.stringContaining('Gemini'), expect.stringContaining('Perplexity'), expect.stringContaining('AI Overviews')])
    for (const c of cards) expect(c).toHaveTextContent(/\d+(,\d)?\s%/)
    expect(within(cards[1]!).getByText('Parțial', { exact: false })).toBeInTheDocument()
    expect(cards[1]).toHaveTextContent(/Valide\s*\d+ \/ 10/)
    expect(within(cards[0]!).getByText('Complet')).toBeInTheDocument()
  })

  it('apăsarea unui engine îl pune în URL și filtrează restul paginii; a doua apăsare îl scoate', async () => {
    renderApp({ route: ROUTE })
    await open()
    await userEvent.click(within(section('Mention Rate pe engine')).getByRole('button', { name: /Perplexity/ }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/ai?engine=perplexity'))
    await waitFor(() => expect(within(section('Mention Rate pe engine')).getByRole('button', { name: /Perplexity/ })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => {
      const items = within(section('Answer Explorer')).getAllByRole('listitem')
      for (const i of items) expect(i).toHaveTextContent('Perplexity')
    })
    expect(within(await screen.findByRole('group', { name: 'Filtre active' })).getByText('Engine: Perplexity')).toBeInTheDocument()
    await userEvent.click(within(section('Mention Rate pe engine')).getByRole('button', { name: /Perplexity/ }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/ai'))
  })

  it('un engine necunoscut din URL e ignorat', async () => {
    renderApp({ route: `${ROUTE}?engine=bing` })
    await open()
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
    expect(within(section('Answer Explorer')).getByText(/1-8 din 40/)).toBeInTheDocument()
  })
})

describe('AI Visibility: filtrul „grup" (dinamic, pe brand)', () => {
  it('apare după încărcarea grupurilor și scrie în URL', async () => {
    renderApp({ route: ROUTE })
    await open()
    await userEvent.click(await screen.findByRole('button', { name: 'Grup' }))
    expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Toate grupurile'), expect.stringContaining('Prevenție ITU'), expect.stringContaining('Cistită acută'),
      expect.stringContaining('Merișor și D-manoză'), expect.stringContaining('ITU în sarcină'), expect.stringContaining('După antibiotic'),
    ])
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Cistită acută' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/ai?group=Cistit%C4%83+acut%C4%83'))
    await waitFor(() => expect(within(section('Subiecte și competitori')).getAllByRole('row')).toHaveLength(2)) // antet + un subiect
  })

  it('un grup din URL valid se aplică; unul nevalid e ignorat', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent('Cistită acută')}` })
    await open()
    expect(await screen.findByText('Grup: Cistită acută')).toBeInTheDocument()
    await waitFor(() => expect(within(section('Answer Explorer')).getByText(/1-8 din 8/)).toBeInTheDocument())
  })

  it('un grup inexistent nu are efect', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent("'; DROP TABLE")}` })
    await open()
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
    expect(within(section('Answer Explorer')).getByText(/1-8 din 40/)).toBeInTheDocument()
  })

  it('cu AI neconectat (provider real) filtrul „grup" nu apare, dar „Engine" da', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, ai: createSupabaseProviders().ai }) })
    await open()
    expect(screen.getByRole('button', { name: 'Engine' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Grup' })).toBeNull()
  })
})

describe('AI Visibility: o singură încărcare pe secțiune', () => {
  it('încărcarea opțiunilor filtrului „grup" nu reia cererile secțiunilor (regresie: ctx.filters își schimba forma)', async () => {
    const calls = { engines: 0, matrix: 0, answers: 0 }
    renderApp({
      route: ROUTE,
      wrap: (b) => ({
        ...b,
        ai: {
          ...b.ai,
          engines: async (c, f) => (calls.engines++, b.ai.engines(c, f)),
          topicMatrix: async (c, f) => (calls.matrix++, b.ai.topicMatrix(c, f)),
          answers: async (c, f, p) => (calls.answers++, b.ai.answers(c, f, p)),
        },
      }),
    })
    await open()
    await screen.findByRole('button', { name: 'Grup' })
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual({ engines: 1, matrix: 1, answers: 1 })
  })
})

describe('AI Visibility: matricea topic × competitor', () => {
  it('coloane brand + competitori, subiecte cu n și acoperire vizibile (nu doar în tooltip)', async () => {
    renderApp({ route: ROUTE })
    await open()
    const table = await within(section('Subiecte și competitori')).findByRole('table')
    for (const n of ['Urinal', 'Uronova', 'Cisticare', 'Vitamerin']) expect(within(table).getByRole('columnheader', { name: new RegExp(n) })).toBeInTheDocument()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(5)
    expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent(/Prevenție ITU\s*n = \d+/)
    expect(within(rows[1]!).getByText('Parțial', { exact: false })).toBeInTheDocument() // Cistită acută: un răspuns refuzat
  })

  it('celulele au valoarea scrisă și detaliul numărătorului pentru cititoare de ecran și tooltip', async () => {
    renderApp({ route: ROUTE })
    await open()
    const table = await within(section('Subiecte și competitori')).findByRole('table')
    const cell = within(table).getAllByRole('cell')[0]!
    expect(cell).toHaveTextContent(/\d+(,\d)?\s%/)
    expect(cell.getAttribute('title')).toMatch(/Urinal, Prevenție ITU: \d+ din \d+ răspunsuri valide/)
    expect(cell).toHaveTextContent(/răspunsuri valide/) // sr-only
  })

  it('rata se reproduce din ce se vede: numărătorul și numitorul din tooltip dau valoarea din celulă', async () => {
    renderApp({ route: ROUTE })
    await open()
    const table = await within(section('Subiecte și competitori')).findByRole('table')
    for (const cell of within(table).getAllByRole('cell')) {
      const m = /: (\d+) din (\d+) răspunsuri valide/.exec(cell.getAttribute('title') ?? '')
      const shown = /([\d,]+)\s%/.exec(cell.textContent ?? '')
      if (m && shown) expect(Number(shown[1]!.replace(',', '.'))).toBeCloseTo((100 * Number(m[1])) / Number(m[2]), 1)
    }
  })
})

describe('AI Visibility: surse citate', () => {
  it('domenii cu tip (Owned / Terță parte) și frecvență descrescătoare', async () => {
    renderApp({ route: ROUTE })
    await open()
    const items = within(section('Surse citate')).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(3)
    const counts = items.map((i) => Number(within(i).getByText(/^\d+$/).textContent))
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(within(section('Surse citate')).getAllByText(/Owned|Terță parte/).length).toBe(items.length)
  })
})

describe('AI Visibility: Answer Explorer', () => {
  it('listă paginată: 8 pe pagină, „a-b din n", înainte și înapoi', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = section('Answer Explorer')
    expect(within(s).getAllByRole('listitem')).toHaveLength(8)
    expect(within(s).getByText('1-8 din 40')).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: 'Înapoi' })).toBeDisabled()
    await userEvent.click(within(s).getByRole('button', { name: 'Înainte' }))
    expect(await within(s).findByText('9-16 din 40')).toBeInTheDocument()
  })

  it('refuzul, eroarea și necolectatul au etichete proprii, diferite de „Nemenționat"', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent('Cistită acută')}` })
    await open()
    expect(await within(section('Answer Explorer')).findByText('Refuzat')).toBeInTheDocument()
  })

  it('detaliu: întrebare, engine, data, textul sanitizat cu brandul evidențiat, competitori, citări ca linkuri', async () => {
    renderApp({ route: `${ROUTE}?engine=chatgpt&group=${encodeURIComponent('Prevenție ITU')}` })
    await open()
    const row = (await within(section('Answer Explorer')).findAllByRole('button', { name: /Prevenție ITU/ }))[0]!
    await userEvent.click(row)
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect(await within(dlg).findByText('Răspuns original, sanitizat de date personale', { selector: 'h4' })).toBeInTheDocument()
    expect(within(dlg).getByTestId('answer-text')).toHaveTextContent(/primul pas este o discuție cu medicul/)
    expect(within(dlg).getAllByText('ChatGPT').length).toBeGreaterThan(0)
    const links = within(dlg).getAllByRole('link', { name: 'Deschide sursa originală' })
    expect(links.length).toBeGreaterThan(0)
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//)
      expect(a).toHaveAttribute('target', '_blank')
      expect(a.getAttribute('rel')).toContain('noopener')
      expect(a.getAttribute('rel')).toContain('noreferrer')
    }
    const text = within(dlg).getByTestId('answer-text')
    expect(text.querySelectorAll('sup').length).toBeGreaterThanOrEqual(2)
  })

  it('brandul tău e <mark> cu text pentru cititoare de ecran; competitorii sunt marcați altfel', async () => {
    renderApp({ route: `${ROUTE}?engine=chatgpt` })
    await open()
    const rows = await within(section('Answer Explorer')).findAllByRole('button', { name: /Recomandat|Menționat/ })
    await userEvent.click(rows[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    const text = await within(dlg).findByTestId('answer-text')
    const marks = text.querySelectorAll('mark')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0]).toHaveTextContent(/Urinal \(brandul tău\)/)
    expect(text.textContent).toMatch(/\(competitor\)/)
  })

  it('Esc închide drawerul și focusul revine pe rând', async () => {
    renderApp({ route: ROUTE })
    await open()
    const row = (await within(section('Answer Explorer')).findAllByRole('button', { name: /Prevenție ITU|Cistită|Merișor/ }))[0]!
    await userEvent.click(row)
    await screen.findByRole('dialog', { name: 'Răspuns AI' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(row).toHaveFocus()
  })

  it('răspuns refuzat: explicația stării, fără text inventat, fără butonul de farmacovigilență', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent('Cistită acută')}` })
    await open()
    await userEvent.click(await within(section('Answer Explorer')).findByRole('button', { name: /Refuzat/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect(await within(dlg).findByText(/Un refuz nu e o absență a brandului și nu intră în rata de menționare/)).toBeInTheDocument()
    expect(within(dlg).queryByTestId('answer-text')).toBeNull()
    expect(within(dlg).queryByRole('button', { name: 'Marchează pentru farmacovigilență' })).toBeNull()
  })

  it('eroare de colectare: spune că nu avem răspuns, nu că brandul lipsește', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent('ITU în sarcină')}` })
    await open()
    await userEvent.click(await within(section('Answer Explorer')).findByRole('button', { name: /Eroare de colectare/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect(await within(dlg).findByText(/Nu avem un răspuns, deci nu putem spune dacă brandul apare/)).toBeInTheDocument()
  })

  it('necolectat: explicație proprie', async () => {
    renderApp({ route: `${ROUTE}?group=${encodeURIComponent('După antibiotic')}` })
    await open()
    await userEvent.click(await within(section('Answer Explorer')).findByRole('button', { name: /Necolectat/ }))
    expect(await screen.findByText(/nu a fost colectată pentru acest engine/)).toBeInTheDocument()
  })

  it('Gemini: păstrează eticheta suprafeței și notează clarificarea rutei de colectare', async () => {
    renderApp({ route: `${ROUTE}?engine=gemini` })
    await open()
    const rows = await within(section('Answer Explorer')).findAllByRole('button', { name: /Recomandat|Menționat|Nemenționat/ })
    await userEvent.click(rows[0]!)
    expect(await screen.findByText(/Gemini AI Mode.*în curs de clarificare/)).toBeInTheDocument()
  })

  it('marcare pentru farmacovigilență din drawer: dialog cu ce se înregistrează, apoi starea marcat', async () => {
    renderApp({ route: `${ROUTE}?engine=chatgpt` })
    await open()
    const rows = await within(section('Answer Explorer')).findAllByRole('button', { name: /Recomandat|Menționat|Nemenționat/ })
    await userEvent.click(rows[0]!)
    const drawer = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    const pv = await screen.findByRole('dialog', { name: 'Marchează pentru farmacovigilență' })
    expect(pv).toHaveTextContent('Snapshot text')
    expect(pv).toHaveTextContent(/primul pas este o discuție cu medicul/)
    await userEvent.click(within(pv).getByRole('button', { name: 'Marchează și notifică' }))
    expect(await screen.findByRole('button', { name: /Marcat pentru farmacovigilență,/ })).toBeDisabled()
  })

  it('clientul poate deschide răspunsul și îl poate marca', async () => {
    renderApp({ route: `${ROUTE}?engine=chatgpt`, role: 'client_viewer' })
    await open()
    const rows = await within(section('Answer Explorer')).findAllByRole('button', { name: /Recomandat|Menționat|Nemenționat/ })
    await userEvent.click(rows[0]!)
    const drawer = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect(await within(drawer).findByRole('button', { name: 'Marchează pentru farmacovigilență' })).toBeInTheDocument()
  })

  it('un URL nesigur din citare nu devine link', async () => {
    renderApp({
      route: `${ROUTE}?engine=chatgpt`,
      wrap: (b) => ({
        ...b,
        ai: {
          ...b.ai,
          answer: async (brandId, id) => {
            const r = await b.ai.answer(brandId, id)
            return r.kind === 'ready' ? ready({ ...r.data, citations: r.data.citations.map((c, i) => ({ ...c, url: i === 0 ? 'javascript:alert(1)' : c.url })) }) : r
          },
        },
      }),
    })
    await open()
    const rows = await within(section('Answer Explorer')).findAllByRole('button', { name: /Recomandat|Menționat|Nemenționat/ })
    await userEvent.click(rows[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect((await within(dlg).findAllByText('URL indisponibil')).length).toBeGreaterThan(0)
    expect(dlg.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('eroare la detaliu: mesaj cu „Reîncearcă", fără să închidă drawerul', async () => {
    let n = 0
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, ai: { ...b.ai, answer: async (i, id) => (++n === 1 ? failed('Timeout.') : b.ai.answer(i, id)) } }) })
    await open()
    await userEvent.click((await within(section('Answer Explorer')).findAllByRole('button', { name: /Prevenție ITU|Cistită|Merișor/ }))[0]!)
    const dlg = await screen.findByRole('dialog', { name: 'Răspuns AI' })
    expect(await within(dlg).findByText('Timeout.')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(dlg).findByText(/Răspuns original|Un refuz|Nu avem|nu a fost colectată/)).toBeInTheDocument()
  })
})

describe('AI Visibility: izolarea secțiunilor și providerul real', () => {
  it('matricea căzută: mesaj cu „Reîncearcă", iar restul secțiunilor se încarcă', async () => {
    let n = 0
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, ai: { ...b.ai, topicMatrix: async (c, f) => (++n === 1 ? failed('Matrice indisponibilă.') : b.ai.topicMatrix(c, f)) } }) })
    await screen.findByRole('heading', { level: 1, name: 'AI Visibility' })
    expect(await screen.findByText('Matrice indisponibilă.')).toBeInTheDocument()
    expect(within(section('Answer Explorer')).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(within(section('Surse citate')).getAllByRole('listitem').length).toBeGreaterThan(0)
    await userEvent.click(within(section('Subiecte și competitori')).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(section('Subiecte și competitori')).findByRole('table')).toBeInTheDocument()
  })

  it('cu providerul real (neconectat), fiecare secțiune explică lipsa sursei, fără date inventate', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, ai: createSupabaseProviders().ai }) })
    await open()
    await waitFor(() => expect(screen.getAllByText('Datele AI Visibility nu sunt încă disponibile pentru acest brand.')).toHaveLength(5))
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/supabase|stack/i)).toBeNull()
  })

  it('un brand nepermis nu declanșează nicio cerere AI', async () => {
    const { providers } = renderApp({ route: '/brands/brand-strain/ai' })
    const spies = [vi.spyOn(providers.ai, 'engines'), vi.spyOn(providers.ai, 'answers'), vi.spyOn(providers.ai, 'topicMatrix')]
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    for (const s of spies) expect(s).not.toHaveBeenCalled()
  })

  it('un provider care ar întoarce date pentru alt brand nu poate fi cerut cu id-ul altui brand din URL', async () => {
    const { providers } = renderApp({ route: ROUTE })
    const spy = vi.spyOn(providers.ai, 'answers')
    await open()
    for (const call of spy.mock.calls) expect(call[0].brandId).toBe('brand-urinal')
    expect(spy).toHaveBeenCalled()
  })
})

export type { DataProviders }
