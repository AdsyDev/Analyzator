import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { failed, ready, type AiReply, type AiReplyStatus, type DataProviders } from '../../contracts'
import { pageReady, renderApp } from '../../test/renderApp'

const ROUTE = '/brands/brand-minimartieni/assistant'
const open = () => pageReady('AdSy AI')
const section = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('section')!
const reply = (status: AiReplyStatus, o: Partial<AiReply> = {}): AiReply => ({ status, answer: null, blocked_by: null, cached: false, model_id: 'm', prompt_version: 'chat-v1', ...o })
const answering = (r: AiReply) => (b: DataProviders): DataProviders => ({ ...b, assistant: { ...b.assistant, ask: async () => ready(r) } })
async function ask(text = 'Cum au mers sesiunile?') {
  const s = section('Întreabă AdSy AI')
  await userEvent.type(await within(s).findByLabelText('Întrebarea ta'), text)
  await userEvent.click(within(s).getByRole('button', { name: 'Întreabă' }))
  return s
}

describe('AdSy AI: chatul pe dovezi', () => {
  it('întrebarea rămâne în conversație; răspunsul e marcat generat și nevalidat, cu perioada și dovezile lui', async () => {
    renderApp({ route: ROUTE })
    await open()
    const s = await ask()
    const r = await within(s).findByRole('article', { name: 'Răspuns AdSy AI' })
    expect(within(s).getByText('Cum au mers sesiunile?')).toBeInTheDocument()
    expect(r).toHaveAttribute('data-status', 'ok')
    expect(r).toHaveTextContent('Generat de AdSy AI')
    expect(r).toHaveTextContent('Nevalidat de echipă')
    expect(r).toHaveTextContent(/Perioada .+ - .+\d{4}/)
    expect(within(r).getByLabelText('Dovezi')).toBeInTheDocument()
    await userEvent.click(within(r).getByRole('button', { name: 'Sesiuni' }))
    expect(await screen.findByRole('dialog', { name: 'Dovezi' })).toHaveTextContent('Sesiuni')
  })

  it('o întrebare prea scurtă nu pleacă', async () => {
    const calls: string[] = []
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, ask: async (c, q) => (calls.push(q), b.assistant.ask(c, q)) } }) })
    await open()
    const s = section('Întreabă AdSy AI')
    await userEvent.type(await within(s).findByLabelText('Întrebarea ta'), 'a')
    expect(within(s).getByRole('button', { name: 'Întreabă' })).toBeDisabled()
    expect(calls).toEqual([])
  })

  it('dovezi insuficiente: concluzia nu se arată, doar ce lipsește', async () => {
    renderApp({ route: ROUTE, wrap: answering(reply('insufficient_evidence', { answer: { summary: '', evidence: [], limitations: 'Nu există date despre conversii.', proposed_action: null, period: { start: '2026-10-14', end: '2026-11-10' }, requires_review: true } })) })
    await open()
    const r = await within(await ask()).findByRole('article', { name: 'Răspuns AdSy AI' })
    expect(r).toHaveAttribute('data-status', 'insufficient_evidence')
    expect(r).toHaveTextContent('Dovezi insuficiente')
    expect(r).toHaveTextContent('Ce lipsește. Nu există date despre conversii.')
    expect(r).not.toHaveTextContent('Generat de AdSy AI')
  })

  it.each([
    ['out_of_scope', 'În afara datelor brandului'],
    ['rejected', 'Răspuns respins'],
    ['budget_exhausted', 'Plafonul lunar a fost atins'],
    ['rate_limited', 'Prea multe întrebări azi'],
    ['model_error', 'AdSy AI nu a putut răspunde'],
  ] as const)('starea %s are explicația ei, fără răspuns inventat', async (status, title) => {
    renderApp({ route: ROUTE, wrap: answering(reply(status)) })
    await open()
    const r = await within(await ask()).findByRole('article', { name: 'Răspuns AdSy AI' })
    expect(r).toHaveAttribute('data-status', status)
    expect(r).toHaveTextContent(title)
  })

  it('o eroare a serverului apare ca eroare, nu ca răspuns', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, ask: async () => failed('AdSy AI nu a putut răspunde. Reîncearcă.') } }) })
    await open()
    const s = await ask()
    expect(await within(s).findByRole('alert')).toHaveTextContent('AdSy AI nu a putut răspunde. Reîncearcă.')
    expect(within(s).queryByRole('article', { name: 'Răspuns AdSy AI' })).toBeNull()
  })

  it('serverul fără model configurat: explicația, fără câmp de întrebare', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, serverStatus: async () => ready({ configured: false, model_id: null, prompt_version: 'chat-v1' }) } }) })
    await open()
    const s = section('Întreabă AdSy AI')
    expect(await within(s).findByText('AdSy AI nu e configurat încă')).toBeInTheDocument()
    expect(within(s).queryByLabelText('Întrebarea ta')).toBeNull()
  })
})

