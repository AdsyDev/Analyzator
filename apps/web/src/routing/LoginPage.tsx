import { MoonIcon, SunIcon } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AUTH_MESSAGES, STRENGTH_LABELS, passwordStrength } from '../auth/messages'
import { MIN_PASSWORD_LENGTH, type AuthErrorCode, type AuthResult } from '../auth/types'
import { Button } from '../components/ui/Button'
import { cn } from '../lib/cn'
import { useTheme } from '../theme/ThemeProvider'

interface FromState {
  from?: { pathname?: string; search?: string }
}

/** Întoarcerea se face doar la adrese interne, din starea routerului (niciodată dintr-un parametru de URL). */
export function safeFrom(state: unknown): string {
  const from = (state as FromState | null)?.from
  const path = from?.pathname
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path === '/login') return '/'
  return `${path}${typeof from?.search === 'string' ? from.search : ''}`
}

type View = 'signin' | 'reset' | 'sent'

function Field({ label, error, children, htmlFor }: { label: string; htmlFor: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-text">
        {label}
      </label>
      {children}
      {error && <p className="text-[12.5px] text-neg-text">{error}</p>}
    </div>
  )
}

const INPUT =
  'h-10 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[14px] text-text placeholder:text-text-3 read-only:bg-surface-2 read-only:text-text-2 aria-[invalid=true]:border-neg'

function FormError({ id, code }: { id: string; code: AuthErrorCode | null }) {
  return code ? (
    <p id={id} role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[13px] text-neg-text">
      {AUTH_MESSAGES[code]}
    </p>
  ) : null
}

