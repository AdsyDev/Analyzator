import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { createSupabaseUsers } from '../../data/supabase/adminProviders'
import { generatePassword } from './UsersPage'
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

  it('persoana fără nume și fără email apare cu id scurt și avertisment, nu cu un nume presupus', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    expect(await screen.findByText('Utilizator 6f1b2c3d')).toBeInTheDocument()
    expect(screen.getByText(/Pentru unele persoane contul nu are nici nume, nici email/)).toBeInTheDocument()
    expect(within(await row('Elena Dobre')).getByText('elena.dobre@stada.example')).toBeInTheDocument()
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

  it('invită o persoană: rolul non-admin cere un brand; după trimitere apare „Invitație neacceptată” și se poate retrimite', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    await userEvent.selectOptions(within(form).getByLabelText('Client'), 'STADA')
    await userEvent.type(within(form).getByLabelText('Email'), 'Ana.Noua@Stada.example')
    await userEvent.type(within(form).getByLabelText('Nume (opțional)'), 'Ana Nouă')
    const send = within(form).getByRole('button', { name: 'Trimite invitația' })
    expect(send).toBeDisabled()
    expect(within(form).getByText(/Alege cel puțin un brand/)).toBeInTheDocument()
    await userEvent.click(within(within(form).getByRole('group', { name: 'Branduri pentru invitație' })).getByRole('button', { name: 'Urinal' }))
    expect(send).toBeEnabled()
    await userEvent.click(send)
    expect(await screen.findByText('Invitația a fost trimisă la ana.noua@stada.example.')).toBeInTheDocument()

    const r = await row('Ana Nouă')
    expect(within(r).getByText('ana.noua@stada.example')).toBeInTheDocument()
    expect(within(r).getByText('Invitație neacceptată')).toBeInTheDocument()
    expect(within(within(r).getByRole('group', { name: 'Branduri pentru Ana Nouă' })).getByRole('button', { name: 'Urinal' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(r).getByRole('button', { name: 'Retrimite invitația pentru Ana Nouă' }))
    expect(await screen.findByText('Invitația a fost retrimisă la ana.noua@stada.example.')).toBeInTheDocument()
  })

  it('administratorul agenției nu cere branduri; persoana deja activă în listă primește mesajul serverului', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    await userEvent.selectOptions(within(form).getByLabelText('Client'), 'AdSymphony')
    await userEvent.selectOptions(within(form).getByLabelText('Rol'), 'agency_admin')
    expect(within(form).queryByRole('group', { name: 'Branduri pentru invitație' })).toBeNull()
    await userEvent.type(within(form).getByLabelText('Email'), 'maria.ilie@adsymphony.example')
    await userEvent.click(within(form).getByRole('button', { name: 'Trimite invitația' }))
    expect(await screen.findByText(/Persoana este deja în lista acestui client/)).toBeInTheDocument()
  })

  it('creează un cont cu parolă temporară: parola apare o singură dată, apoi persoana are „Parolă temporară”, fără retrimitere', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    expect(within(form).getByRole('radio', { name: /Trimite invitație pe email/ })).toBeChecked()
    await userEvent.click(within(form).getByRole('radio', { name: /Creează contul cu parolă temporară/ }))
    await userEvent.selectOptions(within(form).getByLabelText('Client'), 'STADA')
    await userEvent.type(within(form).getByLabelText('Email'), 'Dan.Nou@Stada.example')
    await userEvent.type(within(form).getByLabelText('Nume (opțional)'), 'Dan Nou')
    await userEvent.click(within(within(form).getByRole('group', { name: 'Branduri pentru invitație' })).getByRole('button', { name: 'Urinal' }))
    const create = within(form).getByRole('button', { name: 'Creează contul' })
    expect(create).toBeDisabled()
    await userEvent.type(within(form).getByLabelText('Parolă temporară'), 'scurt')
    expect(create).toBeDisabled()
    expect(within(form).getByText(/trebuie să aibă cel puțin 8 caractere/)).toBeInTheDocument()
    await userEvent.clear(within(form).getByLabelText('Parolă temporară'))
    await userEvent.click(within(form).getByRole('button', { name: 'Generează' }))
    const password = (within(form).getByLabelText('Parolă temporară') as HTMLInputElement).value
    expect(password).toHaveLength(16)
    expect(create).toBeEnabled()
    await userEvent.click(create)

    const dialog = await screen.findByRole('dialog', { name: 'Contul a fost creat' })
    expect(within(dialog).getByText(password)).toBeInTheDocument()
    expect(within(dialog).getByText('dan.nou@stada.example')).toBeInTheDocument()
    expect(within(form).getByLabelText('Parolă temporară')).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Am transmis parola' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText(password)).toBeNull()

    const r = await row('Dan Nou')
    expect(within(r).getByText('Parolă temporară')).toBeInTheDocument()
    expect(within(r).queryByRole('button', { name: /Retrimite invitația/ })).toBeNull()
  })

  it('crearea pentru o adresă care are deja cont: mesajul serverului, fără cont nou', async () => {
    renderApp({ route: URL })
    await pageReady('Utilizatori')
    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    await userEvent.click(within(form).getByRole('radio', { name: /Creează contul cu parolă temporară/ }))
    await userEvent.selectOptions(within(form).getByLabelText('Client'), 'AdSymphony')
    await userEvent.selectOptions(within(form).getByLabelText('Rol'), 'agency_admin')
    await userEvent.type(within(form).getByLabelText('Email'), 'maria.ilie@adsymphony.example')
    await userEvent.type(within(form).getByLabelText('Parolă temporară'), 'Temporar#2026')
    await userEvent.click(within(form).getByRole('button', { name: 'Creează contul' }))
    expect(await screen.findByText(/Există deja un cont cu această adresă/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
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

  const people = [
    { tenant_id: 't-1', user_id: 'u-me', email: 'ioana@adsymphony.ro', full_name: 'Ioana Popescu', last_sign_in_at: '2026-10-22T08:00:00Z' },
    { tenant_id: 't-1', user_id: 'abcdef12-0000-4000-8000-000000000000', email: 'elena@stada.ro', full_name: null, last_sign_in_at: '2026-10-20T08:00:00Z' },
  ]
  /** Funcția server `users`: `identities` cu persoanele date; `invite` și `create` cu răspunsurile date. */
  const usersFn = (invite?: unknown, create?: unknown, list: unknown[] = people) => (name: string, body: unknown) => {
    const action = name === 'users' ? (body as { action?: string }).action : undefined
    if (action === 'identities') return { data: { people: list } }
    if (action === 'invite' && invite) return { data: invite }
    if (action === 'create' && create) return { data: create }
    return { error: { message: 'necunoscut' } }
  }

  it('afișează persoana cu emailul din cont, fără avertisment, și scrie prin client cu filtre pe tenant și utilizator', async () => {
    const fake = fakeDataClient({ userId: 'u-me', tables, invoke: usersFn() })
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseUsers(fake.client) }) })
    await pageReady('Utilizatori')
    const r = await row('elena@stada.ro')
    expect(screen.queryByText(/nici nume, nici email/)).toBeNull()
    await userEvent.selectOptions(within(r).getByRole('combobox'), 'account')
    await screen.findByText('Rolul a fost schimbat.')
    const upd = fake.calls.find((c) => c.table === 'memberships' && c.op === 'update')!
    expect(upd.payload).toEqual({ role: 'account' })
    expect(upd.filters).toEqual(expect.arrayContaining([['tenant_id', 'eq', 't-1'], ['user_id', 'eq', 'abcdef12-0000-4000-8000-000000000000']]))
  })

  it('invitația trimisă cu providerul real ajunge la funcția users cu tenantul din listă', async () => {
    const fake = fakeDataClient({ userId: 'u-me', tables, invoke: usersFn({ status: 'access_granted', user_id: 'u-9' }) })
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseUsers(fake.client) }) })
    await pageReady('Utilizatori')
    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    // Un singur client administrat: fără selector de client.
    expect(within(form).queryByLabelText('Client')).toBeNull()
    await userEvent.type(within(form).getByLabelText('Email'), ' Dan@Stada.ro ')
    await userEvent.selectOptions(within(form).getByLabelText('Rol'), 'agency_admin')
    await userEvent.click(within(form).getByRole('button', { name: 'Trimite invitația' }))
    expect(await screen.findByText('dan@stada.ro avea deja cont: a primit accesul, fără email nou.')).toBeInTheDocument()
    expect(fake.invocations.filter((c) => (c.body as { action?: string }).action === 'invite')).toEqual([
      { name: 'users', body: { action: 'invite', tenant_id: 't-1', email: 'dan@stada.ro', full_name: null, role: 'agency_admin', brand_ids: [] } },
    ])
  })

  it('contul creat cu providerul real ajunge la funcția users (create) cu parola; persoana cu parolă temporară nu are „Retrimite invitația”', async () => {
    const temp = people.map((p) => (p.user_id === 'u-me' ? p : { ...p, last_sign_in_at: null, temporary_password: true }))
    const fake = fakeDataClient({ userId: 'u-me', tables, invoke: usersFn(undefined, { status: 'created', user_id: 'u-10' }, temp) })
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseUsers(fake.client) }) })
    await pageReady('Utilizatori')
    const r = await row('elena@stada.ro')
    expect(within(r).getByText('Parolă temporară')).toBeInTheDocument()
    expect(within(r).queryByRole('button', { name: /Retrimite invitația/ })).toBeNull()

    const form = await screen.findByRole('form', { name: 'Adaugă o persoană' })
    await userEvent.click(within(form).getByRole('radio', { name: /Creează contul cu parolă temporară/ }))
    await userEvent.type(within(form).getByLabelText('Email'), ' Dan@Stada.ro ')
    await userEvent.selectOptions(within(form).getByLabelText('Rol'), 'agency_admin')
    await userEvent.type(within(form).getByLabelText('Parolă temporară'), 'Temporar#2026')
    await userEvent.click(within(form).getByRole('button', { name: 'Creează contul' }))
    expect(await screen.findByRole('dialog', { name: 'Contul a fost creat' })).toBeInTheDocument()
    expect(fake.invocations.filter((c) => (c.body as { action?: string }).action === 'create')).toEqual([
      { name: 'users', body: { action: 'create', tenant_id: 't-1', email: 'dan@stada.ro', full_name: null, role: 'agency_admin', brand_ids: [], password: 'Temporar#2026' } },
    ])
  })

  it('fără client (neconfigurat): „Sursă neconectată" cu motiv', async () => {
    renderApp({ route: URL, wrap: (b) => ({ ...b, users: createSupabaseProviders().users }) })
    await pageReady('Utilizatori')
    expect((await screen.findAllByRole('heading', { name: 'Sursă neconectată' })).length).toBeGreaterThan(0)
  })
})

describe('generatePassword', () => {
  it('lungimea cerută, fără caractere ușor de confundat, din sursa aleatoare dată', () => {
    const p = generatePassword(16, (n) => Uint32Array.from({ length: n }, (_, i) => i * 7919))
    expect(p).toHaveLength(16)
    expect(p).not.toMatch(/[0O1lI]/)
    expect(generatePassword()).toHaveLength(16)
    expect(generatePassword()).not.toBe(generatePassword())
  })
})
