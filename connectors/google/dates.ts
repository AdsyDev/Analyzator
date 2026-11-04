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

/**
 * Fereastra de reimport: ultimele `days` zile, până ieri în fusul dat. Cu `lagDays`, fereastra se termină cu atâtea
 * zile mai devreme (surse ale căror date finale apar cu întârziere, ca Search Console).
 */
export function lookbackWindow(now: Date, timeZone: string, days: number, lagDays = 0): { start: string; end: string } {
  const end = addDaysIso(calendarDateIn(now, timeZone), -1 - lagDays)
  return { start: addDaysIso(end, -(days - 1)), end }
}

/** O dată calendaristică ISO validă (`YYYY-MM-DD`, zi existentă). */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && addDaysIso(value, 0) === value
}

/** Numărul de zile din intervalul [start, end], cu ambele capete. */
export function daysInclusive(start: string, end: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(end) - utc(start)) / 86_400_000) + 1
}

/** Aceeași zi, cu `months` luni mai devreme (negativ) sau mai târziu; ziua se oprește la ultima zi a lunii (31 oct − 1 lună = 30 sept). */
export function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number]
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay))).toISOString().slice(0, 10)
}

/**
 * Reimportul unui istoric: ferestre de câte `days` zile, de la `from` până la fereastra obișnuită, în ordine de la cea mai
 * veche. Ultima e chiar fereastra obișnuită, așa că ultima rulare (după care se citește starea sursei) rămâne cea de zi cu zi.
 * Cu `from` în fereastra obișnuită sau după începutul ei, rămâne doar fereastra obișnuită.
 */
export function backfillWindows(from: string, current: { start: string; end: string }, days: number): Array<{ start: string; end: string }> {
  if (!Number.isInteger(days) || days < 1) throw new Error(`fereastră invalidă: ${days} zile`)
  const windows = [current]
  let end = addDaysIso(current.start, -1)
  while (end >= from) {
    const earliest = addDaysIso(end, -(days - 1))
    const start = earliest < from ? from : earliest
    windows.unshift({ start, end })
    end = addDaysIso(start, -1)
  }
  return windows
}

/**
 * Intervalul închis [from, until] în ferestre de câte `days` zile, de la cea mai veche; ultima se termină exact în
 * `until`, prima poate fi mai scurtă. Fără nicio fereastră când `until` e înainte de `from`.
 */
export function rangeWindows(from: string, until: string, days: number): Array<{ start: string; end: string }> {
  if (!Number.isInteger(days) || days < 1) throw new Error(`fereastră invalidă: ${days} zile`)
  if (until < from) return []
  const earliest = addDaysIso(until, -(days - 1))
  return backfillWindows(from, { start: earliest < from ? from : earliest, end: until }, days)
}
