// Intervalele pentru utilizatorii activi GA4 (nesumabili: câte un raport pe fiecare interval cerut).
// Presetările din specificație (cap. 9): ultima săptămână completă, ultimele 4 și 13 săptămâni, luna calendaristică
// precedentă; plus perioada anterioară de aceeași lungime pentru comparație. Intervalele personalizate nu au
// raport precalculat și rămân „indisponibil" (metrics.compute, interval_report_only).

export type DateInterval = { start: string; end: string; kind: 'week' | '4_weeks' | '13_weeks' | 'month'; comparison_of: string | null }

const DAY = 86_400_000
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (isoDate: string, n: number) => iso(new Date(toDate(isoDate).getTime() + n * DAY))
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY)

/** `today` = ziua curentă (YYYY-MM-DD) în fusul proprietății. Sfârșitul = cea mai recentă duminică < today. */
export function lastCompleteSunday(today: string): string {
  const dow = toDate(today).getUTCDay() // 0 = duminică
  return addDays(today, dow === 0 ? -7 : -dow)
}

export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const length = daysBetween(start, end) + 1
  return { start: addDays(start, -length), end: addDays(start, -1) }
}

export function activeUsersIntervals(today: string): DateInterval[] {
  const sunday = lastCompleteSunday(today)
  const base: Array<Omit<DateInterval, 'comparison_of'>> = [
    { kind: 'week', start: addDays(sunday, -6), end: sunday },
    { kind: '4_weeks', start: addDays(sunday, -27), end: sunday },
    { kind: '13_weeks', start: addDays(sunday, -90), end: sunday },
  ]
  // Luna calendaristică precedentă (completă).
  const [y, m] = today.split('-').map(Number) as [number, number]
  const firstOfThis = new Date(Date.UTC(y, m - 1, 1))
  const lastOfPrev = new Date(firstOfThis.getTime() - DAY)
  const firstOfPrev = new Date(Date.UTC(lastOfPrev.getUTCFullYear(), lastOfPrev.getUTCMonth(), 1))
  base.push({ kind: 'month', start: iso(firstOfPrev), end: iso(lastOfPrev) })

  const out: DateInterval[] = []
  const seen = new Set<string>()
  const push = (i: DateInterval) => {
    const key = `${i.start}|${i.end}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(i)
    }
  }
  for (const b of base) {
    push({ ...b, comparison_of: null })
    const prev = previousPeriod(b.start, b.end)
    push({ kind: b.kind, ...prev, comparison_of: `${b.start}|${b.end}` })
  }
  return out
}
