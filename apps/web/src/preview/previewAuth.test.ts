import { describe, expect, it, vi } from 'vitest'
import { ROLES } from '../contracts'
import { PREVIEW_USERS, createPreviewAuth } from './previewAuth'

describe('sesiunea fictivă de previzualizare', () => {
  it('pornește ca agency_admin implicit, cu utilizator fictiv pe domeniul rezervat .example', () => {
    const a = createPreviewAuth()
    const s = a.getSnapshot()
    expect(s.status === 'signed_in' && s.user.role).toBe('agency_admin')
    for (const r of ROLES) expect(PREVIEW_USERS[r].email.endsWith('.example')).toBe(true)
  })

  it('comută între roluri și notifică abonații, cu snapshot stabil între schimbări', () => {
    const a = createPreviewAuth('agency_admin')
    const listener = vi.fn()
    a.subscribe(listener)
    const before = a.getSnapshot()
    expect(a.getSnapshot()).toBe(before)
    a.preview?.setRole('client_viewer')
    expect(listener).toHaveBeenCalledTimes(1)
    const after = a.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.status === 'signed_in' && after.user.role).toBe('client_viewer')
  })

  it('ieșirea și reintrarea: rolul rămâne cel ales', async () => {
    const a = createPreviewAuth('client_viewer')
    await a.signOut()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
    expect(a.preview?.role).toBe('client_viewer')
    a.preview?.signIn('agency_admin')
    const s = a.getSnapshot()
    expect(s.status === 'signed_in' && s.user.role).toBe('agency_admin')
  })

  it('un abonat dezabonat nu mai e notificat', () => {
    const a = createPreviewAuth('agency_admin')
    const l = vi.fn()
    const off = a.subscribe(l)
    off()
    a.preview?.setRole('account')
    expect(l).not.toHaveBeenCalled()
  })

  it('persistă rolul în sesiunea browserului și ignoră o valoare invalidă', () => {
    const a = createPreviewAuth('agency_admin')
    a.preview?.setRole('strategist')
    expect(window.sessionStorage.getItem('az-preview-session')).toBe('strategist')
    window.sessionStorage.setItem('az-preview-session', 'superuser')
    const b = createPreviewAuth()
    const s = b.getSnapshot()
    expect(s.status === 'signed_in' && s.user.role).toBe('agency_admin')
  })
})
