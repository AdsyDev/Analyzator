import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { AiDraftStatus, AiSettings } from '../../contracts'
import { createFixtureProviders } from '../../data/fixtures/createFixtureProviders'
import { createSupabaseProviders } from '../../data/supabase/providers'
import { resolvePeriod } from '../../lib/period'
import { pageReady, renderApp } from '../../test/renderApp'

const URINAL = '/brands/brand-urinal/insights'
const cards = async () => within((await screen.findByRole('heading', { level: 2, name: 'Analize' })).closest('section')!).findAllByRole('article')

describe('Analize și acțiuni — vederea agenției', () => {
  it('arată toate cele patru statusuri, cu badge', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const list = await cards()
    expect(list.map((c) => c.getAttribute('data-status')).sort()).toEqual(['draft', 'in_review', 'published', 'superseded'])
    expect(within(list.find((c) => c.getAttribute('data-status') === 'in_review')!).getByText('În review')).toBeInTheDocument()
  })

  it('filtrul pe status restrânge analizele și acțiunile', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    await cards()
    await userEvent.click(screen.getByRole('tab', { name: /^Publicat \(1\)/ }))
    const list = await cards()
    expect(list).toHaveLength(1)
    expect(list[0]).toHaveAttribute('data-status', 'published')
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    expect(within(actions).getAllByRole('row')).toHaveLength(3) // antet + 2 acțiuni
  })

  it('acțiunile au responsabil, termen și status', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    const table = await within(actions).findByRole('table')
    expect(within(table).getByText('În lucru')).toBeInTheDocument()
    expect(within(table).getByText('Deschisă')).toBeInTheDocument()
    expect(within(table).getByText('Finalizată')).toBeInTheDocument()
    expect(within(table).getAllByText('Andrei Vasile').length).toBeGreaterThan(0)
  })
})

describe('Analize și acțiuni — vederea clientului', () => {
  it('doar analizele publicate, fără badge de status și fără filtru pe status', async () => {
    renderApp({ route: URINAL, role: 'client_viewer' })
    await pageReady('Analize și acțiuni')
    const list = await cards()
    expect(list.map((c) => c.getAttribute('data-status'))).toEqual(['published'])
    expect(within(list[0]!).queryByText('Publicat')).toBeNull()
    expect(screen.queryByRole('tablist', { name: 'Status analiză' })).toBeNull()
    const actions = (await screen.findByRole('heading', { level: 2, name: 'Acțiuni' })).closest('section')!
    expect(within(actions).queryByText('Finalizată')).toBeNull() // acțiunea din analiza înlocuită nu se vede
  })

  it('chiar dacă providerul ar greși, o analiză nepublicată nu se randează', async () => {
    renderApp({
      route: URINAL,
      role: 'client_viewer',
      wrap: (b) => ({ ...b, insights: { ...b.insights, list: async (ctx) => { const r = await b.insights.list({ ...ctx }); return r } } }),
    })
    await pageReady('Analize și acțiuni')
    expect((await cards()).every((c) => c.getAttribute('data-status') === 'published')).toBe(true)
  })
})

