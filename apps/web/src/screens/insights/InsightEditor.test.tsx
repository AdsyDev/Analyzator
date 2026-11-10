import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { DataProviders } from '../../contracts'
import { pageReady, renderApp } from '../../test/renderApp'

const PROENZI = '/brands/brand-proenzi/insights'
const URINAL = '/brands/brand-urinal/insights'
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const article = (title: string) => screen.findByRole('article', { name: title })
/** Pașii unei analize anume: brandul poate avea și alte ciorne. */
const steps = async (title: string) => within(await screen.findByRole('group', { name: `Pași pentru ${title}` }))

async function newDraft(title: string, { complete = true } = {}) {
  await userEvent.click(await screen.findByRole('button', { name: 'Analiză nouă' }))
  const dlg = await screen.findByRole('dialog', { name: 'Analiză nouă' })
  await userEvent.type(within(dlg).getByLabelText('Titlu'), title)
  if (complete) {
    await userEvent.type(within(dlg).getByLabelText('Constatare'), 'Sesiunile au scăzut.')
    await userEvent.type(within(dlg).getByLabelText('Interpretare'), 'Posibil sezonalitate.')
    await userEvent.type(within(dlg).getByLabelText('Limite'), 'Patru săptămâni de date.')
    await userEvent.click(within(dlg).getByRole('checkbox', { name: 'Sesiuni' }))
  }
  await userEvent.click(within(dlg).getByRole('button', { name: 'Salvează ciorna' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  return article(title)
}

describe('editorul de analize (agenție)', () => {
  it('„Analiză nouă”: ciorna salvată apare cu perioada din filtre și dovezile bifate', async () => {
    renderApp({ route: `${PROENZI}?period=custom&from=2026-09-08&to=2026-10-05` })
    await pageReady('Analize și acțiuni')
    const card = await newDraft('Trafic în scădere')
    expect(card).toHaveAttribute('data-status', 'draft')
    expect(card).toHaveTextContent('8 sept. - 5 oct. 2026')
    expect(within(card).getByRole('button', { name: 'Sesiuni' })).toBeInTheDocument()
    expect(await screen.findByText('Ciorna a fost salvată.')).toBeInTheDocument()
  })

  it('fără titlu nu se salvează; mesajul rămâne în formular', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await userEvent.click(await screen.findByRole('button', { name: 'Analiză nouă' }))
    const dlg = await screen.findByRole('dialog', { name: 'Analiză nouă' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvează ciorna' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Analiza are nevoie de un titlu.')
  })

  it('trimiterea la review a unei ciorne incomplete e refuzată, cu lista a ce lipsește', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await newDraft('Ciornă goală', { complete: false })
    await userEvent.click((await steps('Ciornă goală')).getByRole('button', { name: 'Trimite la review' }))
    expect(await screen.findByText('Analiza nu poate fi trimisă la review; lipsesc: constatare, interpretare, limite, dovezi.')).toBeInTheDocument()
    expect(await article('Ciornă goală')).toHaveAttribute('data-status', 'draft')
  })

  it('drumul complet: ciornă → editare → review → publicare; după publicare nu se mai editează', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await newDraft('Analiză de publicat')
    await userEvent.click((await steps('Analiză de publicat')).getByRole('button', { name: 'Editează' }))
    const dlg = await screen.findByRole('dialog', { name: 'Editează ciorna' })
    expect(within(dlg).getByLabelText('Interpretare')).toHaveValue('Posibil sezonalitate.')
    expect(within(dlg).getByRole('checkbox', { name: 'Sesiuni' })).toBeChecked()
    await userEvent.type(within(dlg).getByLabelText('Titlu'), ' (rev)')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvează ciorna' }))
    const title = 'Analiză de publicat (rev)'
    await article(title)

    await userEvent.click((await steps(title)).getByRole('button', { name: 'Trimite la review' }))
    await waitFor(async () => expect(await article(title)).toHaveAttribute('data-status', 'in_review'))
    expect((await steps(title)).queryByRole('button', { name: 'Editează' })).toBeNull()

    await userEvent.click((await steps(title)).getByRole('button', { name: 'Publică' }))
    await waitFor(async () => expect(await article(title)).toHaveAttribute('data-status', 'published'))
    expect(await screen.findByText('Analiza a fost publicată; metricile citate au fost înghețate.')).toBeInTheDocument()
    expect((await steps(title)).queryByRole('button', { name: 'Editează' })).toBeNull()
    expect((await steps(title)).queryByRole('button', { name: 'Șterge ciorna' })).toBeNull()
    expect((await steps(title)).getByRole('button', { name: 'Adaugă acțiune' })).toBeInTheDocument()
  })

  it('returnarea la draft cere un motiv', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await newDraft('De returnat')
    await userEvent.click((await steps('De returnat')).getByRole('button', { name: 'Trimite la review' }))
    await waitFor(async () => expect(await article('De returnat')).toHaveAttribute('data-status', 'in_review'))
    await userEvent.click((await steps('De returnat')).getByRole('button', { name: 'Returnează la draft' }))
    const dlg = await screen.findByRole('dialog', { name: 'Returnează la draft' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Returnează' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Completează: motiv.')
    await userEvent.type(within(dlg).getByLabelText('Motiv'), 'Lipsește comparația cu luna trecută.')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Returnează' }))
    await waitFor(async () => expect(await article('De returnat')).toHaveAttribute('data-status', 'draft'))
  })

  it('account nu poate publica: vede că analiza așteaptă review-ul', async () => {
    renderApp({ route: PROENZI, role: 'account' })
    await pageReady('Analize și acțiuni')
    await newDraft('Scrisă de account')
    await userEvent.click((await steps('Scrisă de account')).getByRole('button', { name: 'Trimite la review' }))
    await waitFor(async () => expect(await article('Scrisă de account')).toHaveAttribute('data-status', 'in_review'))
    expect((await steps('Scrisă de account')).getByText('Așteaptă review-ul unui strategist sau al unui administrator.')).toBeInTheDocument()
    expect((await steps('Scrisă de account')).queryByRole('button', { name: 'Publică' })).toBeNull()
  })

  it('ștergerea e doar pentru ciorne', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await newDraft('De șters')
    await userEvent.click((await steps('De șters')).getByRole('button', { name: 'Șterge ciorna' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'De șters' })).toBeNull())
    expect(await screen.findByText('Ciorna a fost ștearsă.')).toBeInTheDocument()
  })
})

