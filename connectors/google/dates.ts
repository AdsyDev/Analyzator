// Date calendaristice în fusul unei proprietăți (GA4: fusul proprietății; GSC: PT).
const cache = new Map<string, Intl.DateTimeFormat>()

export function calendarDateIn(instant: Date, timeZone: string): string {
  let f = cache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    cache.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Fereastra de reimport: ultimele `days` zile, până ieri în fusul dat. */
export function lookbackWindow(now: Date, timeZone: string, days: number): { start: string; end: string } {
  const end = addDaysIso(calendarDateIn(now, timeZone), -1)
  return { start: addDaysIso(end, -(days - 1)), end }
}