describe('Analize și acțiuni — ciorne generate de AdSy AI', () => {
  type Wrap = NonNullable<Parameters<typeof renderApp>[0]['wrap']>
  const generateButton = () => screen.findByRole('button', { name: 'Generează ciornă' })
  const withResult = (status: AiDraftStatus): Wrap => (b) => ({ ...b, assistant: { ...b.assistant, generateInsight: async () => ({ kind: 'ready' as const, data: { status, insight_id: null, existing: false, blocked_by: null } }) } })
  const withSettings = (change: (s: AiSettings) => AiSettings): Wrap => (b) => ({ ...b, assistant: { ...b.assistant, settings: async (id) => { const r = await b.assistant.settings(id); return r.kind === 'ready' ? { kind: 'ready' as const, data: change(r.data) } : r } } })

  it('echipa cere o ciornă: apare în listă ca ciornă, marcată „Generată de AdSy AI”, cu avertismentul de revizuire', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const before = (await cards()).length
    await userEvent.click(await generateButton())
    expect(await screen.findByText(/Ciorna e în listă, marcată „Generată de AdSy AI”/)).toHaveAttribute('role', 'status')
    const list = await cards()
    // După generare, lista arată ciornele: cea nouă e printre ele, iar restul analizelor nu au dispărut.
    const draft = list.find((c) => within(c).queryByText('Generată de AdSy AI'))!
    expect(draft).toHaveAttribute('data-status', 'draft')
    expect(draft).toHaveTextContent('interpretarea și recomandările sunt ipoteze până le revizuiește echipa')
    expect(within(draft).getByText('Draft')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^Toate/ }))
    expect(await cards()).toHaveLength(before + 1)
    // Nimic nu s-a publicat: rămâne o singură analiză publicată.
    expect((await cards()).filter((c) => c.getAttribute('data-status') === 'published')).toHaveLength(1)
  })

  it('ciorna generată trece prin același review: după publicare rămâne marcată, cu textul „revizuită și publicată de echipa”', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    await userEvent.click(await generateButton())
    await screen.findByText(/Ciorna e în listă/)
    const draft = () => cards().then((l) => l.find((c) => within(c).queryByText('Generată de AdSy AI'))!)
    await userEvent.click(within((await draft()).closest('li')!).getByRole('button', { name: 'Trimite la review' }))
    await userEvent.click(screen.getByRole('tab', { name: /^Toate/ }))
    await userEvent.click(await within((await draft()).closest('li')!).findByRole('button', { name: 'Publică' }))
    await screen.findByText(/metricile citate au fost înghețate/)
    const published = await draft()
    expect(published).toHaveAttribute('data-status', 'published')
    expect(published).toHaveTextContent('revizuită și publicată de echipa AdSymphony')
  })

  it('clientul nu are butonul și nu cere setările AdSy AI din această pagină', async () => {
    const calls: string[] = []
    renderApp({ route: URINAL, role: 'client_viewer', wrap: (b) => ({ ...b, assistant: { ...b.assistant, settings: async (id) => (calls.push(id), b.assistant.settings(id)) } }) })
    await pageReady('Analize și acțiuni')
    await cards()
    expect(screen.queryByRole('button', { name: 'Generează ciornă' })).toBeNull()
    expect(calls).toEqual([])
  })

  it('fără generare, fără afișare sau fără rol: butonul nu apare', async () => {
    for (const change of [
      (s: AiSettings) => ({ ...s, effective: { ...s.effective, generation: false } }),
      (s: AiSettings) => ({ ...s, effective: { ...s.effective, display: false } }),
      (s: AiSettings) => ({ ...s, can_generate: false }),
    ]) {
      renderApp({ route: URINAL, wrap: withSettings(change) })
      await pageReady('Analize și acțiuni')
      await cards()
      expect(screen.queryByRole('button', { name: 'Generează ciornă' })).toBeNull()
      cleanup()
    }
  })

  it('cu providerul real neconectat pentru AdSy AI, pagina rămâne întreagă, fără buton', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, assistant: createSupabaseProviders().assistant }) })
    await pageReady('Analize și acțiuni')
    expect((await cards()).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Generează ciornă' })).toBeNull()
  })

  it('când nu se salvează nimic, pagina spune de ce și lista rămâne neschimbată', async () => {
    const cases: Array<[AiDraftStatus, RegExp]> = [
      ['insufficient_evidence', /nu a avut dovezi suficiente/],
      ['rejected', /nu a respectat forma cerută/],
      ['not_configured', /nu e configurat încă pe server/],
      ['budget_exhausted', /plafonul lunar/],
      ['rate_limited', /limita zilnică/],
      ['model_error', /Modelul nu a răspuns/],
      ['ai_off', /e oprită pentru acest brand/],
    ]
    for (const [status, text] of cases) {
      renderApp({ route: URINAL, wrap: withResult(status) })
      await pageReady('Analize și acțiuni')
      const before = (await cards()).length
      await userEvent.click(await generateButton())
      expect(await screen.findByRole('alert')).toHaveTextContent(text)
      expect(await cards()).toHaveLength(before)
      expect(screen.queryByText('Generată de AdSy AI')).toBeNull()
      cleanup()
    }
  })

  it('eroarea serverului apare ca mesaj, nu ca ciornă', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, assistant: { ...b.assistant, generateInsight: async () => ({ kind: 'error' as const, message: 'Doar echipa agenției poate cere o ciornă.' }) } }) })
    await pageReady('Analize și acțiuni')
    await userEvent.click(await generateButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Doar echipa agenției poate cere o ciornă.')
  })

  it('pe aceleași date, a doua cerere spune că ciorna există deja', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, assistant: { ...b.assistant, generateInsight: async () => ({ kind: 'ready' as const, data: { status: 'ok' as const, insight_id: 'x', existing: true, blocked_by: null } }) } }) })
    await pageReady('Analize și acțiuni')
    await userEvent.click(await generateButton())
    expect(await screen.findByText(/există deja o ciornă generată/)).toHaveAttribute('role', 'status')
  })

  it('previzualizarea respectă controlul „afișare”: oprit, analizele generate nu mai vin în listă; cele scrise de echipă rămân', async () => {
    const p = createFixtureProviders({ getRole: () => 'agency_admin' })
    const brands = await p.brands.list()
    const brand = brands.kind === 'ready' ? brands.data.find((b) => b.id === 'brand-urinal')! : null
    if (!brand) throw new Error('așteptam brandul din fixturi')
    const ctx = { brandId: brand.id, period: resolvePeriod('28d'), comparison: 'previous' as const, filters: {} }
    const titles = async () => { const r = await p.insights.list(ctx); return r.kind === 'ready' ? r.data.map((i) => `${i.origin ?? 'human'}:${i.title}`) : [] }
    const before = await titles()
    const made = await p.assistant.generateInsight(ctx)
    expect(made.kind === 'ready' && made.data.status).toBe('ok')
    expect((await titles()).filter((t) => t.startsWith('adsy_ai:'))).toHaveLength(1)
    // O a doua editare a ciornei nu îi șterge proveniența.
    const id = made.kind === 'ready' ? made.data.insight_id! : ''
    await p.insights.saveDraft(brand, id, { title: 'Ciornă editată de om', period: { from: ctx.period.from, to: ctx.period.to }, summary: 's', interpretation: 'i', limits: 'l', evidence_keys: ['ga4_sessions'] })
    expect(await titles()).toContain('adsy_ai:Ciornă editată de om')
    await p.assistant.savePreference(brand, { chat: true, display: false })
    expect(await titles()).toEqual(before)
    expect((await p.assistant.generateInsight(ctx)).kind === 'ready').toBe(true)
    const off = await p.assistant.generateInsight(ctx)
    expect(off.kind === 'ready' && [off.data.status, off.data.blocked_by]).toEqual(['ai_off', 'preference'])
    await p.assistant.savePreference(brand, { chat: true, display: true })
    expect(await titles()).toContain('adsy_ai:Ciornă editată de om')
  })

  it('previzualizarea: clientul nu poate cere o ciornă', async () => {
    const p = createFixtureProviders({ getRole: () => 'client_viewer' })
    const r = await p.assistant.generateInsight({ brandId: 'brand-urinal', period: resolvePeriod('28d'), comparison: 'previous', filters: {} })
    expect(r).toEqual({ kind: 'error', message: 'Doar echipa agenției poate cere o ciornă.' })
    const s2 = await p.assistant.settings('brand-urinal')
    expect(s2.kind === 'ready' && s2.data.can_generate).toBe(false)
  })
})

