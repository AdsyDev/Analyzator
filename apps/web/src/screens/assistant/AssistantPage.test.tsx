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
