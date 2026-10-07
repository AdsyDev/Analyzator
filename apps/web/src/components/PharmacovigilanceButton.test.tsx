import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { failed, notConnected, ready, type PvFlag, type PvItemRef, type PvSnapshot } from '../contracts'
import { PharmacovigilanceButton } from './PharmacovigilanceButton'
import { ToastProvider } from './ui/Toast'

const item: PvItemRef = { kind: 'mention', id: 'm1' }
const snapshot: PvSnapshot = {
  item,
  at: '2026-10-06T10:15:00+03:00',
  user: 'Elena Dobre, STADA',
  link: 'https://forum.example.ro/t/123',
  text: 'După două zile de tratament am avut greață.',
  notify: ['farmacovigilenta@stada.ro', 'Mihai Dumitrescu (QPPV)'],
}
const flag: PvFlag = { id: 'f1', item, flagged_at: '2026-10-06T10:15:30+03:00', flagged_by: 'u1', notified: true, status: 'notified' }

function setup(over: Partial<React.ComponentProps<typeof PharmacovigilanceButton>> = {}) {
  const loadSnapshot = vi.fn().mockResolvedValue(ready(snapshot))
  const onConfirm = vi.fn().mockResolvedValue(ready(flag))
  const onFlagged = vi.fn()
  render(
    <ToastProvider>
      <PharmacovigilanceButton item={item} flag={null} loadSnapshot={loadSnapshot} onConfirm={onConfirm} onFlagged={onFlagged} {...over} />
    </ToastProvider>,
  )
  return { loadSnapshot, onConfirm, onFlagged }
}

describe('PharmacovigilanceButton', () => {
  it('nemarcat: buton care nu înregistrează nimic până la confirmare', async () => {
    const { onConfirm } = setup()
    expect(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' })).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('dialogul arată exact ce se înregistrează și ce urmează', async () => {
    const { loadSnapshot } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    const dlg = await screen.findByRole('dialog', { name: 'Marchează pentru farmacovigilență' })
    expect(loadSnapshot).toHaveBeenCalledWith(item)
    expect(dlg).toHaveTextContent('Marcajul rămâne în jurnal și nu poate fi șters, doar adnotat.')
    expect(dlg).toHaveTextContent('Elena Dobre, STADA')
    expect(dlg).toHaveTextContent('https://forum.example.ro/t/123')
    expect(dlg).toHaveTextContent('„După două zile de tratament am avut greață."')
    expect(dlg).toHaveTextContent('Ce urmează')
    expect(dlg).toHaveTextContent('farmacovigilenta@stada.ro, Mihai Dumitrescu (QPPV)')
  })

  it('„Anulează" închide fără să marcheze', async () => {
    const { onConfirm } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Anulează' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirmarea marchează, închide dialogul, anunță prin toast și trece în starea persistentă', async () => {
    const { onConfirm, onFlagged } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Marchează și notifică' }))
    expect(onConfirm).toHaveBeenCalledWith(item)
    expect(onFlagged).toHaveBeenCalledWith(flag)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Marcat pentru farmacovigilență. Contactele PV au fost notificate.')).toBeInTheDocument()
    const marked = screen.getByRole('button', { name: /Marcat pentru farmacovigilență,/ })
    expect(marked).toBeDisabled()
  })

  it('marcat (din props): dezactivat, cu data, fără a deschide dialogul', async () => {
    setup({ flag })
    const b = screen.getByRole('button', { name: /Marcat pentru farmacovigilență,/ })
    expect(b).toBeDisabled()
    expect(b).toHaveTextContent(/6 oct\.?\s2026/)
    expect(b).toHaveAttribute('title', 'Marcajul rămâne în jurnal și nu poate fi șters.')
  })

  it('eșec la înregistrare: rămâne în dialog, cu mesaj, nemarcat', async () => {
    setup({ onConfirm: vi.fn().mockResolvedValue(failed('Serverul nu a răspuns.')) })
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Marchează și notifică' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nu am putut înregistra marcajul: Serverul nu a răspuns.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Marcat pentru farmacovigilență,/ })).toBeNull()
  })

  it('snapshot indisponibil: nu se poate confirma ce nu se vede', async () => {
    setup({ loadSnapshot: vi.fn().mockResolvedValue(notConnected('Sursa nu e conectată.')) })
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    expect(await screen.findByText('Sursa nu e conectată.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Marchează și notifică' })).toBeDisabled()
  })

  it('fără contacte PV configurate, spune asta, nu promite notificare', async () => {
    setup({ loadSnapshot: vi.fn().mockResolvedValue(ready({ ...snapshot, notify: [] })) })
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    expect(await screen.findByText(/nu există contacte de farmacovigilență configurate/)).toBeInTheDocument()
  })

  it('notificare încă în curs: mesaj distinct', async () => {
    setup({ onConfirm: vi.fn().mockResolvedValue(ready({ ...flag, notified: false, status: 'pending' })) })
    await userEvent.click(screen.getByRole('button', { name: 'Marchează pentru farmacovigilență' }))
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: 'Marchează și notifică' }))
    expect(await screen.findByText('Marcajul e înregistrat. Notificarea contactelor PV e în curs.')).toBeInTheDocument()
  })
})