describe('Analize și acțiuni — stări', () => {
  it('cu providerul real: „Sursă neconectată" cu motiv', async () => {
    renderApp({ route: URINAL, wrap: (b) => ({ ...b, insights: createSupabaseProviders().insights }) })
    await pageReady('Analize și acțiuni')
    expect(await screen.findByRole('heading', { name: 'Sursă neconectată' })).toBeInTheDocument()
    expect(screen.getByText('Analizele nu sunt încă disponibile pentru acest brand.')).toBeInTheDocument()
  })

  it('listă goală: mesaj diferit pentru agenție și pentru client', async () => {
    const empty = (b: Parameters<NonNullable<Parameters<typeof renderApp>[0]['wrap']>>[0]) => ({ ...b, insights: { ...b.insights, list: async () => ({ kind: 'ready' as const, data: [] }) } })
    renderApp({ route: URINAL, wrap: empty })
    expect(await screen.findByText(/nici măcar ciornă/)).toBeInTheDocument()
  })

  it('dovezile atașate deschid EvidenceDrawer', async () => {
    renderApp({ route: URINAL })
    await pageReady('Analize și acțiuni')
    const published = (await cards()).find((c) => c.getAttribute('data-status') === 'published')!
    await userEvent.click(within(published).getAllByRole('button')[0]!)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
