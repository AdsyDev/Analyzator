import type { IsoDate, IsoDateTime, MetricUnit } from '../contracts'

const TZ = 'Europe/Bucharest'
const LOCALE = 'ro-RO'

const nf = (min: number, max: number) =>
  new Intl.NumberFormat(LOCALE, { minimumFractionDigits: min, maximumFractionDigits: max })
const INT = nf(0, 0)
const ONE = nf(0, 1)

/** Spațiu fin înainte de unitate, ca „12,4 %" să nu se rupă pe rânduri. */
const NBSP = ' '

export function formatInteger(v: number): string {
  return INT.format(v)
}

export function formatCompact(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${ONE.format(v / 1_000_000)}M`
  if (abs >= 10_000) return `${ONE.format(v / 1_000)}k`
  return INT.format(v)
}

/** Formatează o valoare deja calculată. Nu aplică nicio formulă; `null` nu devine niciodată „0". */
export function formatMetricValue(value: number | null, unit: MetricUnit): string | null {
  if (value === null) return null
  switch (unit) {
    case 'percent':
      return `${ONE.format(value)}${NBSP}%`
    case 'seconds':
      return `${ONE.format(value)}${NBSP}s`
    case 'position':
    case 'score':
      return ONE.format(value)
    case 'count':
      return INT.format(value)
  }
}

/** Zecimalele afișate pentru o variație absolută: numărătorile se afișează întregi, restul cu o zecimală. */
const changeDigits = (unit: MetricUnit): 0 | 1 => (unit === 'count' ? 0 : 1)

/**
 * Direcția unei variații, după valoarea AȘA CUM SE AFIȘEAZĂ: o variație care rotunjită e zero nu are semn și
 * nu primește săgeată în sus sau în jos („−0 p.p." cu săgeată ar contrazice textul).
 */
export function changeDirection(change: number, digits: 0 | 1 = 1): 'up' | 'down' | 'flat' {
  const f = 10 ** digits
  return Math.round(Math.abs(change) * f) === 0 ? 'flat' : change > 0 ? 'up' : 'down'
}

/** Variație absolută: pentru procente se exprimă în puncte procentuale, nu în procente (spec 2.3). */
export function formatAbsoluteChange(change: number, unit: MetricUnit): string {
  const d = changeDirection(change, changeDigits(unit))
  const sign = d === 'up' ? '+' : d === 'down' ? '−' : ''
  const abs = Math.abs(change)
  const body = unit === 'percent' ? `${ONE.format(abs)}${NBSP}p.p.` : (formatMetricValue(abs, unit) ?? '')
  return `${sign}${body}`
}

/** `percent` vine din server în procente (12,7 = +12,7%). */
export function formatRelativeChange(percent: number): string {
  const d = changeDirection(percent)
  const sign = d === 'up' ? '+' : d === 'down' ? '−' : ''
  return `${sign}${ONE.format(Math.abs(percent))}${NBSP}%`
}

const DAY_MONTH = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ })
const FULL = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ })
const FULL_TIME = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
})

/** Ziua calendaristică ISO fără deplasare de fus: se ancorează la amiază UTC. */
function isoDateToDate(iso: IsoDate): Date {
  return new Date(`${iso}T12:00:00Z`)
}

export function formatDate(iso: IsoDate): string {
  return FULL.format(isoDateToDate(iso))
}

export function formatDayMonth(iso: IsoDate): string {
  return DAY_MONTH.format(isoDateToDate(iso))
}

export function formatDateTime(iso: IsoDateTime): string {
  return FULL_TIME.format(new Date(iso))
}

export function formatRange(from: IsoDate, to: IsoDate): string {
  return `${formatDayMonth(from)} - ${formatDate(to)}`
}

/** „acum 2 ore". Relativ la `now`; pentru intervale mai mari de 30 de zile se afișează data. */
export function formatRelative(iso: IsoDateTime, now: Date = new Date()): string {
  const diffMs = now.getTime() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'chiar acum'
  const min = Math.floor(diffMs / 60_000)
  if (min < 60) return min === 1 ? 'acum un minut' : `acum ${min} minute`
  const h = Math.floor(min / 60)
  if (h < 24) return h === 1 ? 'acum o oră' : `acum ${h} ore`
  const d = Math.floor(h / 24)
  if (d <= 30) return d === 1 ? 'acum o zi' : `acum ${d} zile`
  return formatDateTime(iso)
}

const CURRENCY = new Map<string, Intl.NumberFormat>()

/**
 * Bani cu moneda lângă valoare (spec cap. 22). Moneda vine din sursă; nu se convertește și nu se presupune.
 * `null` nu devine niciodată „0".
 */
export function formatCurrency(value: number | null, currency: string, decimals: 0 | 2 = 0): string | null {
  if (value === null) return null
  const key = `${currency}:${decimals}`
  let f = CURRENCY.get(key)
  if (!f) CURRENCY.set(key, (f = new Intl.NumberFormat(LOCALE, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: decimals, maximumFractionDigits: decimals })))
  // Intl pune un spațiu fix între sumă și cod; îl păstrăm, ca „1.234 RON" să nu se rupă pe rânduri.
  return f.format(value).replace(/\s/g, NBSP)
}
