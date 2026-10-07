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

/** Variație absolută: pentru procente se exprimă în puncte procentuale, nu în procente (spec 2.3). */
export function formatAbsoluteChange(change: number, unit: MetricUnit): string {
  const sign = change > 0 ? '+' : change < 0 ? '−' : ''
  const abs = Math.abs(change)
  const body = unit === 'percent' ? `${ONE.format(abs)}${NBSP}p.p.` : (formatMetricValue(abs, unit) ?? '')
  return `${sign}${body}`
}

/** `percent` vine din server în procente (12,7 = +12,7%). */
export function formatRelativeChange(percent: number): string {
  const sign = percent > 0 ? '+' : percent < 0 ? '−' : ''
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
