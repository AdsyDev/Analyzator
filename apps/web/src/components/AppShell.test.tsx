import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notConnected, ready, type Brand, type ProviderResult, type SessionUser } from '../contracts'
import { ThemeProvider } from '../theme/ThemeProvider'
import { AppShell, type AppShellProps } from './AppShell'

const NOW = new Date('2026-10-06T07:00:00Z')
const agency: SessionUser = { id: 'u1', name: 'Ioana Popescu', email: 'ioana@adsymphony.ro', role: 'agency_admin', organization: 'AdSymphony' }
const strategist: SessionUser = { ...agency, id: 'u3', role: 'strategist' }
const client: SessionUser = { id: 'u2', name: 'Elena Dobre', email: 'elena@stada.ro', role: 'client_viewer', organization: 'STADA' }
const brands = (): ProviderResult<Brand[]> =>
  ready([
    { id: 'b1', tenant_id: 't1', name: 'Urinal', category: 'Sănătate urinară', domain: 'urinal.ro' },
    { id: 'b2', tenant_id: 't1', name: 'Minimartieni', category: 'Vitamine pentru copii', domain: null },
  ])

function setup(over: Partial<AppShellProps> = {}, route = '/brands/b1/overview?period=7d&device=mobile') {
  const props: AppShellProps = {
    user: agency,
    brands: brands(),
    brandId: 'b1',
    onBrandChange: vi.fn(),
    title: 'Overview',
    subtitle: 'Starea brandului pe toate sursele.',
    dataAsOf: '2026-10-05',
    lastRefreshAt: '2026-10-06T07:30:00+03:00',
    onSignOut: vi.fn(),
    now: NOW,
    children: <p>conținut</p>,
    ...over,
  }
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <AppShell {...props} />
      </MemoryRouter>
    </ThemeProvider>,
  )
  return props
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
})

