import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { createAuthSource, createUnconfiguredAuth, type BackendSession } from '../auth/createAuthSource'
import { AUTH_MESSAGES, passwordStrength } from '../auth/messages'
import type { AuthSource } from '../auth/types'
import { createPreviewAuth } from '../preview/previewAuth'
import { fakeAuthBackend, flush } from '../test/fakeAuthBackend'
import { ThemeProvider } from '../theme/ThemeProvider'
import { LoginPage, safeFrom } from './LoginPage'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))
  document.documentElement.removeAttribute('data-az-theme')
})

function renderLogin(auth: AuthSource, entry: string | { pathname: string; state?: unknown } = '/login') {
  return render(
    <ThemeProvider>
      <AuthProvider source={auth}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="*" element={<p>în aplicație</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  )
}

const real = (init: Parameters<typeof fakeAuthBackend>[0] = {}, opts: { initialLink?: 'invite' | 'recovery'; initialNotice?: 'expired_link' } = {}) => {
  const fb = fakeAuthBackend(init)
  const auth = createAuthSource(fb.backend, { redirectTo: 'https://app.example/login', ...opts })
  return { ...fb, auth }
}

describe('autentificare', () => {
  it('conținutul din design: titlu, câmpuri, „ține-mă minte", „Ai uitat parola?"', async () => {
    const { auth } = real()
    renderLogin(auth)
    expect(await screen.findByRole('heading', { name: 'Bine ai revenit' })).toBeInTheDocument()
    expect(screen.getByText('Intră în spațiul tău de brand intelligence.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email de serviciu')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Parolă')).toHaveAttribute('type', 'password')
    expect(screen.getByRole('checkbox', { name: 'Ține-mă minte pe acest dispozitiv' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Ai uitat parola?' })).toBeInTheDocument()
  })

  it('fără signup: niciun link sau buton de înregistrare, doar mențiunea invitației', async () => {
    const { auth } = real()
    renderLogin(auth)
    await screen.findByRole('heading', { name: 'Bine ai revenit' })
    expect(screen.queryByText(/înregistr|creează cont|signup|sign up/i)).toBeNull()
    expect(screen.getAllByText(/doar pe bază de invitație/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Folosește linkul din emailul de invitație/)).toBeInTheDocument()
  })

  it('titlul primește focus la afișare (anunț pentru cititoare de ecran)', async () => {
    const { auth } = real()
    renderLogin(auth)
    expect(await screen.findByRole('heading', { name: 'Bine ai revenit' })).toHaveFocus()
  })

  it('câmpuri goale: eroare generică, fără apel la server', async () => {
    const { auth, api } = real()
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Intră în cont' }))
    expect(screen.getByRole('alert')).toHaveTextContent(AUTH_MESSAGES.invalid_credentials)
    expect(api.calls.some((c) => c[0] === 'signIn')).toBe(false)
  })

  it('credențiale greșite: același mesaj generic, câmpurile marcate invalid, parola păstrată pentru corectare', async () => {
    const { auth, api } = real()
    api.signInError = { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'cineva@stada.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'gresita')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email sau parolă incorecte.')
    expect(screen.queryByText(/Invalid login credentials/)).toBeNull()
    expect(screen.getByLabelText('Email de serviciu')).toHaveAttribute('aria-invalid', 'true')
  })

  it.each([
    [{ status: 429, code: 'over_request_rate_limit', message: 'x' }, 'rate_limited'],
    [{ status: 503, message: 'x' }, 'network'],
  ] as const)('eroarea %j are mesajul ei, în română', async (err, code) => {
    const { auth, api } = real()
    api.signInError = { ...err }
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES[code])
  })

  it('intrare reușită: transmite „ține-mă minte" și ajunge în aplicație', async () => {
    const { auth, api } = real({ memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'elena@stada.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'parola-buna')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ține-mă minte pe acest dispozitiv' }))
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByText('în aplicație')).toBeInTheDocument()
    expect(api.calls).toContainEqual(['remember', false])
  })

  it('cont fără acces: mesaj dedicat, fără intrare', async () => {
    const { auth } = real({ memberships: [] })
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.no_access)
    expect(screen.queryByText('în aplicație')).toBeNull()
  })

  it('buton blocat și aria-busy cât durează cererea', async () => {
    const { auth, api, backend } = real()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const original = backend.signInWithPassword
    backend.signInWithPassword = async (...a) => (await gate, original(...a))
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(screen.getByRole('button', { name: 'Intră în cont' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Intră în cont' })).toHaveAttribute('aria-busy', 'true')
    release()
    await waitFor(() => expect(api.calls.some((c) => c[0] === 'signIn')).toBe(true))
  })

  it('mediu fără Supabase configurat: mesaj explicit, nu o intrare fictivă', async () => {
    renderLogin(createUnconfiguredAuth())
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.unavailable)
  })

  it('linkul de invitație expirat e anunțat o singură dată', async () => {
    const { auth } = real({}, { initialNotice: 'expired_link' })
    renderLogin(auth)
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.expired_link)
  })

  it('comutatorul de temă funcționează și pe login', async () => {
    const { auth } = real()
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Comută la tema închisă' }))
    expect(document.documentElement.getAttribute('data-az-theme')).toBe('dark')
  })

  it('cu sesiune activă, trimite la adresa cerută inițial (doar internă)', async () => {
    const { auth } = real({ session: { userId: 'u', email: 'a@b.example', fullName: 'A' }, memberships: [{ role: 'client_viewer', organization: 'STADA' }] })
    renderLogin(auth, { pathname: '/login', state: { from: { pathname: '/brands/b1/ai', search: '?period=7d' } } })
    expect(await screen.findByText('în aplicație')).toBeInTheDocument()
  })
})

describe('safeFrom (fără redirect deschis)', () => {
  it.each([
    [{ from: { pathname: '/brands/b1/ai', search: '?period=7d' } }, '/brands/b1/ai?period=7d'],
    [{ from: { pathname: '//evil.example/x' } }, '/'],
    [{ from: { pathname: 'https://evil.example' } }, '/'],
    [{ from: { pathname: '/login' } }, '/'],
    [{ from: { pathname: 5 } }, '/'],
    [null, '/'],
    [undefined, '/'],
    ['text', '/'],
  ])('%j → %s', (state, expected) => {
    expect(safeFrom(state)).toBe(expected)
  })
})

describe('resetarea parolei', () => {
  it('de la „Ai uitat parola?" la „Verifică emailul", cu adresa în mesaj', async () => {
    const { auth, api } = real()
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Ai uitat parola?' }))
    expect(await screen.findByRole('heading', { name: 'Resetează parola' })).toHaveFocus()
    expect(screen.getByText(/link de resetare, valabil o perioadă limitată/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/30 de minute/)
    await userEvent.type(screen.getByLabelText('Email de serviciu'), 'elena@stada.example')
    await userEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }))
    expect(await screen.findByRole('heading', { name: 'Verifică emailul' })).toBeInTheDocument()
    expect(screen.getByText('elena@stada.example')).toBeInTheDocument()
    expect(screen.getByText('elena@stada.example').parentElement).toHaveTextContent(/Dacă elena@stada.example are cont în Analyzator, am trimis un link de resetare/)
    expect(api.calls).toContainEqual(['reset', 'elena@stada.example', 'https://app.example/login'])
  })

  it('un cont inexistent arată exact la fel (nu dezvăluie conturile)', async () => {
    const { auth, api } = real()
    api.resetError = { status: 400, code: 'user_not_found', message: 'User not found' }
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Ai uitat parola?' }))
    await userEvent.type(screen.getByLabelText('Email de serviciu'), 'nu-exista@x.example')
    await userEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }))
    expect(await screen.findByRole('heading', { name: 'Verifică emailul' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('limitarea de cereri rămâne pe formular, cu mesaj', async () => {
    const { auth, api } = real()
    api.resetError = { status: 429, code: 'over_email_send_rate_limit', message: 'x' }
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Ai uitat parola?' }))
    await userEvent.type(screen.getByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.rate_limited)
    expect(screen.queryByRole('heading', { name: 'Verifică emailul' })).toBeNull()
  })

  it('„Retrimite linkul" repetă cererea, iar „Înapoi" revine la autentificare', async () => {
    const { auth, api } = real()
    renderLogin(auth)
    await userEvent.click(await screen.findByRole('button', { name: 'Ai uitat parola?' }))
    await userEvent.type(screen.getByLabelText('Email de serviciu'), 'a@b.example')
    await userEvent.click(screen.getByRole('button', { name: 'Trimite linkul' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Retrimite linkul' }))
    await waitFor(() => expect(api.calls.filter((c) => c[0] === 'reset')).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: 'Înapoi la autentificare' }))
    expect(await screen.findByRole('heading', { name: 'Bine ai revenit' })).toBeInTheDocument()
  })
})

describe('invitație și resetare (alegerea parolei)', () => {
  const session: BackendSession = { userId: 'u9', email: 'nou@stada.example', fullName: null }
  const invited = () => real({ session, memberships: [{ role: 'client_viewer', organization: 'STADA' }] }, { initialLink: 'invite' })

  it('activarea: email doar-citire, nume, parolă nouă, fără câmpuri de signup', async () => {
    const { auth } = invited()
    renderLogin(auth)
    expect(await screen.findByRole('heading', { name: 'Activează-ți contul' })).toHaveFocus()
    expect(screen.getByLabelText('Email')).toHaveValue('nou@stada.example')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Nume complet')).toBeRequired()
    expect(screen.getByLabelText('Parolă nouă')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.queryByRole('button', { name: 'Ai uitat parola?' })).toBeNull()
  })

  it('numele e obligatoriu: butonul rămâne dezactivat până îl completezi', async () => {
    const { auth } = invited()
    renderLogin(auth)
    expect(await screen.findByRole('button', { name: 'Activează contul' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nume complet'), 'Nou Venit')
    expect(screen.getByRole('button', { name: 'Activează contul' })).toBeEnabled()
  })

  it('indicatorul de parolă, orientativ, și cerința minimă respinsă fără apel la server', async () => {
    const { auth, api } = invited()
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Nume complet'), 'Nou Venit')
    await userEvent.type(screen.getByLabelText('Parolă nouă'), 'scurta')
    expect(screen.getByText(/Parolă: Slabă/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Activează contul' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.weak_password)
    expect(api.calls.some((c) => c[0] === 'update')).toBe(false)
  })

  it('o parolă bună activează contul și duce în aplicație', async () => {
    const { auth, api } = invited()
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Nume complet'), 'Nou Venit')
    await userEvent.type(screen.getByLabelText('Parolă nouă'), 'Parola-Buna-2026')
    expect(screen.getByText(/Parolă: Bună/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Activează contul' }))
    expect(await screen.findByText('în aplicație')).toBeInTheDocument()
    expect(api.calls).toContainEqual(['update', { fullName: 'Nou Venit', password: 'Parola-Buna-2026' }])
  })

  it('resetarea: titlu propriu, fără câmp de nume, iar numele existent nu se trimite', async () => {
    const { auth, api } = real({ session: { ...session, fullName: 'Nou Venit' }, memberships: [{ role: 'client_viewer', organization: 'STADA' }] }, { initialLink: 'recovery' })
    renderLogin(auth)
    expect(await screen.findByRole('heading', { name: 'Alege o parolă nouă' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nume complet')).toBeNull()
    await userEvent.type(screen.getByLabelText('Parolă nouă'), 'Alta-Parola-2026')
    await userEvent.click(screen.getByRole('button', { name: 'Salvează parola' }))
    expect(await screen.findByText('în aplicație')).toBeInTheDocument()
    expect(api.calls).toContainEqual(['update', { password: 'Alta-Parola-2026' }])
  })

  it('un link folosit între timp (401): mesaj de link expirat', async () => {
    const { auth, api } = invited()
    api.updateError = { status: 401, message: 'x' }
    renderLogin(auth)
    await userEvent.type(await screen.findByLabelText('Nume complet'), 'Nou Venit')
    await userEvent.type(screen.getByLabelText('Parolă nouă'), 'Parola-Buna-2026')
    await userEvent.click(screen.getByRole('button', { name: 'Activează contul' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.expired_link)
  })
})

describe('previzualizare', () => {
  it('oferă intrări fictive și vederea activării invitației; formularul acceptă adresele fictive', async () => {
    const auth = createPreviewAuth('signed_out')
    renderLogin(auth)
    expect(await screen.findByRole('button', { name: 'Intră ca agenție' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Vezi activarea invitației' }))
    expect(await screen.findByRole('heading', { name: 'Activează-ți contul' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Nume complet'), 'Elena Dobre')
    await userEvent.type(screen.getByLabelText('Parolă nouă'), 'Parola-Buna-2026')
    await userEvent.click(screen.getByRole('button', { name: 'Activează contul' }))
    expect(await screen.findByText('în aplicație')).toBeInTheDocument()
  })

  it('formularul respinge o adresă necunoscută, ca la serverul real', async () => {
    renderLogin(createPreviewAuth('signed_out'))
    await userEvent.type(await screen.findByLabelText('Email de serviciu'), 'oricine@x.example')
    await userEvent.type(screen.getByLabelText('Parolă'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Intră în cont' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(AUTH_MESSAGES.invalid_credentials)
  })

  it('nu apar intrările fictive în afara previzualizării', async () => {
    renderLogin(createUnconfiguredAuth())
    await screen.findByRole('heading', { name: 'Bine ai revenit' })
    expect(screen.queryByRole('button', { name: 'Vezi activarea invitației' })).toBeNull()
    await flush()
  })
})

describe('passwordStrength', () => {
  it.each([
    ['', 'empty'],
    ['scurta', 'weak'],
    ['doarlitereminuscule', 'weak'],
    ['LitereMixte', 'fair'],
    ['Litere-Mixte', 'good'],
    ['Parola-Buna-2026', 'good'],
  ])('%j → %s', (pw, expected) => {
    expect(passwordStrength(pw)).toBe(expected)
  })
})
