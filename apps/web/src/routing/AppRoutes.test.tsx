import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import type { AuthSource } from '../auth/types'
import { failed, notConnected, ready, type Brand, type DataProviders, type Role } from '../contracts'
import { createFixtureProviders } from '../data/fixtures/createFixtureProviders'
import { createUnconfiguredAuth } from '../auth/createAuthSource'
import { createSupabaseProviders } from '../data/supabase/providers'
import type { AppEnvironment } from '../environment'
import { createPreviewAuth } from '../preview/previewAuth'

const NOW = new Date('2026-10-06T07:00:00Z')

function Where() {
  const l = useLocation()
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>
}
const where = () => screen.getByTestId('where').textContent

interface Opts {
  role?: Role | 'signed_out'
  providers?: (auth: AuthSource) => DataProviders
}

function setup(route: string, { role = 'agency_admin', providers }: Opts = {}) {
  const auth = createPreviewAuth(role)
  const dp = providers ? providers(auth) : createFixtureProviders({ now: () => NOW, getRole: () => auth.preview?.role ?? 'agency_admin' })
  const env: AppEnvironment = { providers: dp, auth }
  render(
    <MemoryRouter initialEntries={[route]}>
      <App env={env} />
      <Where />
    </MemoryRouter>,
  )
  return { auth, providers: dp }
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-az-theme')
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

describe('autentificare', () => {
  it('fără sesiune, orice rută protejată duce la /login, fără shell și fără cereri de date', async () => {
    const { providers } = setup('/brands/brand-urinal/overview?period=7d', { role: 'signed_out' })
    const spy = vi.spyOn(providers.sources, 'statuses')
    expect(await screen.findByRole('heading', { name: 'Bine ai revenit' })).toBeInTheDocument()
    expect(where()).toBe('/login')
    expect(screen.queryByRole('navigation', { name: 'Module' })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('după intrare, revine la adresa cerută inițial, cu parametrii ei', async () => {
    setup('/brands/brand-urinal/seo?period=7d', { role: 'signed_out' })
    await userEvent.click(await screen.findByRole('button', { name: /Intră ca agenție/ }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/seo?period=7d'))
    expect(await screen.findByRole('heading', { level: 1, name: 'SEO și Search' })).toBeInTheDocument()
  })

  it('nu există signup: login-ul spune că accesul e doar pe invitație', async () => {
    setup('/login', { role: 'signed_out' })
    expect(await screen.findByText(/doar pe bază de invitație/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /înregistr|signup|creează cont/i })).toBeNull()
  })

  it('cu sesiune activă, /login duce în aplicație', async () => {
    setup('/login')
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })

  it('fără preview (producție), login-ul nu oferă intrare fictivă', async () => {
    const auth = createUnconfiguredAuth()
    render(
      <MemoryRouter initialEntries={['/brands/x/overview']}>
        <App env={{ providers: createSupabaseProviders(), auth }} />
        <Where />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Bine ai revenit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Intră ca/ })).toBeNull()
  })

  it('ieșirea din cont duce la /login', async () => {
    setup('/brands/brand-urinal/overview')
    await userEvent.click(await screen.findByRole('button', { name: /^Contul / }))
    await userEvent.click(screen.getByRole('button', { name: 'Ieși din cont' }))
    await waitFor(() => expect(where()).toBe('/login'))
  })
})

describe('rute de brand', () => {
  it('/ duce la Overview-ul primului brand permis', async () => {
    setup('/')
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
  })

  it('/brands/:id duce la Overview', async () => {
    setup('/brands/brand-minimartieni')
    await waitFor(() => expect(where()).toBe('/brands/brand-minimartieni/overview'))
  })

  it.each([
    ['overview', 'Overview', /Starea brandului pe toate sursele/],
    ['ai', 'AI Visibility', /răspunsurile asistenților AI/],
    ['seo', 'SEO și Search', /Prezența în Google/],
    ['traffic', 'Trafic și conversii', /Ce se întâmplă după click/],
    ['listening', 'Listening', /sentiment revizuit de echipa AdSymphony/],
    ['competition', 'Concurență', /setul de competitori/],
    ['insights', 'Analize și acțiuni', /Interpretările echipei AdSymphony/],
  ])('modulul %s are titlul și subtitlul din design', async (segment, title, subtitle) => {
    setup(`/brands/brand-urinal/${segment}`)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByText(subtitle)).toBeInTheDocument()
  })

  it('titlul documentului conține modulul și brandul', async () => {
    setup('/brands/brand-urinal/ai')
    await screen.findByRole('heading', { level: 1, name: 'AI Visibility' })
    expect(document.title).toBe('AI Visibility · Urinal · Analyzator')
  })

  it('un modul necunoscut dintr-un brand permis e „Pagina nu există"', async () => {
    setup('/brands/brand-urinal/nope')
    expect(await screen.findByRole('heading', { name: 'Pagina nu există' })).toBeInTheDocument()
  })

  it('o rută necunoscută e „Pagina nu există", cu drum înapoi', async () => {
    setup('/nu-exista/deloc')
    expect(await screen.findByRole('heading', { name: 'Pagina nu există' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mergi la început' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })

  it('FilterBar apare pe modulele de brand și lipsește pe administrare', async () => {
    setup('/brands/brand-urinal/ai')
    expect(await screen.findByRole('region', { name: 'Filtre' })).toBeInTheDocument()
  })
})

describe('placeholder-uri cu texte reale (nu „în curând")', () => {
  it('Paid Media fără import: „Sursă neconectată", motivul din design și acțiunea „Importă CSV"', async () => {
    setup('/brands/brand-urinal/paid')
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText(/Google Ads și Meta Ads nu sunt conectate pentru Urinal. Până la conectare nu afișăm cifre, nici estimate./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Importă CSV' })).toBeInTheDocument()
  })

  it('Social fără import: motivul menționează Planable și Concurența', async () => {
    setup('/brands/brand-urinal/social')
    expect(await screen.findByText(/vin din Planable, care nu e încă conectat/)).toBeInTheDocument()
    expect(screen.getByText(/vezi Concurență/)).toBeInTheDocument()
  })

  it('agency_admin primește „Importă CSV", care duce la Surse (intrarea în flux)', async () => {
    setup('/brands/brand-urinal/paid')
    await userEvent.click(await screen.findByRole('button', { name: 'Importă CSV' }))
    await waitFor(() => expect(where()).toBe('/admin/sources'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Surse' })).toBeInTheDocument()
  })

  it.each(['strategist', 'client_viewer'] as const)('%s nu primește o acțiune de import (nu are acces la Surse)', async (role) => {
    setup('/brands/brand-urinal/paid', { role })
    await screen.findByRole('heading', { name: 'Sursă neconectată' })
    expect(screen.queryByRole('button', { name: /Importă|Conectează|Cere conectarea/ })).toBeNull()
  })

  it('un ecran de Administrare neconstruit (Clienți și site-uri) spune adevărul, fără „În curând"', async () => {
    setup('/admin/clients')
    expect(await screen.findByRole('heading', { name: 'Acest ecran nu este încă disponibil' })).toBeInTheDocument()
    expect(screen.getByText(/Ecranul Clienți și site-uri nu a fost livrat în această versiune/)).toBeInTheDocument()
    expect(screen.queryByText(/în curând/i)).toBeNull()
  })

  it('niciun placeholder nu folosește „în curând" și niciun mesaj nu vorbește despre stack', async () => {
    for (const segment of ['listening', 'competition', 'insights', 'paid', 'social']) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/brands/brand-urinal/${segment}`]}>
          <App env={{ ...mk() }} />
        </MemoryRouter>,
      )
      await screen.findByRole('heading', { level: 1 })
      await waitFor(() => expect(screen.queryByRole('status', { name: /Se încarcă/ })).toBeNull())
      expect(document.body.textContent, segment).not.toMatch(/în curând|supabase|stack|rls/i)
      unmount()
    }
  })

  it('starea surselor din Administrare are eroare cu „Reîncearcă"', async () => {
    let broken = true
    setup('/admin/sources', {
      providers: (auth) => {
        const base = createFixtureProviders({ now: () => NOW, getRole: () => auth.preview?.role ?? 'agency_admin' })
        return { ...base, sources: { ...base.sources, statuses: async (id) => (broken ? failed('Serverul nu a răspuns.') : base.sources.statuses(id)) } }
      },
    })
    expect(await screen.findByText('Serverul nu a răspuns.')).toBeInTheDocument()
    broken = false
    await userEvent.click(screen.getAllByRole('button', { name: 'Reîncearcă' })[0]!)
    expect(await screen.findByRole('article', { name: 'SEOmonitor' })).toBeInTheDocument()
  })
})

function mk(): AppEnvironment {
  const auth = createPreviewAuth('agency_admin')
  return { auth, providers: createFixtureProviders({ now: () => NOW }) }
}

describe('filtre în URL', () => {
  it('Trafic are filtrul Device din allowlist, iar valoarea vine din URL', async () => {
    setup('/brands/brand-urinal/traffic?device=mobile&period=7d')
    const group = await screen.findByRole('group', { name: 'Filtre active' })
    expect(within(group).getByText('Device: Mobil')).toBeInTheDocument()
    expect(within(group).getByText('Ultimele 7 zile')).toBeInTheDocument()
  })

  it('o valoare din afara allowlist-ului e ignorată (nu devine filtru)', async () => {
    setup("/brands/brand-urinal/traffic?device=%27%3B%20drop&foo=bar")
    await screen.findByRole('heading', { level: 1, name: 'Trafic și conversii' })
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })

  it('un filtru care nu aparține modulului nu are efect (device pe AI)', async () => {
    setup('/brands/brand-urinal/ai?device=mobile')
    await screen.findByRole('heading', { level: 1, name: 'AI Visibility' })
    expect(screen.queryByRole('group', { name: 'Filtre active' })).toBeNull()
  })

  it('schimbarea perioadei scrie în URL', async () => {
    setup('/brands/brand-urinal/ai')
    await userEvent.click(await screen.findByRole('button', { name: 'Perioadă' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Ultimele 7 zile/ }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/ai?period=7d'))
  })

  it('navigarea între module păstrează perioada, nu și filtrele modulului', async () => {
    setup('/brands/brand-urinal/traffic?period=7d&device=mobile')
    const nav = await screen.findByRole('navigation', { name: 'Module' })
    await userEvent.click(within(nav).getByRole('link', { name: 'AI Visibility' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/ai?period=7d'))
  })

  it('schimbarea brandului păstrează modulul și perioada', async () => {
    setup('/brands/brand-urinal/seo?period=7d')
    await userEvent.click(await screen.findByRole('button', { name: 'Spațiu de brand' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Minimartieni/ }))
    await waitFor(() => expect(where()).toBe('/brands/brand-minimartieni/seo?period=7d'))
  })
})

describe('izolare între branduri', () => {
  const only = (ids: string[]) => (auth: AuthSource): DataProviders => {
    const base = createFixtureProviders({ now: () => NOW, getRole: () => auth.preview?.role ?? 'agency_admin' })
    return {
      ...base,
      brands: { ...base.brands, list: async () => ready((await base.brands.list().then((r) => (r.kind === 'ready' ? r.data : []))).filter((b: Brand) => ids.includes(b.id))) },
    }
  }

  it('un brandId din afara listei permise afișează „indisponibil" și nu face nicio cerere pentru el', async () => {
    const { providers } = setup('/brands/brand-proenzi/overview', { providers: only(['brand-urinal']) })
    const statuses = vi.spyOn(providers.sources, 'statuses')
    const metrics = vi.spyOn(providers.metrics, 'metrics')
    expect(await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeInTheDocument()
    expect(statuses).not.toHaveBeenCalledWith('brand-proenzi')
    expect(metrics).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Filtre' })).toBeNull()
  })

  it('brandul inexistent și cel nepermis arată la fel (nu confirmă existența)', async () => {
    setup('/brands/nu-exista/overview', { providers: only(['brand-urinal']) })
    const a = (await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).parentElement?.textContent
    document.body.innerHTML = ''
    setup('/brands/brand-proenzi/overview', { providers: only(['brand-urinal']) })
    const b = (await screen.findByRole('heading', { name: 'Spațiu de brand indisponibil' })).parentElement?.textContent
    expect(a).toBe(b)
  })

  it('selectorul listează doar brandurile permise, iar „Mergi la un spațiu permis" duce la unul permis', async () => {
    setup('/brands/brand-proenzi/overview', { providers: only(['brand-urinal', 'brand-minimartieni']) })
    await userEvent.click(await screen.findByRole('button', { name: 'Mergi la un spațiu permis' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
    await userEvent.click(await screen.findByRole('button', { name: 'Spațiu de brand' }))
    expect(screen.getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual([expect.stringContaining('Urinal'), expect.stringContaining('Minimartieni')])
  })

  it('fără niciun brand alocat: mesaj explicit, fără cereri de date', async () => {
    const { providers } = setup('/', { providers: only([]) })
    const statuses = vi.spyOn(providers.sources, 'statuses')
    expect(await screen.findByRole('heading', { name: 'Nu ai acces la niciun spațiu de brand' })).toBeInTheDocument()
    expect(statuses).not.toHaveBeenCalled()
  })

  it('lista de branduri în eroare: mesaj cu „Reîncearcă", nu pagină goală', async () => {
    setup('/brands/brand-urinal/overview', { providers: (auth) => ({ ...createFixtureProviders({ now: () => NOW, getRole: () => auth.preview?.role ?? 'agency_admin' }), brands: { list: async () => failed('Conexiune întreruptă.'), competitorSet: async () => notConnected('x') } }) })
    expect(await screen.findByText('Conexiune întreruptă.')).toBeInTheDocument()
  })

  it('lista de branduri neconectată (producție): mesaj prietenos, fără detalii tehnice', async () => {
    setup('/brands/brand-urinal/overview', { providers: () => createSupabaseProviders() })
    expect(await screen.findByText('Lista spațiilor de brand nu este încă disponibilă.')).toBeInTheDocument()
  })

  it('cât timp se încarcă brandurile: schelet, nu un flash de „indisponibil"', async () => {
    setup('/brands/brand-urinal/overview', {
      providers: (auth) => ({ ...createFixtureProviders({ now: () => NOW, getRole: () => auth.preview?.role ?? 'agency_admin' }), brands: { list: () => new Promise(() => {}), competitorSet: async () => notConnected('x') } }),
    })
    expect(await screen.findByRole('status', { name: 'Se încarcă spațiile de brand' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spațiu de brand indisponibil' })).toBeNull()
  })
})

describe('Administrare: acces pe roluri', () => {
  it('/admin duce agency_admin la prima pagină permisă', async () => {
    setup('/admin')
    await waitFor(() => expect(where()).toBe('/admin/clients'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Clienți și site-uri' })).toBeInTheDocument()
  })

  it.each(['client_viewer', 'strategist', 'account'] as const)('%s e redirecționat din /admin/sources la Overview, fără să vadă ecranul', async (role) => {
    setup('/admin/sources', { role })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
    expect(screen.queryByRole('heading', { level: 1, name: 'Surse' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Administrare' })).toBeNull()
  })

  it('o pagină de administrare necunoscută nu confirmă nimic clientului (același redirect)', async () => {
    setup('/admin/nu-exista', { role: 'client_viewer' })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })

  it('pentru agency_admin, o pagină de administrare necunoscută e „Pagina nu există"', async () => {
    setup('/admin/nu-exista')
    expect(await screen.findByRole('heading', { name: 'Pagina nu există' })).toBeInTheDocument()
  })

  it('/admin pentru client duce la Overview', async () => {
    setup('/admin', { role: 'client_viewer' })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })

  it('Surse: subtitlul poartă brandul curent, iar schimbarea brandului nu navighează', async () => {
    setup('/admin/sources')
    expect(await screen.findByText('Conexiunile de date ale spațiului Urinal și istoricul sincronizărilor.')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Spațiu de brand' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Minimartieni/ }))
    expect(await screen.findByText('Conexiunile de date ale spațiului Minimartieni și istoricul sincronizărilor.')).toBeInTheDocument()
    expect(where()).toBe('/admin/sources')
  })

  it('Configurare are conținutul real: competitori, aliasuri, maparea SEOmonitor', async () => {
    setup('/admin/config')
    for (const h of ['Competitori', 'Aliasuri', 'Grupuri SEOmonitor → brand']) expect(await screen.findByRole('heading', { level: 2, name: h })).toBeInTheDocument()
  })

  it('FilterBar lipsește pe paginile de administrare', async () => {
    setup('/admin/sources')
    await screen.findByRole('heading', { level: 1, name: 'Surse' })
    expect(screen.queryByRole('region', { name: 'Filtre' })).toBeNull()
  })
})

describe('previzualizare: rol comutabil', () => {
  it('comutarea la client pe o pagină de administrare redirecționează și ascunde Administrarea', async () => {
    setup('/admin/clients')
    await screen.findByRole('heading', { level: 1, name: 'Clienți și site-uri' })
    await userEvent.click(screen.getByRole('button', { name: /^Contul / }))
    await userEvent.click(screen.getByRole('radio', { name: 'Client, cititor' }))
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
    expect(screen.queryByRole('navigation', { name: 'Administrare' })).toBeNull()
  })

  it('comutarea la agenție readuce Administrarea', async () => {
    setup('/brands/brand-urinal/overview', { role: 'client_viewer' })
    await screen.findByRole('heading', { level: 1, name: 'Overview' })
    expect(screen.queryByRole('navigation', { name: 'Administrare' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Contul / }))
    await userEvent.click(screen.getByRole('radio', { name: 'Agenție, administrator' }))
    expect(await screen.findByRole('navigation', { name: 'Administrare' })).toBeInTheDocument()
  })

  it('clientul vede analizele publicate; agenția le vede pe toate (providerul aplică rolul)', async () => {
    const { auth, providers } = setup('/brands/brand-urinal/insights', { role: 'client_viewer' })
    const ctx = { brandId: 'brand-urinal', period: { preset: '28d' as const, from: '2026-09-08', to: '2026-10-05' }, comparison: 'previous' as const, filters: {} }
    const asClient = await providers.insights.list(ctx)
    auth.preview?.setRole('strategist')
    const asAgency = await providers.insights.list(ctx)
    expect(asClient.kind === 'ready' && asClient.data).toHaveLength(1)
    expect(asAgency.kind === 'ready' && asAgency.data.length).toBeGreaterThan(1)
  })
})

describe('accesibilitate', () => {
  it('„Sari la conținut" duce la zona principală', async () => {
    setup('/brands/brand-urinal/ai')
    await screen.findByRole('heading', { level: 1, name: 'AI Visibility' })
    expect(screen.getByRole('link', { name: 'Sari la conținut' })).toHaveAttribute('href', '#main')
  })
})