describe('AppShell', () => {
  it('titlu, subtitlu, conținut și linia de proveniență', () => {
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Starea brandului pe toate sursele.')).toBeInTheDocument()
    expect(screen.getByText('conținut')).toBeInTheDocument()
    expect(screen.getByText(/Date până la/)).toHaveTextContent(/5 oct\.?\s2026/)
    expect(screen.getByText(/Ultimul refresh/)).toHaveTextContent('acum 2 ore')
  })

  it('fără nicio dată importată nu inventează o dată', () => {
    setup({ dataAsOf: null, lastRefreshAt: null })
    expect(screen.getByText('Nicio sursă nu a importat date încă')).toBeInTheDocument()
  })

  it('navigarea are cele 9 module și păstrează perioada, nu filtrele modulului', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Module' })
    expect(within(nav).getAllByRole('link')).toHaveLength(9)
    const ai = within(nav).getByRole('link', { name: 'AI Visibility' })
    expect(ai).toHaveAttribute('href', '/brands/b1/ai?period=7d')
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  })

  it('agency_admin vede Administrare', () => {
    setup()
    const admin = screen.getByRole('navigation', { name: 'Administrare' })
    expect(within(admin).getAllByRole('link').map((a) => a.textContent)).toEqual(['Clienți și site-uri', 'Surse', 'Utilizatori', 'Configurare'])
  })

  it('strategist și account nu văd Administrare (spec cap. 28: e a lui Agency admin)', () => {
    for (const role of ['strategist', 'account'] as const) {
      const { unmount } = render(
        <ThemeProvider>
          <MemoryRouter>
            <AppShell user={{ ...strategist, role }} brands={brands()} brandId="b1" onBrandChange={() => {}} title="t" dataAsOf={null} lastRefreshAt={null} onSignOut={() => {}} now={NOW}>x</AppShell>
          </MemoryRouter>
        </ThemeProvider>,
      )
      expect(screen.queryByRole('navigation', { name: 'Administrare' }), role).toBeNull()
      unmount()
    }
  })

  it('clientul nu vede Administrare', () => {
    setup({ user: client })
    expect(screen.queryByRole('navigation', { name: 'Administrare' })).toBeNull()
    expect(screen.queryByText('Surse')).toBeNull()
  })

  it('fără brand ales, modulele sunt dezactivate, nu duc la /brands/null', () => {
    setup({ brandId: null })
    const nav = screen.getByRole('navigation', { name: 'Module' })
    expect(within(nav).queryAllByRole('link')).toHaveLength(0)
    expect(nav.querySelectorAll('[aria-disabled="true"]')).toHaveLength(9)
  })

  it('sidebar colapsabil, cu stare persistată și etichete păstrate pentru cititoare de ecran', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Restrânge bara laterală' }))
    expect(screen.getByRole('button', { name: 'Extinde bara laterală' })).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem('az-sidebar')).toBe('collapsed')
    expect(screen.getByRole('link', { name: 'AI Visibility' })).toBeInTheDocument()
  })

  it('selectorul de brand listează brandurile permise și apelează onBrandChange', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Spațiu de brand' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Minimartieni/ }))
    expect(props.onBrandChange).toHaveBeenCalledWith('b2')
  })

  it('meniul de brand are linkul „Clienți și site-uri" doar pentru agency_admin', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Spațiu de brand' }))
    expect(within(screen.getByRole('menu', { name: 'Spațiu de brand' })).getByRole('link', { name: 'Clienți și site-uri' })).toHaveAttribute('href', '/admin/clients')
  })

  it('clientul nu primește linkul „Clienți și site-uri" în meniul de brand', async () => {
    setup({ user: client })
    await userEvent.click(screen.getByRole('button', { name: 'Spațiu de brand' }))
    expect(within(screen.getByRole('menu', { name: 'Spațiu de brand' })).queryByRole('link')).toBeNull()
  })

  it('branduri neconectate: spune asta, fără meniu', () => {
    setup({ brands: notConnected('Nu există acces configurat.') })
    expect(screen.getByText('Niciun spațiu de brand disponibil')).toHaveAttribute('title', 'Nu există acces configurat.')
    expect(screen.queryByRole('button', { name: 'Spațiu de brand' })).toBeNull()
  })

  it('lista de branduri în încărcare și goală au stări proprii', () => {
    setup({ brands: null })
    expect(screen.getByRole('status', { name: 'Se încarcă brandurile' })).toBeInTheDocument()
  })

  it('utilizator fără brand: mesaj explicit', () => {
    setup({ brands: ready([]) , brandId: null })
    expect(screen.getByText('Nu ai acces la niciun spațiu de brand')).toBeInTheDocument()
  })

  it('comută tema', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Comută la tema închisă' }))
    expect(document.documentElement.getAttribute('data-az-theme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Comută la tema deschisă' })).toBeInTheDocument()
  })

  it('meniul contului: date, ieșire din cont, fără comutator de rol în afara previzualizării', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Contul Ioana Popescu' }))
    const menu = screen.getByRole('group', { name: 'Meniul contului' })
    expect(menu).toHaveTextContent('ioana@adsymphony.ro')
    expect(menu).toHaveTextContent('Agenție, administrator, AdSymphony')
    expect(within(menu).queryByRole('radiogroup')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Ieși din cont' }))
    expect(props.onSignOut).toHaveBeenCalled()
  })

  it('în previzualizare: „Vezi interfața ca" comută rolul', async () => {
    const onChange = vi.fn()
    setup({ roleSwitcher: { role: 'agency_admin', onChange } })
    await userEvent.click(screen.getByRole('button', { name: 'Contul Ioana Popescu' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Client, cititor' }))
    expect(onChange).toHaveBeenCalledWith('client_viewer')
  })

  it('slot pentru FilterBar și link „Sari la conținut" către zona principală', () => {
    setup({ filterBar: <div>filtre</div> })
    expect(screen.getByText('filtre')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sari la conținut' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })
})