describe('AdSy AI: controalele', () => {
  it('preferința personală oprește chatul: câmpul dispare, starea efectivă o spune, politica rămâne', async () => {
    renderApp({ route: ROUTE, role: 'client_viewer' })
    await open()
    const mine = screen.getByRole('group', { name: 'Preferința ta' })
    expect(within(mine).getByRole('switch', { name: /^Chat/ })).toBeChecked()
    await userEvent.click(within(mine).getByRole('switch', { name: /^Chat/ }))
    await waitFor(() => expect(within(section('Întreabă AdSy AI')).getByText(/Ai oprit chatul din preferințele tale/)).toBeInTheDocument())
    expect(within(section('Întreabă AdSy AI')).queryByLabelText('Întrebarea ta')).toBeNull()
    expect(screen.getByRole('group', { name: 'Preferința ta' })).toHaveTextContent('Pentru tine acum: chat oprit')
    expect(section('Controale AdSy AI')).toHaveTextContent('Chat')
  })

  it('clientul și strategistul văd politica brandului, fără să o poată schimba', async () => {
    for (const role of ['client_viewer', 'strategist'] as const) {
      const { unmount } = renderApp({ route: ROUTE, role }) as unknown as { unmount?: () => void }
      await open()
      const s = section('Controale AdSy AI')
      expect(within(s).queryByRole('group', { name: 'Politica brandului' })).toBeNull()
      expect(s).toHaveTextContent('Politica o stabilește administratorul agenției.')
      expect(within(s).getAllByText(/^(Permis|Oprit)$/)).toHaveLength(3)
      expect(s).not.toHaveTextContent('Consum luna aceasta')
      unmount?.()
      document.body.innerHTML = ''
    }
  })

  it('administratorul agenției schimbă politica; chatul oprit din politică nu mai poate fi pornit din preferință', async () => {
    renderApp({ route: ROUTE, role: 'agency_admin' })
    await open()
    const policy = screen.getByRole('group', { name: 'Politica brandului' })
    expect(within(policy).getAllByRole('switch')).toHaveLength(3)
    expect(policy).toHaveTextContent('Consum luna aceasta')
    await userEvent.click(within(policy).getByRole('switch', { name: /^Chat/ }))
    await waitFor(() => expect(within(section('Întreabă AdSy AI')).getByText(/prin politica brandului/)).toBeInTheDocument())
    expect(within(screen.getByRole('group', { name: 'Preferința ta' })).getByRole('switch', { name: /^Chat/ })).toBeChecked()
    expect(screen.getByRole('group', { name: 'Preferința ta' })).toHaveTextContent('Oprit de politica brandului; preferința ta nu îl poate porni.')
  })

  it('plafonul lunar: se salvează doar un număr întreg schimbat', async () => {
    const saved: number[] = []
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, savePolicy: async (brand, p) => (saved.push(p.monthly_token_cap), b.assistant.savePolicy(brand, p)) } }) })
    await open()
    const policy = screen.getByRole('group', { name: 'Politica brandului' })
    const save = within(policy).getByRole('button', { name: 'Salvează plafonul' })
    expect(save).toBeDisabled()
    await userEvent.clear(within(policy).getByLabelText('Plafon lunar (tokeni)'))
    await userEvent.type(within(policy).getByLabelText('Plafon lunar (tokeni)'), '500000x')
    await userEvent.click(save)
    await waitFor(() => expect(saved).toEqual([500000]))
  })

  it('refuzul serverului la o schimbare apare ca mesaj', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, savePreference: async () => failed('Nu ai dreptul să schimbi această setare.') } }) })
    await open()
    await userEvent.click(within(screen.getByRole('group', { name: 'Preferința ta' })).getByRole('switch', { name: /^Afișare/ }))
    expect(await within(section('Controale AdSy AI')).findByRole('alert')).toHaveTextContent('Nu ai dreptul să schimbi această setare.')
  })
})

