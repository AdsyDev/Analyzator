import { describe, expect, it, vi } from 'vitest'
import { fakeAuthBackend, flush } from '../test/fakeAuthBackend'
import { createAuthSource, createUnconfiguredAuth, pickMembership } from './createAuthSource'

const SESSION = { userId: 'u1', email: 'elena.dobre@stada.example', fullName: 'Elena Dobre' }
const opts = { redirectTo: 'https://app.example/login' }

describe('pickMembership', () => {
  it('rolul cel mai larg câștigă; fără membership valid, null', () => {
    expect(pickMembership([{ role: 'client_viewer', organization: 'STADA' }, { role: 'strategist', organization: 'AdSymphony' }])?.role).toBe('strategist')
    expect(pickMembership([{ role: 'account', organization: 'A' }, { role: 'agency_admin', organization: 'B' }])?.role).toBe('agency_admin')
    expect(pickMembership([])).toBeNull()
    expect(pickMembership([{ role: 'superuser' as never, organization: 'X' }])).toBeNull()
  })
})

describe('createAuthSource: sesiunea', () => {
  it('pornește în loading, apoi signed_out fără sesiune', async () => {
    const { backend } = fakeAuthBackend()
    const a = createAuthSource(backend, opts)
    expect(a.getSnapshot()).toEqual({ status: 'loading' })
    await flush()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
  })

  it('cu sesiune și membership: signed_in cu rolul și organizația din baza de date, nu din client', async () => {
    const { backend } = fakeAuthBackend({ session: SESSION, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, opts)
    await flush()
    expect(a.getSnapshot()).toEqual({ status: 'signed_in', user: { id: 'u1', name: 'Elena Dobre', email: 'elena.dobre@stada.example', role: 'client_viewer', organization: 'STADA' } })
  })

  it('fără nume în profil, folosește partea locală a adresei, nu inventează', async () => {
    const { backend } = fakeAuthBackend({ session: { ...SESSION, fullName: null }, memberships: [{ role: 'account', organization: 'AdSymphony' }] })
    const a = createAuthSource(backend, opts)
    await flush()
    expect(a.getSnapshot().status === 'signed_in' && (a.getSnapshot() as { user: { name: string } }).user.name).toBe('elena.dobre')
  })

  it('sesiune fără membership activ (revocat): deconectează și nu dă acces', async () => {
    const { backend, api } = fakeAuthBackend({ session: SESSION, memberships: [] })
    const a = createAuthSource(backend, opts)
    await flush()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
    expect(api.calls.map((c) => c[0])).toContain('signOut')
  })

  it('eroare la citirea membership-urilor: nu intră, fără acces implicit', async () => {
    const { backend, api } = fakeAuthBackend({ session: SESSION })
    api.membershipsThrows = true
    const a = createAuthSource(backend, opts)
    await flush()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
  })

  it('evenimentul SIGNED_OUT închide sesiunea; TOKEN_REFRESHED nu schimbă starea', async () => {
    const { backend, api } = fakeAuthBackend({ session: SESSION, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, opts)
    await flush()
    const before = a.getSnapshot()
    api.emit('TOKEN_REFRESHED', SESSION)
    await flush()
    expect(a.getSnapshot()).toBe(before)
    api.emit('SIGNED_OUT', null)
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
  })

  it('abonații sunt notificați și se pot dezabona', async () => {
    const { backend } = fakeAuthBackend()
    const a = createAuthSource(backend, opts)
    const l = vi.fn()
    const off = a.subscribe(l)
    await flush()
    expect(l).toHaveBeenCalled()
    off()
    l.mockClear()
    await a.signOut()
    expect(l).not.toHaveBeenCalled()
  })
})

describe('createAuthSource: signIn', () => {
  it('reușește, trimite emailul fără spații și transmite „ține-mă minte"', async () => {
    const { backend, api } = fakeAuthBackend({ memberships: [{ role: 'agency_admin', organization: 'AdSymphony' }] })
    const a = createAuthSource(backend, opts)
    await flush()
    const r = await a.signIn({ email: '  ioana@adsymphony.example ', password: 'parola-lunga', remember: false })
    expect(r).toEqual({ ok: true })
    expect(api.calls).toContainEqual(['remember', false])
    expect(api.calls).toContainEqual(['signIn', 'ioana@adsymphony.example', 'parola-lunga'])
    expect(a.getSnapshot().status).toBe('signed_in')
  })

  it.each([
    [{ status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ status: 400, message: 'Invalid login credentials' }, 'invalid_credentials'],
    [{ status: 429, code: 'over_request_rate_limit', message: 'x' }, 'rate_limited'],
    [{ status: 500, message: 'x' }, 'network'],
    [{ message: 'Failed to fetch' }, 'network'],
    [{ status: 418, message: 'x' }, 'unknown'],
  ] as const)('eroarea serverului %j devine codul generic %s, fără textul serverului', async (err, code) => {
    const { backend, api } = fakeAuthBackend()
    api.signInError = { ...err }
    const a = createAuthSource(backend, opts)
    await flush()
    expect(await a.signIn({ email: 'a@b.example', password: 'x', remember: true })).toEqual({ ok: false, code })
    expect(a.getSnapshot().status).toBe('signed_out')
  })

  it('o excepție de rețea nu rămâne necaptată', async () => {
    const { backend, api } = fakeAuthBackend()
    api.signInThrows = true
    const a = createAuthSource(backend, opts)
    expect(await a.signIn({ email: 'a@b.example', password: 'x', remember: true })).toEqual({ ok: false, code: 'network' })
  })

  it('parolă corectă, dar fără membership: no_access, iar sesiunea e închisă', async () => {
    const { backend, api } = fakeAuthBackend({ memberships: [] })
    const a = createAuthSource(backend, opts)
    await flush()
    expect(await a.signIn({ email: 'a@b.example', password: 'x', remember: true })).toEqual({ ok: false, code: 'no_access' })
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
    expect(api.calls.map((c) => c[0])).toContain('signOut')
  })
})

describe('createAuthSource: resetarea parolei', () => {
  it('trimite emailul și adresa de întoarcere configurată', async () => {
    const { backend, api } = fakeAuthBackend()
    const a = createAuthSource(backend, opts)
    expect(await a.requestPasswordReset(' x@y.example ')).toEqual({ ok: true })
    expect(api.calls).toContainEqual(['reset', 'x@y.example', 'https://app.example/login'])
  })

  it('nu dezvăluie existența contului: eroarea „utilizator inexistent” arată ca succes', async () => {
    const { backend, api } = fakeAuthBackend()
    api.resetError = { status: 400, code: 'user_not_found', message: 'User not found' }
    expect(await createAuthSource(backend, opts).requestPasswordReset('nu-exista@y.example')).toEqual({ ok: true })
  })

  it('dar limitarea de cereri și căderea rețelei se raportează', async () => {
    const { backend, api } = fakeAuthBackend()
    api.resetError = { status: 429, code: 'over_email_send_rate_limit', message: 'x' }
    expect(await createAuthSource(backend, opts).requestPasswordReset('a@b.example')).toEqual({ ok: false, code: 'rate_limited' })
    api.resetError = { status: 503, message: 'x' }
    expect(await createAuthSource(backend, opts).requestPasswordReset('a@b.example')).toEqual({ ok: false, code: 'network' })
  })
})

describe('createAuthSource: invitație și resetare (alegerea parolei)', () => {
  const invited = { userId: 'u9', email: 'nou@stada.example', fullName: null }

  it('linkul de invitație cu sesiune temporară duce la password_setup, nu în aplicație', async () => {
    const { backend } = fakeAuthBackend({ session: invited, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, { ...opts, initialLink: 'invite' })
    await flush()
    expect(a.getSnapshot()).toEqual({ status: 'password_setup', kind: 'invite', email: 'nou@stada.example' })
  })

  it('alegerea parolei: refuză parola scurtă, apoi salvează numele și parola și intră', async () => {
    const consumed = vi.fn()
    const { backend, api } = fakeAuthBackend({ session: invited, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, { ...opts, initialLink: 'invite', onLinkConsumed: consumed })
    await flush()
    expect(await a.completePasswordSetup({ fullName: 'Nou Venit', password: 'scurta' })).toEqual({ ok: false, code: 'weak_password' })
    expect(api.calls.some((c) => c[0] === 'update')).toBe(false)
    expect(await a.completePasswordSetup({ fullName: 'Nou Venit', password: 'parola-buna-123' })).toEqual({ ok: true })
    expect(api.calls).toContainEqual(['update', { fullName: 'Nou Venit', password: 'parola-buna-123' }])
    expect(consumed).toHaveBeenCalledTimes(1)
    expect(a.getSnapshot().status).toBe('signed_in')
  })

  it('resetarea parolei: fără nume, care nu se suprascrie', async () => {
    const { backend, api } = fakeAuthBackend({ session: SESSION, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, { ...opts, initialLink: 'recovery' })
    await flush()
    expect(a.getSnapshot()).toMatchObject({ status: 'password_setup', kind: 'recovery' })
    await a.completePasswordSetup({ password: 'alta-parola-123' })
    expect(api.calls).toContainEqual(['update', { password: 'alta-parola-123' }])
  })

  it('evenimentul PASSWORD_RECOVERY cere alegerea parolei', async () => {
    const { backend, api } = fakeAuthBackend({ session: SESSION, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    const a = createAuthSource(backend, opts)
    await flush()
    api.emit('PASSWORD_RECOVERY', SESSION)
    await flush()
    expect(a.getSnapshot()).toMatchObject({ status: 'password_setup', kind: 'recovery' })
  })

  it('fără link activ sau fără sesiune: expired_link, nu o parolă schimbată pe nimeni', async () => {
    const { backend, api } = fakeAuthBackend()
    const a = createAuthSource(backend, opts)
    await flush()
    expect(await a.completePasswordSetup({ fullName: 'X', password: 'parola-buna-123' })).toEqual({ ok: false, code: 'expired_link' })
    expect(api.calls.some((c) => c[0] === 'update')).toBe(false)
  })

  it('serverul refuză cu 401/403: expired_link; cu 422: weak_password', async () => {
    const { backend, api } = fakeAuthBackend({ session: invited })
    const a = createAuthSource(backend, { ...opts, initialLink: 'invite' })
    await flush()
    api.updateError = { status: 401, message: 'x' }
    expect(await a.completePasswordSetup({ fullName: 'X', password: 'parola-buna-123' })).toEqual({ ok: false, code: 'expired_link' })
    api.updateError = { status: 422, code: 'weak_password', message: 'x' }
    expect(await a.completePasswordSetup({ fullName: 'X', password: 'parola-buna-123' })).toEqual({ ok: false, code: 'weak_password' })
    expect(a.getSnapshot().status).toBe('password_setup')
  })

  it('mesajul de link expirat se consumă o singură dată', () => {
    const { backend } = fakeAuthBackend()
    const a = createAuthSource(backend, { ...opts, initialNotice: 'expired_link' })
    expect(a.consumeNotice()).toBe('expired_link')
    expect(a.consumeNotice()).toBeNull()
  })

  it('ieșirea din cont în timpul alegerii parolei anulează invitația locală', async () => {
    const { backend } = fakeAuthBackend({ session: invited })
    const a = createAuthSource(backend, { ...opts, initialLink: 'invite' })
    await flush()
    await a.signOut()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
  })
})

describe('createUnconfiguredAuth', () => {
  it('fără Supabase configurat: fără sesiune și fără intrare, cu cod explicit', async () => {
    const a = createUnconfiguredAuth()
    expect(a.getSnapshot()).toEqual({ status: 'signed_out' })
    expect(await a.signIn({ email: 'a@b.example', password: 'x', remember: true })).toEqual({ ok: false, code: 'unavailable' })
    expect(await a.requestPasswordReset('a@b.example')).toEqual({ ok: false, code: 'unavailable' })
    expect(a.preview).toBeUndefined()
  })
})
