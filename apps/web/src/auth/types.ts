import type { Role, SessionUser } from '../contracts'

/** `temporary` = cont creat de administrator cu parolă temporară, schimbată obligatoriu la prima intrare (E-5). */
export type PasswordSetupKind = 'invite' | 'recovery' | 'temporary'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** Invitație acceptată, resetare cerută sau parolă temporară: există o sesiune, dar utilizatorul trebuie să-și aleagă parola. */
  | { status: 'password_setup'; kind: PasswordSetupKind; email: string }
  | { status: 'signed_in'; user: SessionUser }

/**
 * Codurile de eroare sunt generice intenționat: nu dezvăluie dacă un cont există și nu repetă mesaje
 * ale serverului (spec cap. 28, accesul pe invitație).
 */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'weak_password'
  | 'same_password'
  | 'no_access'
  | 'expired_link'
  | 'session_expired'
  | 'network'
  | 'unavailable'
  | 'unknown'

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode }

export interface SignInInput {
  email: string
  password: string
  /** „Ține-mă minte pe acest dispozitiv": sesiune persistentă; altfel doar cât ține fila. */
  remember: boolean
}

/** Doar în previzualizare: utilizator fictiv cu rol comutabil. Absent în orice build fără flag. */
export interface PreviewAuthControls {
  role: Role
  setRole: (role: Role) => void
  signIn: (role: Role) => void
  /** Arată ecranul de activare a invitației (fără email real). */
  startInvite: () => void
}

/**
 * Sursa sesiunii. Autentificarea reală vine din Supabase (acces pe invitație, fără signup);
 * UI-ul nu decide singur accesul: RLS rămâne autoritatea, iar gardurile din rute sunt doar comoditate.
 */
export interface AuthSource {
  getSnapshot: () => AuthState
  subscribe: (listener: () => void) => () => void
  signOut: () => Promise<void>
  /** Mesajul unică folosință al ecranului de login (de ex. linkul de invitație a expirat). */
  consumeNotice: () => AuthErrorCode | null
  signIn: (input: SignInInput) => Promise<AuthResult>
  requestPasswordReset: (email: string) => Promise<AuthResult>
  /** Alegerea parolei după invitație, resetare sau parola temporară. */
  completePasswordSetup: (input: { fullName?: string; password: string }) => Promise<AuthResult>
  preview?: PreviewAuthControls
}

/** Lungimea minimă cerută în UI (serverul acceptă 6; configurarea recomandă 8 sau mai mult). */
export const MIN_PASSWORD_LENGTH = 8
