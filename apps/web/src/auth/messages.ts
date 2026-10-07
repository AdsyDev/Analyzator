import { MIN_PASSWORD_LENGTH, type AuthErrorCode } from './types'

/** Mesajele de eroare ale autentificării. Generice: nu confirmă existența unui cont și nu repetă textul serverului. */
export const AUTH_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'Email sau parolă incorecte.',
  rate_limited: 'Prea multe încercări. Încearcă din nou peste câteva minute.',
  weak_password: `Parola trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`,
  no_access: 'Contul tău nu are acces la niciun spațiu de brand. Contactează echipa AdSymphony.',
  expired_link: 'Linkul a expirat sau a fost deja folosit. Cere un link nou echipei AdSymphony.',
  network: 'Nu ne-am putut conecta. Verifică conexiunea și încearcă din nou.',
  unavailable: 'Autentificarea nu este configurată pentru acest mediu.',
  unknown: 'Ceva nu a mers. Încearcă din nou.',
}

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'good'

/** Indicator orientativ pentru alegerea parolei (lungime și varietate); nu înlocuiește cerința minimă. */
export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return 'empty'
  if (pw.length < MIN_PASSWORD_LENGTH) return 'weak'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length
  return pw.length >= 12 && classes >= 3 ? 'good' : classes >= 2 ? 'fair' : 'weak'
}

export const STRENGTH_LABELS: Record<PasswordStrength, string> = { empty: '', weak: 'Slabă', fair: 'Medie', good: 'Bună' }
