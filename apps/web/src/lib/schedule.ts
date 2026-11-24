import type { SourceProviderId } from '../contracts'

/**
 * Programarea colectării, în UTC: oglinda cron-urilor din `.github/workflows` (un test compară cele două).
 * Folosită doar pentru „Următoarea actualizare estimată": nu spune că rularea a avut loc și nu ține loc de
 * „Date până la". O sursă fără programare (import CSV) nu are estimare.
 */
export type Schedule = { kind: 'weekly'; weekday: number; hour: number; minute: number } | { kind: 'daily'; hour: number; minute: number }

/** Colectarea zilnică a conectorilor API (decizia AF): 03:17 UTC, pe un minut care nu e la început de oră. */
const DAILY: Schedule = { kind: 'daily', hour: 3, minute: 17 }

export const COLLECTION_SCHEDULE: Partial<Record<SourceProviderId, Schedule>> = {
  seomonitor: DAILY,
  ga4: DAILY,
  gsc: DAILY,
  planable: DAILY,
  google_ads: DAILY,
  meta_ads: DAILY,
  tiktok_ads: DAILY,
  clarity: { kind: 'daily', hour: 22, minute: 5 },
  airbyte: { kind: 'daily', hour: 5, minute: 20 },
}

/** Următoarea rulare programată după `now`; `null` pentru o sursă fără programare. */
export function nextScheduledRun(provider: SourceProviderId, now: Date = new Date()): Date | null {
  const s = COLLECTION_SCHEDULE[provider]
  if (!s) return null
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hour, s.minute))
  if (s.kind === 'weekly') next.setUTCDate(next.getUTCDate() + ((s.weekday - next.getUTCDay() + 7) % 7))
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + (s.kind === 'weekly' ? 7 : 1))
  return next
}

/** Cea mai apropiată rulare programată dintre mai multe surse. */
export function nextScheduledRunFor(providers: readonly SourceProviderId[], now: Date = new Date()): Date | null {
  const times = providers.map((p) => nextScheduledRun(p, now)).filter((d): d is Date => d !== null)
  return times.length === 0 ? null : new Date(Math.min(...times.map((d) => d.getTime())))
}
