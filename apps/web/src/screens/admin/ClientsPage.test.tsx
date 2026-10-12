import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createSupabaseClients } from '../../data/supabase/clientsProvider'
import { fakeDataClient } from '../../test/fakeDataClient'
import { pageReady, renderApp, where } from '../../test/renderApp'

const URL = '/admin/clients'
const client = (name: string) => screen.findByRole('region', { name })

describe('Administrare → Clienți și site-uri (fixtures de previzualizare)', () => {
  it('arată clientul cu spațiile lui: domeniu, conexiuni, status', async () => {
    renderApp({ route: URL })
    await pageReady('Clienți și site-uri')
    const card = await client('STADA România')
    expect(within(card).getByText('3 spații active')).toBeInTheDocument()
    const table = within(card).getByRole('table', { name: 'Spațiile de brand ale clientului STADA România' })
    expect(within(table).getByText('urinal.example')).toBeInTheDocument()
    expect(within(table).getAllByText('Activ')).toHaveLength(3)
  })

  it('„Adaugă client” creează clientul și primul site, apoi trimite spre Surse', async () => {
    renderApp({ route: URL })
    await pageReady('Clienți și site-uri')
    await userEvent.click(screen.getByRole('button', { name: 'Adaugă client' }))
    const panel = await screen.findByRole('dialog', { name: 'Adaugă un client' })
    await userEvent.type(within(panel).getByLabelText('Numele clientului'), 'Farma Nouă')
    expect(within(panel).getByLabelText('Identificator')).toHaveValue('farma-noua')
    await userEvent.click(within(panel).getByRole('button', { name: 'Continuă' }))
    await userEvent.type(within(panel).getByLabelText('Numele site-ului (brandul)'), 'Vitamina X')
    await userEvent.type(within(panel).getByLabelText('Domeniu'), 'https://www.vitaminax.ro/produse')
    expect(within(panel).getByText('Se salvează ca vitaminax.ro.')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Creează clientul' }))
    expect(await within(panel).findByText('Vitamina X a fost adăugat pentru Farma Nouă.')).toBeInTheDocument()
    const card = await client('Farma Nouă')
    expect(within(card).getByText('vitaminax.ro')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Conectează sursele' }))
    await waitFor(() => expect(where()).toBe('/admin/sources'))
  })

  it('domeniul invalid blochează crearea și explică de ce', async () => {
    renderApp({ route: URL })
    await pageReady('Clienți și site-uri')
    const card = await client('STADA România')
    await userEvent.click(within(card).getByRole('button', { name: 'Adaugă site' }))
    const panel = await screen.findByRole('dialog', { name: 'Adaugă un site' })
    await userEvent.type(within(panel).getByLabelText('Numele site-ului (brandul)'), 'Nou')
    await userEvent.type(within(panel).getByLabelText('Domeniu'), 'nu e domeniu')
    expect(within(panel).getByText('Domeniul nu pare valid. Exemplu: exemplu.ro')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Creează site-ul' })).toBeDisabled()
  })

  it('un site se arhivează și se restaurează din „Editează”', async () => {
    renderApp({ route: URL })
    await pageReady('Clienți și site-uri')
    const card = await client('STADA România')
    await userEvent.click(within(card).getByRole('button', { name: 'Editează Proenzi' }))
    let dialog = await screen.findByRole('dialog', { name: 'Editează Proenzi' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Arhivează' }))
    await waitFor(() => expect(within(card).getByText('2 spații active')).toBeInTheDocument())
    expect(within(card).queryByRole('button', { name: 'Deschide Proenzi' })).toBeNull()
    await userEvent.click(within(card).getByRole('button', { name: 'Editează Proenzi' }))
    dialog = await screen.findByRole('dialog', { name: 'Editează Proenzi' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restaurează' }))
    await waitFor(() => expect(within(card).getByText('3 spații active')).toBeInTheDocument())
  })

  it('clientul se redenumește; arhivarea clientului nu e oferită', async () => {
    renderApp({ route: URL })
    await pageReady('Clienți și site-uri')
    const card = await client('STADA România')
    await userEvent.click(within(card).getByRole('button', { name: 'Redenumește' }))
    const dialog = await screen.findByRole('dialog', { name: 'Redenumește clientul' })
    expect(within(dialog).queryByRole('button', { name: /Arhivează/ })).toBeNull()
    const input = within(dialog).getByLabelText('Numele clientului')
    await userEvent.clear(input)
    await userEvent.type(input, 'STADA RO')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvează' }))
    expect(await client('STADA RO')).toBeInTheDocument()
  })
})

describe('createSupabaseClients', () => {
  const tables = () => ({
    tenants: [{ id: 't1', slug: 'stada', name: 'STADA', status: 'active', created_at: '2026-03-01T10:00:00Z' }],
    brands: [
      { id: 'b1', tenant_id: 't1', slug: 'urinal', name: 'Urinal', domain: 'urinal.ro', status: 'active', created_at: '2026-03-01T10:00:00Z' },
      { id: 'b2', tenant_id: 't1', slug: 'vechi', name: 'Vechi', domain: null, status: 'archived', created_at: '2026-03-02T10:00:00Z' },
    ],
    source_connections: [
      { brand_id: 'b1', status: 'active' },
      { brand_id: 'b1', status: 'active' },
      { brand_id: null, status: 'active' },
      { brand_id: 'b2', status: 'archived' },
    ],
  })

  it('grupează spațiile pe client, include arhivatele și numără doar conexiunile active ale brandului', async () => {
    const { client } = fakeDataClient({ tables: tables() })
    const r = await createSupabaseClients(client).list()
    expect(r.kind).toBe('ready')
    if (r.kind !== 'ready') return
    expect(r.data[0]!.spaces.map((s) => [s.id, s.status, s.connections])).toEqual([
      ['b1', 'active', 2],
      ['b2', 'archived', 0],
    ])
  })

  it('creează clientul cu id generat în browser, fără să ceară rândul înapoi', async () => {
    const { client, calls } = fakeDataClient({ tables: tables() })
    const r = await createSupabaseClients(client, () => 'uuid-1').createClient({ name: '  Farma  ', slug: 'farma' })
    expect(r).toEqual({ kind: 'ready', data: { id: 'uuid-1' } })
    expect(calls.find((c) => c.op === 'insert')).toMatchObject({ table: 'tenants', payload: { id: 'uuid-1', slug: 'farma', name: 'Farma' } })
  })

  it('erorile bazei de date devin mesaje în română', async () => {
    const dup = fakeDataClient({ errors: { 'tenants:insert': { code: '23505', message: 'duplicate' } } })
    expect(await createSupabaseClients(dup.client).createClient({ name: 'Farma', slug: 'farma' })).toEqual({ kind: 'error', message: 'Există deja un client cu acest identificator. Alege altul.' })
    const denied = fakeDataClient({ errors: { 'brands:insert': { code: '42501', message: 'rls' } } })
    expect(await createSupabaseClients(denied.client).createSpace('t1', { name: 'Site', slug: 'site', domain: null })).toEqual({ kind: 'error', message: 'Doar administratorii agenției pot face această modificare.' })
  })

  it('validează înainte de cerere și normalizează domeniul', async () => {
    const { client, calls } = fakeDataClient({ tables: tables() })
    const p = createSupabaseClients(client, () => 'uuid-2')
    expect((await p.createSpace('t1', { name: 'Site', slug: 'Site Nou', domain: null })).kind).toBe('error')
    expect((await p.createSpace('t1', { name: 'Site', slug: 'site', domain: 'nu e domeniu' })).kind).toBe('error')
    expect(calls.filter((c) => c.op === 'insert')).toHaveLength(0)
    await p.createSpace('t1', { name: 'Site', slug: 'site', domain: 'HTTPS://www.Site.ro/' })
    expect(calls.find((c) => c.op === 'insert')).toMatchObject({ table: 'brands', payload: { tenant_id: 't1', domain: 'site.ro' } })
  })
})