describe('AdSy AI: documente aprobate', () => {
  const docs = () => section('Documente aprobate')
  async function add(o: { title?: string; owner?: string; text?: string } = {}) {
    await userEvent.click(within(docs()).getByRole('button', { name: 'Adaugă document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Document nou' })
    await userEvent.type(within(dialog).getByLabelText('Titlu'), o.title ?? 'Prospect')
    if (o.owner !== '') await userEvent.type(within(dialog).getByLabelText('Cine răspunde de document la brand'), o.owner ?? 'Departamentul medical')
    await userEvent.type(within(dialog).getByLabelText('Textul documentului'), o.text ?? 'Un comprimat pe zi.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvează ca ciornă' }))
  }
  const item = (title: string) => within(docs()).getByText(title).closest('li')!

  it('fără documente: stare goală care spune din ce răspunde AdSy AI', async () => {
    renderApp({ route: ROUTE })
    await open()
    expect(await within(docs()).findByText('Niciun document')).toBeInTheDocument()
    expect(docs()).toHaveTextContent('răspunde doar din indicatori și din analizele publicate')
  })

  it('un document nou intră ca ciornă, nu ca aprobat; aprobarea e un pas separat, iar retragerea îl scoate din context', async () => {
    renderApp({ route: ROUTE })
    await open()
    await within(docs()).findByText('Niciun document')
    await add()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Document nou' })).toBeNull())
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'draft'))
    expect(within(item('Prospect')).getByText('Ciornă')).toBeInTheDocument()
    expect(item('Prospect')).toHaveTextContent('1 fragment')
    expect(item('Prospect')).toHaveTextContent('răspunde: Departamentul medical')
    await userEvent.click(within(item('Prospect')).getByRole('button', { name: 'Aprobă' }))
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'approved'))
    expect(within(item('Prospect')).queryByRole('button', { name: 'Șterge ciorna' })).toBeNull()
    await userEvent.click(within(item('Prospect')).getByRole('button', { name: 'Retrage' }))
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'retired'))
    expect(within(item('Prospect')).queryAllByRole('button')).toHaveLength(0)
  })

  it('aprobarea fără responsabil e refuzată, cu motivul; documentul rămâne ciornă', async () => {
    renderApp({ route: ROUTE })
    await open()
    await within(docs()).findByText('Niciun document')
    await add({ owner: '' })
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'draft'))
    await userEvent.click(within(item('Prospect')).getByRole('button', { name: 'Aprobă' }))
    expect(await within(docs()).findByRole('alert')).toHaveTextContent('Aprobarea cere responsabilul documentului')
    expect(item('Prospect')).toHaveAttribute('data-status', 'draft')
  })

  it('formularul cere titlu și text înainte să trimită ceva', async () => {
    const calls: unknown[] = []
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, addDocument: async (brand, d) => (calls.push(d), b.assistant.addDocument(brand, d)) } }) })
    await open()
    await userEvent.click(await within(docs()).findByRole('button', { name: 'Adaugă document' }))
    const dialog = await screen.findByRole('dialog', { name: 'Document nou' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvează ca ciornă' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('are nevoie de un titlu')
    await userEvent.type(within(dialog).getByLabelText('Titlu'), 'Prospect')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvează ca ciornă' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Lipește textul documentului')
    expect(calls).toEqual([])
  })

  it('account poate adăuga și șterge ciorne, dar nu are butoanele de aprobare și retragere', async () => {
    renderApp({ route: ROUTE, role: 'account' })
    await open()
    await within(docs()).findByText('Niciun document')
    await add()
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'draft'))
    expect(within(item('Prospect')).queryByRole('button', { name: 'Aprobă' })).toBeNull()
    await userEvent.click(within(item('Prospect')).getByRole('button', { name: 'Șterge ciorna' }))
    expect(await within(docs()).findByText('Niciun document')).toBeInTheDocument()
  })

  it('clientul vede doar documentele aprobate, fără nicio acțiune', async () => {
    const approved = { id: 'd1', title: 'Prospect', doc_type: 'product_info' as const, product: null, country: 'RO', language: 'ro', version: '2.0', owner: 'Medical', status: 'approved' as const, approved_at: '2026-11-01T10:00:00+02:00', valid_from: '2026-01-01', valid_to: null, fragments: 4, created_at: '2026-10-30T10:00:00+02:00' }
    renderApp({ route: ROUTE, role: 'client_viewer', wrap: (b) => ({ ...b, assistant: { ...b.assistant, documents: async () => ready([approved]) } }) })
    await open()
    await waitFor(() => expect(item('Prospect')).toHaveAttribute('data-status', 'approved'))
    expect(item('Prospect')).toHaveTextContent('Informații de produs · versiunea 2.0 · RO, ro')
    expect(item('Prospect')).toHaveTextContent('4 fragmente')
    expect(within(docs()).queryAllByRole('button')).toHaveLength(0)
  })

  it('un document aprobat, dar expirat sau încă nevalabil, spune că nu intră în context', async () => {
    const base = { doc_type: 'faq' as const, product: null, country: 'RO', language: 'ro', version: '1', owner: 'Medical', status: 'approved' as const, approved_at: '2020-01-01T10:00:00+02:00', fragments: 1, created_at: '2020-01-01T10:00:00+02:00' }
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, documents: async () => ready([{ ...base, id: 'old', title: 'Vechi', valid_from: '2020-01-01', valid_to: '2020-12-31' }, { ...base, id: 'new', title: 'Viitor', valid_from: '2999-01-01', valid_to: null }]) } }) })
    await open()
    await waitFor(() => expect(item('Vechi')).toBeInTheDocument())
    expect(within(item('Vechi')).getByRole('note')).toHaveTextContent('Expirat: nu mai intră în context.')
    expect(within(item('Viitor')).getByRole('note')).toHaveTextContent('Încă nevalabil')
  })

  it('lista de documente căzută are „Reîncearcă” doar la ea; chatul și controalele rămân', async () => {
    renderApp({ route: ROUTE, wrap: (b) => ({ ...b, assistant: { ...b.assistant, documents: async () => failed('Datele nu au putut fi citite.') } }) })
    await open()
    expect(await within(docs()).findByRole('button', { name: 'Reîncearcă' })).toBeInTheDocument()
    expect(section('Întreabă AdSy AI')).toBeInTheDocument()
    expect(section('Controale AdSy AI')).toBeInTheDocument()
  })

  it('un răspuns care citează un document arată dovada ca „Document aprobat”, separat de indicatori', async () => {
    const answer = { summary: 'Documentul aprobat spune: un comprimat pe zi.', evidence: [{ id: 'doc:f1', kind: 'document' as const, label: 'Prospect · Administrare', document_id: 'd1' }], limitations: '', proposed_action: null, period: { start: '2026-10-14', end: '2026-11-10' }, requires_review: true as const }
    renderApp({ route: ROUTE, wrap: answering(reply('ok', { answer })) })
    await open()
    const s = await ask('Ce spune prospectul?')
    const r = await within(s).findByRole('article', { name: 'Răspuns AdSy AI' })
    expect(within(r).getByRole('link', { name: 'Document aprobat: Prospect · Administrare' })).toHaveAttribute('href', '/brands/brand-minimartieni/assistant#ai-documents')
  })
})

