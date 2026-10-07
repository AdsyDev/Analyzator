import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { metric, warning } from '../test/factories'
import { KpiCard, type KpiCardProps } from './KpiCard'

function setup(over: Partial<KpiCardProps> = {}) {
  const onOpen = vi.fn()
  const utils = render(<KpiCard label="Sesiuni" definition="Numărul de sesiuni GA4 în perioadă." metric={metric()} onOpen={onOpen} compareLabel="față de perioada anterioară" {...over} />)
  return { onOpen, ...utils }
}

describe('KpiCard, stări', () => {
  it('ok: valoare, variație relativă în procente, sursă, „Date până la" și acoperire', () => {
    setup()
    expect(screen.getByText('1.240')).toBeInTheDocument()
    expect(screen.getByText('+12,7 %')).toBeInTheDocument()
    expect(screen.getByText('Google Analytics 4')).toBeInTheDocument()
    expect(screen.getByText(/Date până la/)).toBeInTheDocument()
    expect(screen.getByText('Complet')).toBeInTheDocument()
  })

  it('loading: schelet, fără valoare', () => {
    setup({ metric: null, loading: true })
    expect(screen.getByRole('status', { name: 'Se încarcă' })).toBeInTheDocument()
    expect(screen.queryByText('1.240')).toBeNull()
  })

  it('partial: motivul din acoperire (fracție) și procentul în badge', () => {
    setup({ metric: metric({ status: 'partial', coverage: 0.82 }) })
    expect(screen.getByText('Date disponibile pentru 82% din zilele intervalului.')).toBeInTheDocument()
    expect(screen.getByText('Parțial')).toBeInTheDocument()
    expect(screen.getByText('82%')).toBeInTheDocument()
  })

  it('partial cu rânduri excluse: spune și asta', () => {
    setup({ metric: metric({ status: 'partial', coverage: 0.9, warnings: [warning('excluded_rows', { detail: { reason: 'missing_weight', count: 2 } })] }) })
    expect(screen.getByText(/Unele rânduri au fost excluse din calcul/)).toBeInTheDocument()
  })

  it('partial cu valoare nulă (zero neconfirmat): nu arată 0, ci „Valoare neconfirmată"', () => {
    setup({ metric: metric({ status: 'partial', value: null, absolute_change: null, relative_change: null, coverage: 0.5, warnings: [warning('zero_not_confirmed')] }) })
    expect(screen.getByText('Valoare neconfirmată')).toBeInTheDocument()
    expect(screen.getByText('Valoarea 0 nu e confirmată: datele acoperă 50% din zilele intervalului.')).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getByText('Parțial')).toBeInTheDocument()
  })

  it('stale: valoarea rămâne, cu data ultimelor date și badge Învechit', () => {
    setup({ metric: metric({ status: 'stale', data_as_of: '2026-10-02' }) })
    expect(screen.getByText('1.240')).toBeInTheDocument()
    expect(screen.getByText(/Ultimele date sunt din 2 oct\.?\s2026/)).toBeInTheDocument()
    expect(screen.getByText('Învechit')).toBeInTheDocument()
  })

  it('insufficient_sample: valoare marcată cu motivul', () => {
    setup({ metric: metric({ status: 'insufficient_sample' }) })
    expect(screen.getByText('1.240')).toBeInTheDocument()
    expect(screen.getByText(/Eșantion mic: sub pragul minim/)).toBeInTheDocument()
  })

  it('base_zero: valoare fără variație relativă, cu explicație', () => {
    setup({ metric: metric({ status: 'base_zero', comparison_value: 0, relative_change: null, absolute_change: 40 }) })
    expect(screen.getByText(/baza de comparație e 0/)).toBeInTheDocument()
    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('cannot_compute: „Nu se poate calcula" și motivul, fără cifră', () => {
    setup({ metric: metric({ status: 'cannot_compute', value: null, absolute_change: null, relative_change: null, warnings: [warning('zero_denominator')] }), compareLabel: undefined })
    expect(screen.getByText('Nu se poate calcula')).toBeInTheDocument()
    expect(screen.getByText(/Numitorul este zero/)).toBeInTheDocument()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('unavailable (interogare eșuată): nu e zero și nu e sursă neconectată', () => {
    setup({ metric: metric({ status: 'unavailable', value: null, absolute_change: null, relative_change: null, warnings: [warning('query_failed')] }) })
    expect(screen.getByText('Fără date pentru interval')).toBeInTheDocument()
    expect(screen.getByText(/Sursa nu a răspuns la interogare/)).toBeInTheDocument()
    expect(screen.queryByText('Sursă neconectată')).toBeNull()
  })

  it('not_connected: „Sursă neconectată" cu motivul și numele sursei', () => {
    setup({ metric: metric({ status: 'not_connected', value: null, absolute_change: null, relative_change: null, source: 'planable', data_as_of: null }) })
    expect(screen.getByText('Sursă neconectată')).toBeInTheDocument()
    expect(screen.getByText(/Sursa Planable nu este conectată pentru acest brand/)).toBeInTheDocument()
    expect(screen.getByText('Indisponibil')).toBeInTheDocument()
  })

  it('not_connected cu sursă încă necunoscută: motiv generic, fără nume inventat', () => {
    setup({ metric: metric({ status: 'not_connected', value: null, absolute_change: null, relative_change: null, source: null, data_as_of: null }) })
    expect(screen.getByText(/^Sursa nu este conectată pentru acest brand/)).toBeInTheDocument()
  })

  it('error: mesaj și „Reîncearcă", diferit de lipsa sursei', async () => {
    const onRetry = vi.fn()
    setup({ metric: null, error: 'Serverul nu a răspuns.', onRetry })
    expect(screen.getByText('Nu am putut încărca datele')).toBeInTheDocument()
    expect(screen.queryByText('Sursă neconectată')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('zero real e o cifră, nu un gol', () => {
    setup({ metric: metric({ value: 0, absolute_change: 0, relative_change: 0 }) })
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('note din avertismente: perioadă incompletă și definiție provizorie', () => {
    setup({ metric: metric({ warnings: [warning('incomplete_period', { severity: 'info' }), warning('definition_draft', { severity: 'info', detail: 'Unitatea se confirmă pe payload.' })] }) })
    expect(screen.getByText('Perioadă incompletă.')).toBeInTheDocument()
    expect(screen.getByText('Definiție provizorie: Unitatea se confirmă pe payload.')).toBeInTheDocument()
  })

  it('afișează calificativul agregării lângă etichetă', () => {
    setup({ qualifier: 'medie în perioadă' })
    expect(screen.getByText('medie în perioadă')).toBeInTheDocument()
  })
})

describe('KpiCard, interacțiune', () => {
  it('se deschide la click și la tastatură', async () => {
    const { onOpen } = setup()
    const open = screen.getByRole('button', { name: 'Deschide dovezile pentru Sesiuni' })
    await userEvent.click(open)
    open.focus()
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('tooltipul de definiție se deschide la click, fără să deschidă dovezile', async () => {
    const { onOpen } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Ce înseamnă indicatorul' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Numărul de sesiuni GA4 în perioadă.')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('lower_is_better: scăderea e bună (verde) și poartă și text', () => {
    setup({ metric: metric({ relative_change: -20, absolute_change: -10 }), direction: 'lower_is_better' })
    expect(screen.getByText('−20 %').className).toMatch(/pos/)
  })

  it('higher_is_better: scăderea e rea', () => {
    setup({ metric: metric({ relative_change: -20, absolute_change: -10 }) })
    expect(screen.getByText('−20 %').className).toMatch(/neg/)
  })

  it('neutral: variația nu primește culoare pozitiv/negativ', () => {
    setup({ metric: metric({ relative_change: -20, absolute_change: -10 }), direction: 'neutral' })
    const cls = screen.getByText('−20 %').className
    expect(cls).not.toMatch(/pos|neg/)
  })
})