describe('recomandări și versiuni noi (agenție)', () => {
  it('o ciornă primește recomandări cu prioritate; apar în analiză și se pot șterge', async () => {
    renderApp({ route: PROENZI })
    await pageReady('Analize și acțiuni')
    await newDraft('Cu recomandări')
    await userEvent.click((await steps('Cu recomandări')).getByRole('button', { name: 'Recomandări (0)' }))
    const dlg = await screen.findByRole('dialog', { name: 'Recomandări' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Adaugă recomandarea' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Completează problema, recomandarea și beneficiul așteptat.')
    await userEvent.type(within(dlg).getByLabelText('Problema'), 'Pagina nu răspunde la întrebările din panel.')
    await userEvent.type(within(dlg).getByLabelText('Ce recomandăm'), 'Rescrie ghidul de mobilitate')
    await userEvent.type(within(dlg).getByLabelText('Beneficiu așteptat'), 'Mai multe mențiuni pe topic.')
    await userEvent.selectOptions(within(dlg).getByLabelText('Prioritate'), '1 (cea mai mare)')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Adaugă recomandarea' }))
    const list = await within(await screen.findByRole('dialog', { name: 'Recomandări' })).findByRole('list', { name: 'Recomandările analizei' })
    expect(list).toHaveTextContent('Rescrie ghidul de mobilitate')
    expect(list).toHaveTextContent('Prioritate 1')
    // Analiza le arată; butonul le numără.
    expect(await article('Cu recomandări')).toHaveTextContent('Rescrie ghidul de mobilitate')
    expect((await steps('Cu recomandări')).getByRole('button', { name: 'Recomandări (1)' })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Recomandări' })).getByRole('button', { name: 'Șterge recomandarea: Rescrie ghidul de mobilitate' }))
    await waitFor(async () => expect((await steps('Cu recomandări')).getByRole('button', { name: 'Recomandări (0)' })).toBeInTheDocument())
  })

  it('o analiză publicată nu se editează: „Versiune nouă” creează o ciornă cu dovezile copiate, iar publicarea ei o înlocuiește pe cea veche', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const title = 'Vizibilitatea în răspunsurile AI scade pe criteriile de alegere'
    const published = await article(title)
    expect(within(published.closest('li')!).queryByRole('button', { name: 'Editează' })).toBeNull()
    await userEvent.click(within(published.closest('li')!).getByRole('button', { name: 'Versiune nouă' }))
    await waitFor(() => expect(screen.getAllByRole('article', { name: title })).toHaveLength(2))
    const draft = screen.getAllByRole('article', { name: title }).find((a) => a.getAttribute('data-status') === 'draft')!
    expect(within(draft).getByRole('button', { name: 'AI Mention Rate' })).toBeInTheDocument()
    const draftSteps = within(within(draft.closest('li')!).getByRole('group'))
    // A doua versiune de înlocuire e refuzată cât prima e în lucru.
    const still = screen.getAllByRole('article', { name: title }).find((a) => a.getAttribute('data-status') === 'published')!
    await userEvent.click(within(still.closest('li')!).getByRole('button', { name: 'Versiune nouă' }))
    expect(await screen.findByText('Analiza are deja o versiune de înlocuire în lucru.')).toBeInTheDocument()

    await userEvent.click(draftSteps.getByRole('button', { name: 'Trimite la review' }))
    const inReview = async () => screen.getAllByRole('article', { name: title }).find((a) => a.getAttribute('data-status') === 'in_review')
    await waitFor(async () => expect(await inReview()).toBeDefined())
    await userEvent.click(within((await inReview())!.closest('li')!).getByRole('button', { name: 'Publică' }))
    await waitFor(() => expect(screen.getAllByRole('article', { name: title }).map((a) => a.getAttribute('data-status')).sort()).toEqual(['published', 'superseded']))
  })
})

describe('registrul acțiunilor (agenție)', () => {
  it('agency_admin alege responsabilul dintre membrii activi ai agenției din clientul brandului; ceilalți rămân responsabili ei înșiși', async () => {
    // Pe date reale, membrii agenției au rolul lor în tenantul clientului; fixtures îi țin într-un tenant al agenției.
    const inClientTenant = (b: DataProviders): DataProviders => ({
      ...b,
      users: { ...b.users, people: async () => { const r = await b.users.people(); return r.kind === 'ready' ? { ...r, data: r.data.map((p) => ({ ...p, tenant_id: 'tenant-stada-preview' })) } : r } },
    })
    renderApp({ route: URINAL, wrap: inClientTenant })
    await pageReady('Analize și acțiuni')
    const published = await article('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')
    await userEvent.click(within(published.closest('li')!).getByRole('button', { name: 'Adaugă acțiune' }))
    const dlg = await screen.findByRole('dialog', { name: 'Acțiune nouă' })
    const owner = await within(dlg).findByLabelText('Responsabil')
    const names = within(owner).getAllByRole('option').map((o) => o.textContent)
    expect(names[0]).toBe('Eu')
    expect(names).toContain('Andrei Vasile')
    expect(names).not.toContain('Elena Dobre')
    await userEvent.type(within(dlg).getByLabelText('Ce facem'), 'Audit de conținut')
    await userEvent.selectOptions(owner, 'Andrei Vasile')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Adaugă acțiunea' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const row = (await within(section('Acțiuni')).findByText('Audit de conținut')).closest('tr')!
    expect(row).toHaveTextContent('Andrei Vasile')
  })

  it('strategistul nu are selector de responsabil', async () => {
    renderApp({ route: URINAL, role: 'strategist' })
    await pageReady('Analize și acțiuni')
    const published = await article('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')
    await userEvent.click(within(published.closest('li')!).getByRole('button', { name: 'Adaugă acțiune' }))
    const dlg = await screen.findByRole('dialog', { name: 'Acțiune nouă' })
    expect(within(dlg).queryByLabelText('Responsabil')).toBeNull()
    expect(dlg).toHaveTextContent('Responsabilul ești tu')
  })

  it('o acțiune nouă are efort și KPI urmărit; apoi parcurge agreat → în lucru → finalizat → rezultat', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const published = await article('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')
    await userEvent.click(within(published.closest('li')!).getByRole('button', { name: 'Adaugă acțiune' }))
    const dlg = await screen.findByRole('dialog', { name: 'Acțiune nouă' })
    await userEvent.type(within(dlg).getByLabelText('Ce facem'), 'Rescrie pagina de prevenție')
    await userEvent.type(within(dlg).getByLabelText('Efort estimat'), '2 zile')
    await userEvent.selectOptions(within(dlg).getByLabelText('KPI urmărit'), 'AI Mention Rate')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Adaugă acțiunea' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const row = async () => (await within(section('Acțiuni')).findByText('Rescrie pagina de prevenție')).closest('tr')!
    expect(await row()).toHaveTextContent('Efort: 2 zile · KPI: AI Mention Rate')
    for (const stepName of ['Marchează agreată', 'Începe lucrul', 'Marchează finalizată']) {
      await userEvent.click(within(await row()).getByRole('button', { name: `${stepName}: Rescrie pagina de prevenție` }))
      await waitFor(async () => expect(within(await row()).queryByRole('button', { name: `${stepName}: Rescrie pagina de prevenție` })).toBeNull())
    }
    await userEvent.click(within(await row()).getByRole('button', { name: 'Notează rezultatul: Rescrie pagina de prevenție' }))
    const note = await screen.findByRole('dialog', { name: 'Rezultatul observat' })
    await userEvent.type(within(note).getByLabelText('Rezultat'), 'Rata a urcat cu 3 p.p.')
    await userEvent.click(within(note).getByRole('button', { name: 'Salvează rezultatul' }))
    await waitFor(async () => expect(await row()).toHaveTextContent('Rezultat: Rata a urcat cu 3 p.p.'))
    expect(within(await row()).queryByRole('button')).toBeNull()
  })

  it('anularea cere un motiv', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const cancel = (await within(section('Acțiuni')).findAllByRole('button', { name: /^Anulează: / }))[0]!
    await userEvent.click(cancel)
    const dlg = await screen.findByRole('dialog', { name: 'Anulează acțiunea' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anulează acțiunea' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Completează: motiv.')
  })
})

describe('clientul nu are editor', () => {
  it('nu vede „Analiză nouă”, pașii analizelor sau pașii acțiunilor', async () => {
    renderApp({ route: URINAL, role: 'client_viewer' })
    await pageReady('Analize și acțiuni')
    await article('Vizibilitatea în răspunsurile AI scade pe criteriile de alegere')
    expect(screen.queryByRole('button', { name: 'Analiză nouă' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adaugă acțiune' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Pas următor' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Plan' })).toBeNull()
  })

  it('chiar apelat direct, providerul refuză scrierea pentru client', async () => {
    const { providers } = renderApp({ route: URINAL, role: 'client_viewer' })
    await pageReady('Analize și acțiuni')
    const brand = { id: 'brand-urinal', tenant_id: 't', tenant_name: null, name: 'Urinal', category: null, domain: null }
    const r = await providers.insights.saveDraft(brand, null, { title: 'x', period: { from: '2026-10-01', to: '2026-10-07' }, summary: '', interpretation: '', limits: '', evidence_keys: [] })
    expect(r.kind).toBe('error')
  })
})