/** Ecranul de autentificare pe invitație. Fără signup: accesul se face doar cu invitație. */
export function LoginPage() {
  const { state, preview, ...auth } = useAuthActions()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const [view, setView] = useState<View>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<AuthErrorCode | null>(() => auth.consumeNotice())
  const [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const uid = useId()
  const errId = `${uid}-err`

  // La schimbarea ecranului, focusul trece pe titlu: cititoarele de ecran anunță noul context.
  useEffect(() => {
    heading.current?.focus()
  }, [view, state.status])

  if (state.status === 'signed_in') return <Navigate to={safeFrom(location.state)} replace />

  async function run(action: () => Promise<AuthResult>, onOk?: () => void) {
    setBusy(true)
    setError(null)
    const r = await action()
    setBusy(false)
    if (!r.ok) setError(r.code)
    else onOk?.()
  }

  const onSignIn = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return setError('invalid_credentials')
    void run(() => auth.signIn({ email, password, remember }))
  }
  const onReset = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    void run(() => auth.requestPasswordReset(email), () => setView('sent'))
  }
  const onSetup = (e: FormEvent) => {
    e.preventDefault()
    void run(() => auth.completePasswordSetup(state.status === 'password_setup' && state.kind === 'invite' ? { fullName: fullName.trim(), password } : { password }))
  }

  const strength = passwordStrength(password)
  const goto = (v: View) => {
    setView(v)
    setError(null)
    setPassword('')
  }

  let card: ReactNode
  if (state.status === 'password_setup') {
    const invite = state.kind === 'invite'
    card = (
      <form onSubmit={onSetup} className="flex flex-col gap-4" noValidate aria-describedby={error ? errId : undefined}>
        <h1 ref={heading} tabIndex={-1} className="font-display text-[22px] font-semibold tracking-[-0.01em] outline-none">
          {invite ? 'Activează-ți contul' : 'Alege o parolă nouă'}
        </h1>
        <p className="text-[13.5px] leading-normal text-text-2">{invite ? 'Alege-ți parola ca să intri în Analyzator. Accesul tău a fost acordat prin invitație.' : 'Alege o parolă nouă pentru contul tău.'}</p>
        <Field label="Email" htmlFor={`${uid}-em`}>
          <input id={`${uid}-em`} type="email" value={state.email} readOnly className={INPUT} />
        </Field>
        {invite && (
          <Field label="Nume complet" htmlFor={`${uid}-nm`}>
            <input id={`${uid}-nm`} type="text" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={INPUT} />
          </Field>
        )}
        <Field label="Parolă nouă" htmlFor={`${uid}-pw`}>
          <input id={`${uid}-pw`} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={`${uid}-hint`} className={INPUT} />
          <div id={`${uid}-hint`} className="flex items-center gap-2 text-[12px] text-text-2">
            <span aria-hidden="true" className="flex h-1.5 w-24 overflow-hidden rounded-full bg-neutral-soft">
              <span className={cn('h-full transition-[width]', strength === 'good' ? 'w-full bg-pos' : strength === 'fair' ? 'w-2/3 bg-warn' : strength === 'weak' ? 'w-1/3 bg-neg' : 'w-0')} />
            </span>
            <span>{strength === 'empty' ? `Cel puțin ${MIN_PASSWORD_LENGTH} caractere.` : `Parolă: ${STRENGTH_LABELS[strength]}. Cel puțin ${MIN_PASSWORD_LENGTH} caractere.`}</span>
          </div>
        </Field>
        <FormError id={errId} code={error} />
        <Button type="submit" variant="primary" loading={busy} disabled={invite && !fullName.trim()}>
          {invite ? 'Activează contul' : 'Salvează parola'}
        </Button>
      </form>
    )
  } else if (view === 'reset') {
    card = (
      <form onSubmit={onReset} className="flex flex-col gap-4" noValidate aria-describedby={error ? errId : undefined}>
        <h1 ref={heading} tabIndex={-1} className="font-display text-[22px] font-semibold tracking-[-0.01em] outline-none">Resetează parola</h1>
        <p className="text-[13.5px] leading-normal text-text-2">Îți trimitem pe email un link de resetare, valabil o perioadă limitată.</p>
        <Field label="Email de serviciu" htmlFor={`${uid}-em`}>
          <input id={`${uid}-em`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
        </Field>
        <FormError id={errId} code={error} />
        <Button type="submit" variant="primary" loading={busy}>Trimite linkul</Button>
        <button type="button" onClick={() => goto('signin')} className="text-[13px] font-medium text-accent-text hover:underline">Înapoi la autentificare</button>
      </form>
    )
  } else if (view === 'sent') {
    card = (
      <div className="flex flex-col gap-4">
        <h1 ref={heading} tabIndex={-1} className="font-display text-[22px] font-semibold tracking-[-0.01em] outline-none">Verifică emailul</h1>
        <p className="text-[13.5px] leading-normal text-text-2">
          Dacă <strong className="font-semibold text-text">{email.trim()}</strong> are cont în Analyzator, am trimis un link de resetare. Linkul expiră după o perioadă limitată.
        </p>
        <FormError id={errId} code={error} />
        <button type="button" onClick={() => goto('signin')} className="text-left text-[13px] font-medium text-accent-text hover:underline">Înapoi la autentificare</button>
        <p className="text-[13px] text-text-2">
          Nu a ajuns?{' '}
          <button type="button" disabled={busy} onClick={() => void run(() => auth.requestPasswordReset(email))} className="font-medium text-accent-text hover:underline disabled:opacity-50">Retrimite linkul</button>
        </p>
      </div>
    )
  } else {
    card = (
      <form onSubmit={onSignIn} className="flex flex-col gap-4" noValidate aria-describedby={error ? errId : undefined}>
        <div>
          <h1 ref={heading} tabIndex={-1} className="font-display text-[22px] font-semibold tracking-[-0.01em] outline-none">Bine ai revenit</h1>
          <p className="mt-1 text-[13.5px] leading-normal text-text-2">Intră în spațiul tău de brand intelligence.</p>
        </div>
        <Field label="Email de serviciu" htmlFor={`${uid}-em`}>
          <input id={`${uid}-em`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error === 'invalid_credentials' || undefined} className={INPUT} />
        </Field>
        <Field label="Parolă" htmlFor={`${uid}-pw`}>
          <input id={`${uid}-pw`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error === 'invalid_credentials' || undefined} className={INPUT} />
        </Field>
        <div className="flex items-center justify-between gap-3 text-[13px]">
          <label className="flex items-center gap-2 text-text-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Ține-mă minte pe acest dispozitiv
          </label>
          <button type="button" onClick={() => goto('reset')} className="font-medium text-accent-text hover:underline">Ai uitat parola?</button>
        </div>
        <FormError id={errId} code={error} />
        <Button type="submit" variant="primary" loading={busy}>Intră în cont</Button>
        {preview ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-[12.5px] text-text-2">Previzualizare: adresele fictive din meniul contului intră cu orice parolă, sau alege o vedere.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => preview.signIn('agency_admin')}>Intră ca agenție</Button>
              <Button onClick={() => preview.signIn('client_viewer')}>Intră ca client</Button>
              <Button variant="ghost" onClick={preview.startInvite}>Vezi activarea invitației</Button>
            </div>
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-[13px] text-text-2">Ai primit o invitație? Folosește linkul din emailul de invitație.</p>
        )}
      </form>
    )
  }

  const support = import.meta.env.VITE_SUPPORT_EMAIL

  return (
    <div className="relative z-10 flex min-h-screen flex-col px-7 py-5 pt-[calc(1.25rem+var(--banner-h,0px))]">
      <header className="flex h-11 items-center gap-2.5">
        <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-[9px] bg-accent-btn font-display text-[15px] font-bold text-on-accent">A</span>
        <span className="font-display text-[16px] font-semibold">Analyzator</span>
        <span className="text-[13px] text-text-2">de AdSymphony</span>
        <span className="flex-1" />
        <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Comută la tema deschisă' : 'Comută la tema închisă'} className="grid size-9 place-items-center rounded-[11px] text-text hover:bg-neutral-soft">
          {theme === 'dark' ? <SunIcon size={18} aria-hidden="true" /> : <MoonIcon size={18} aria-hidden="true" />}
        </button>
      </header>
      <main className="grid flex-1 place-items-center py-8">
        <div className="w-[min(420px,100%)] rounded-2xl border border-border bg-surface p-8 shadow-2">{card}</div>
      </main>
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-text-2">
        <span>Accesul se face doar pe bază de invitație.{support ? <> Ai nevoie de ajutor? <a href={`mailto:${support}`} className="text-accent-text hover:underline">{support}</a></> : null}</span>
        <span className="flex-1" />
        <span>© {new Date().getFullYear()} AdSymphony</span>
      </footer>
    </div>
  )
}

/** `useAuth` + acțiunile sursei, într-un singur loc (restul ecranului nu ține referința la sursă). */
function useAuthActions() {
  const a = useAuth()
  return { state: a.state, preview: a.preview, signIn: a.source.signIn, requestPasswordReset: a.source.requestPasswordReset, completePasswordSetup: a.source.completePasswordSetup, consumeNotice: a.source.consumeNotice }
}
