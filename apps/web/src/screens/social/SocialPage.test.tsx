import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed, ready } from '../../contracts'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { pageReady, renderApp, where } from '../../test/renderApp'

const MINI = '/brands/brand-minimartieni/social'
const open = () => pageReady('Social')
const section = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('section')!

describe('Social fără import', () => {
  it('„Sursă neconectată" cu Planable în text și „Importă CSV" pentru agency_admin', async () => {
    renderApp({ route: '/brands/brand-urinal/social' })
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText(/vin din Planable, care nu e încă conectat/)).toBeInTheDocument()
    expect(screen.queryByTestId('social-kpis')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Importă CSV' }))
    await waitFor(() => expect(where()).toBe('/admin/sources'))
  })

  it('clientul nu primește acțiunea', async () => {
    renderApp({ route: '/brands/brand-urinal/social', role: 'client_viewer' })
    await screen.findByRole('heading', { name: 'Sursă neconectată' })
    expect(screen.queryByRole('button', { name: 'Importă CSV' })).toBeNull()
  })

  it('cu providerul real: aceeași stare', async () => {
    renderApp({ route: MINI, wrap: (b) => ({ ...b, social: createSupabaseProviders().social }) })
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
  })
})

describe('Social cu import', () => {
  it('structura din spec cap. 17', async () => {
    renderApp({ route: MINI })
    await open()
    expect(await screen.findByTestId('social-kpis')).toBeInTheDocument()
    for (const h of ['Performanța conținutului', 'Topic și format', 'Calendar', 'Concurență publică']) expect(await screen.findByRole('heading', { level: 2, name: h })).toBeInTheDocument()
    expect(screen.getByText(/Sursă/).closest('p')).toHaveTextContent('Planable')
  })

  it('cinci KPI cu definiție; creșterea netă cu semn; interacțiuni parțiale cu nota despre postările fără date', async () => {
    renderApp({ route: MINI })
    await open()
    const grid = await screen.findByTestId('social-kpis')
    expect(within(grid).getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Postări publicate', 'Followers', 'Creștere netă', 'Interacțiuni', 'Reach valid'])
    expect(within(within(grid).getByRole('article', { name: 'Creștere netă' })).getByText('+310')).toBeInTheDocument()
    const inter = within(grid).getByRole('article', { name: 'Interacțiuni' })
    expect(inter).toHaveAttribute('data-status', 'partial')
    expect(within(inter).getByText(/1 postări fără date de performanță nu sunt incluse/)).toBeInTheDocument()
    await userEvent.click(within(within(grid).getByRole('article', { name: 'Followers' })).getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent(/ultima observație validă\), nu o sumă pe zile/)
  })

  it('postările: linkuri validate, lipsa performanței = „Indisponibil", nemature marcate', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await section('Performanța conținutului')
    const table = await within(s).findByRole('table')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(8)
    const links = within(table).getAllByRole('link', { name: 'Deschide postarea' })
    for (const a of links) {
      expect(a.getAttribute('href')).toMatch(/^https:\/\//)
      expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
    expect(within(table).getAllByText(/date incomplete/).length).toBeGreaterThan(0) // postările de sub 7 zile
    await userEvent.click(within(s).getByRole('button', { name: 'Înainte' }))
    expect(await within(s).findAllByText('Indisponibil')).toHaveLength(2) // reach + interacțiuni pentru postarea fără analytics
  })

  it('un permalink nesigur nu devine link', async () => {
    renderApp({ route: MINI, wrap: (b) => ({ ...b, social: { ...b.social, posts: async (c, f) => { const r = await b.social.posts(c, f); return r.kind === 'ready' ? ready(r.data.map((p, i) => ({ ...p, permalink: i === 0 ? 'javascript:alert(1)' : p.permalink }))) : r } } }) })
    await open()
    const s = await section('Performanța conținutului')
    await within(s).findByRole('table')
    expect(within(s).getByText('Link indisponibil')).toBeInTheDocument()
    expect(s.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('filtrele de platformă și format din URL', async () => {
    renderApp({ route: `${MINI}?platform=instagram&format=video` })
    await open()
    const chips = await screen.findByRole('group', { name: 'Filtre active' })
    expect(within(chips).getByText('Platformă: Instagram')).toBeInTheDocument()
    expect(within(chips).getByText('Format: Video')).toBeInTheDocument()
    const s = await section('Performanța conținutului')
    const rows = within(await within(s).findByRole('table')).getAllByRole('row').slice(1)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r).toHaveTextContent(/Instagram · Video/)
  })

  it('valori necunoscute ale filtrelor sunt ignorate', async () => {
    renderApp({ route: `${MINI}?platform=myspace&format=gif` })
    await open()
    await screen.findByTestId('social-kpis')
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })

  it('topic și format: n, postări pe săptămână, mediana doar din postările mature; „Fără topic" separat', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await section('Topic și format')
    const topic = await within(s).findByRole('table', { name: 'Topic' })
    const row = (name: string) => within(topic).getByRole('rowheader', { name }).closest('tr')!
    expect(within(row('Poftă de mâncare')).getAllByRole('cell').map((c) => c.textContent)).toEqual(['0,5', '1', '170']) // doar postarea de acum 19 zile e matură; cea de acum 6 zile nu intră în mediană
    expect(within(row('Fără topic')).getAllByRole('cell')[1]).toHaveTextContent('1')
    expect(within(s).getByText(/Mediana include doar postările mature/)).toBeInTheDocument()
    expect(within(s).getByText(/Perioada de observare/)).toBeInTheDocument()
    expect(within(s).getByRole('table', { name: 'Format' })).toBeInTheDocument()
  })

  it('calendar: publicări pe zile, cu etichete și marcajul pentru postările fără performanță', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await section('Calendar')
    const days = await within(s).findAllByRole('listitem', {}, { timeout: 3000 })
    expect(days.length).toBeGreaterThan(10)
    expect(within(s).getAllByText('Date de performanță indisponibile')).toHaveLength(1)
    expect(within(s).getAllByText('Sezon rece').length).toBeGreaterThan(0)
  })

  it('concurența publică: valorile lipsă sunt „Fără date", nu zero; fără reach privat', async () => {
    renderApp({ route: MINI })
    await open()
    const s = await section('Concurență publică')
    const table = await within(s).findByRole('table')
    const c3 = within(table).getByRole('rowheader', { name: /Multikinder/ }).closest('tr')!
    expect(within(c3).getAllByText('Fără date')).toHaveLength(3)
    expect(within(c3).queryByText(/^0$/)).toBeNull()
    expect(within(s).getByText(/Reach-ul competitorilor nu e public și nu se estimează/)).toBeInTheDocument()
  })

  it('secțiunea căzută nu blochează restul', async () => {
    let n = 0
    renderApp({ route: MINI, wrap: (b) => ({ ...b, social: { ...b.social, groups: async (c, f) => (++n === 1 ? failed('Calcul indisponibil.') : b.social.groups(c, f)) } }) })
    await open()
    expect(await screen.findByText('Calcul indisponibil.')).toBeInTheDocument()
    expect(screen.getByTestId('social-kpis')).toBeInTheDocument()
    await userEvent.click(within(await section('Topic și format')).getByRole('button', { name: 'Reîncearcă' }))
    expect(await within(await section('Topic și format')).findByRole('table', { name: 'Topic' })).toBeInTheDocument()
  })

  it('o singură cerere pe secțiune; brand nepermis fără cereri', async () => {
    const calls = { s: 0, p: 0, g: 0, c: 0, k: 0 }
    renderApp({ route: MINI, wrap: (b) => ({ ...b, social: { summary: async (c, f) => (calls.s++, b.social.summary(c, f)), posts: async (c, f) => (calls.p++, b.social.posts(c, f)), groups: async (c, f) => (calls.g++, b.social.groups(c, f)), calendar: async (c, f) => (calls.c++, b.social.calendar(c, f)), competitors: async (c) => (calls.k++, b.social.competitors(c)) } }) })
    await open()
    await screen.findByTestId('social-kpis')
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toEqual({ s: 1, p: 1, g: 1, c: 1, k: 1 })
    const { providers } = renderApp({ route: '/brands/brand-strain/social' })
    const spy = vi.spyOn(providers.social, 'summary')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})
