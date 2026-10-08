import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { createSupabaseUsers } from '../../data/supabase/adminProviders'
import { fakeDataClient } from '../../test/fakeDataClient'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URL = '/admin/users'
const row = async (name: string) => {
  await screen.findAllByText(name)
  return screen.getAllByText(name).map((e) => e.closest('tr')).find((r): r is HTMLTableRowElement => r !== null)!
}

describe('Administrare → Utilizatori (fixtures de previzualizare)', () => {
  it('listează persoanele cu rol, organizație și acces la branduri', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const r = await row('Elena Dobre')
    expect(within(r).getByRole('combobox', { name: 'Rol pentru Elena Dobre' })).toHaveValue('client_viewer')
    expect(within(r).getByText('STADA')).toBeInTheDocument()
    const brands = within(r).getByRole('group', { name: 'Branduri pentru Elena Dobre' })
    expect(within(brands).getByRole('button', { name: 'Urinal' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(brands).getByRole('button', { name: 'Proenzi' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('persoana fără nume apare cu id scurt și avertisment, nu cu un nume presupus', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    expect(await screen.findByText('Utilizator 6f1b2c3d')).toBeInTheDocument()
    expect(screen.getByText(/Numele și emailurile nu sunt încă disponibile pentru toate persoanele/)).toBeInTheDocument()
  })

  it('schimbă rolul unei persoane', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const r = await row('Maria Ilie')
    await userEvent.selectOptions(within(r).getByRole('combobox'), 'strategist')
    expect(await screen.findByText('Rolul a fost schimbat.')).toBeInTheDocument()
    await waitFor(async () => expect(within(await row('Maria Ilie')).getByRole('combobox')).toHaveValue('strategist'))
  })

  it('acordă și revocă accesul la un brand', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const chip = () => row('Elena Dobre').then((r) => within(r).getByRole('button', { name: 'Proenzi' }))
    await userEvent.click(await chip())
    expect(await screen.findByText('Accesul la Proenzi a fost acordat.')).toBeInTheDocument()
    await waitFor(async () => expect(await chip()).toHaveAttribute('aria-pressed', 'true'))
  })

  it('revocarea accesului cere confirmare; apoi persoana apare „Revocat" și se poate restabili', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const r = await row('Elena Dobre')
    await userEvent.click(within(r).getByRole('button', { name: 'Revocă accesul pentru Elena Dobre' }))
    const dialog = await screen.findByRole('dialog', { name: 'Revoci accesul?' })
    expect(dialog).toHaveTextContent(/nu va mai putea intra în Analyzator/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revocă accesul' }))
    await waitFor(async () => expect(within(await row('Elena Dobre')).getByText('Revocat')).toBeInTheDocument())
    await userEvent.click(within(await row('Elena Dobre')).getByRole('button', { name: 'Restabilește accesul pentru Elena Dobre' }))
    await waitFor(async () => expect(within(await row('Elena Dobre')).getByText('Activ')).toBeInTheDocument())
  })

  it('propriul rând: fără schimbare de rol, fără revocare, fără schimbare de acces', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const r = await row('Ioana Popescu')
    expect(within(r).getByText('(tu)')).toBeInTheDocument()
    expect(within(r).getByRole('combobox')).toBeDisabled()
    expect(within(r).queryByRole('button', { name: /Revocă accesul/ })).toBeNull()
    await userEvent.click(within(r).getByRole('button', { name: 'Proenzi' }))
    expect(screen.queryByText(/Accesul la Proenzi/)).toBeNull()
  })

  it('invitarea nu pretinde că trimite ceva', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const s = (await screen.findByRole('heading', { level: 2, name: 'Trimite invitație' })).closest('section')!
    expect(within(s).getByText('Invitarea nu este disponibilă încă')).toBeInTheDocument()
    expect(within(s).queryByRole('button')).toBeNull()
    expect(within(s).queryByRole('textbox')).toBeNull()
  })

  it('doar agency_admin: strategist e redirecționat', async () => {
    renderApp({ route: URL, role: 'strategist' })
    await waitFor(() => expect(where()).toBe('/brands/brand-urinal/overview'))
  })

  it('fixtures: providerul refuză alt rol decât agency_admin (nu doar ascunde)', async () => {
    const { providers } = renderApp({ route: URL, role: 'strategist' })
    expect((await providers.users.people()).kind).toBe('error')
  })
})

describe('Administrare → Utilizatori cu providerul real (client fals)', () => {
  const tables = {
    brands: [{ id: 'brand-urinal', tenant_id: 't-1', name: 'Urinal', domain: 'urinal.example', status: 'active' }],
    memberships: [
      { tenant_id: 't-1', user_id: 'u-me', role: 'agency_admin', revoked_at: null, created_at: '2026-09-01T09:00:00Z', tenants: { name: 'AdSymphony' } },
      { tenant_id: 't-1', user_id: 'abcdef12-0000-4000-8000-000000000000', role: 'client_viewer', revoked_at: null, created_at: '2026-09-02T09:00:00Z', tenants: { name: 'AdSymphony' } },
    ],
    brand_access: [{ tenant_id: 't-1', brand_id: 'brand-urinal', user_id: 'abcdef12-0000-4000-8000-000000000000', revoked_at: null }],
  }

  it('afișează persoanele fără nume, cu id scurt, și scrie prin client cu filtre pe tenant și utilizator', async () => {
    const fake = fakeDataClient({ userId: 'u-me', tables })
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseUsers(fake.client) }) })
    await pageReady('Utilizatori')
    const r = await row('Utilizator abcdef12')
    await userEvent.selectOptions(within(r).getByRole('combobox'), 'account')
    await screen.findByText('Rolul a fost schimbat.')
    const upd = fake.calls.find((c) => c.table === 'memberships' && c.op === 'update')!
    expect(upd.payload).toEqual({ role: 'account' })
    expect(upd.filters).toEqual(expect.arrayContaining([['tenant_id', 'eq', 't-1'], ['user_id', 'eq', 'abcdef12-0000-4000-8000-000000000000']]))
  })

  it('fără client (neconfigurat): „Sursă neconectată" cu motiv', async () => {
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseProviders().users }) })
    await pageReady('Utilizatori')
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
  })
})
