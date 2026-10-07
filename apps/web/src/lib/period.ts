import type { ComparisonMode, DateRange, IsoDate, ModuleFilters, PeriodPreset, PeriodSelection, QueryContext, ServerPeriodKind } from '../contracts'
import { PERIOD_PRESETS } from '../contracts'

const TZ = 'Europe/Bucharest'
const ISO = /^\d{4}-\d{2}-\d{2}$/

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Ziua calendaristică curentă în Europe/Bucharest, indiferent de fusul dispozitivului. */
export function todayBucharest(now: Date = new Date()): IsoDate {
  return dayFmt.format(now)
}

function toUtc(iso: IsoDate): Date {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d))
}
function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = toUtc(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return fromUtc(d)
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000)
}

/** Data validă în calendar (nu 2026-02-30) și în formatul ISO. */
export function isValidIsoDate(value: string | null | undefined): value is IsoDate {
  if (!value || !ISO.test(value)) return false
  return fromUtc(toUtc(value)) === value
}

/** Ultima zi completă: ieri. Ziua curentă nu e încheiată și nu intră în perioade. */
export function lastCompleteDay(now: Date = new Date()): IsoDate {
  return addDays(todayBucharest(now), -1)
}

export function resolvePeriod(preset: PeriodPreset, now: Date = new Date(), custom?: { from: string | null; to: string | null }): PeriodSelection {
  const end = lastCompleteDay(now)
  if (preset === 'custom' && custom && isValidIsoDate(custom.from) && isValidIsoDate(custom.to) && custom.from <= custom.to && custom.to <= end) {
    return { preset: 'custom', from: custom.from, to: custom.to }
  }
  if (preset === '7d') return { preset, from: addDays(end, -6), to: end }
  if (preset === 'month') return { preset, from: `${end.slice(0, 8)}01`, to: end }
  // '28d', precum și un `custom` invalid, revin la implicit.
  return { preset: '28d', from: addDays(end, -27), to: end }
}

function shiftYear(iso: IsoDate, years: number): IsoDate {
  const d = toUtc(iso)
  const month = d.getUTCMonth()
  d.setUTCFullYear(d.getUTCFullYear() + years)
  // 29 feb -> 28 feb în anii nebisecți (altfel ar sări în martie).
  if (d.getUTCMonth() !== month) d.setUTCDate(0)
  return fromUtc(d)
}

/** `kind` trimis la `metrics.compute`: „Luna curentă" e MTD, restul intervalelor sunt `custom`. */
export function serverPeriodKind(preset: PeriodPreset): ServerPeriodKind {
  return preset === 'month' ? 'mtd' : 'custom'
}

function monthStart(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 8)}01`
}
function minIso(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b
}

/**
 * Perioada de comparație, ca la server (`metrics.comparison_period`), ca intervalul afișat să fie
 * cel calculat. `previous`: pentru MTD, aceeași porțiune din luna anterioară (limitată la sfârșitul
 * ei); altfel, perioada anterioară de aceeași lungime. `year_ago`: același interval cu un an înainte.
 */
export function comparisonRange(period: PeriodSelection, mode: ComparisonMode): DateRange {
  if (mode === 'year_ago') return { from: shiftYear(period.from, -1), to: shiftYear(period.to, -1) }
  if (serverPeriodKind(period.preset) === 'mtd') {
    const start = monthStart(period.from)
    const prevStart = monthStart(addDays(start, -1))
    const prevEnd = addDays(start, -1)
    return {
      from: minIso(addDays(prevStart, daysBetween(start, period.from)), prevEnd),
      to: minIso(addDays(prevStart, daysBetween(start, period.to)), prevEnd),
    }
  }
  const len = daysBetween(period.from, period.to) + 1
  return { from: addDays(period.from, -len), to: addDays(period.from, -1) }
}

// URL: `period`, `from`, `to`, `compare` + filtrele modulului. Valorile implicite nu se scriu în URL.
export const DEFAULT_PRESET: PeriodPreset = '28d'
export const DEFAULT_COMPARISON: ComparisonMode = 'previous'

export interface FilterDef {
  key: string
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  defaultValue: string
}

/** Citește contextul din URL. Orice valoare invalidă sau în afara allowlist-ului cade pe implicit. */
export function parseQueryContext(params: URLSearchParams, brandId: string, filterDefs: readonly FilterDef[] = [], now: Date = new Date()): QueryContext {
  const rawPreset = params.get('period')
  const preset = (PERIOD_PRESETS as readonly string[]).includes(rawPreset ?? '') ? (rawPreset as PeriodPreset) : DEFAULT_PRESET
  const period = resolvePeriod(preset, now, { from: params.get('from'), to: params.get('to') })
  const comparison: ComparisonMode = params.get('compare') === 'year_ago' ? 'year_ago' : DEFAULT_COMPARISON

  const filters: Record<string, string> = {}
  for (const def of filterDefs) {
    const v = params.get(def.key)
    filters[def.key] = v !== null && def.options.some((o) => o.value === v) ? v : def.defaultValue
  }
  return { brandId, period, comparison, filters }
}

/** Scrie contextul în URL, păstrând parametrii străini și omițând valorile implicite. */
export function writeQueryContext(current: URLSearchParams, ctx: Pick<QueryContext, 'period' | 'comparison'> & { filters: ModuleFilters }, filterDefs: readonly FilterDef[] = []): URLSearchParams {
  const next = new URLSearchParams(current)
  for (const k of ['period', 'from', 'to', 'compare', ...filterDefs.map((d) => d.key)]) next.delete(k)
  if (ctx.period.preset !== DEFAULT_PRESET) next.set('period', ctx.period.preset)
  if (ctx.period.preset === 'custom') {
    next.set('from', ctx.period.from)
    next.set('to', ctx.period.to)
  }
  if (ctx.comparison !== DEFAULT_COMPARISON) next.set('compare', ctx.comparison)
  for (const def of filterDefs) {
    const v = ctx.filters[def.key]
    if (v !== undefined && v !== def.defaultValue) next.set(def.key, v)
  }
  return next
}

/** Parametrii care se păstrează la schimbarea modulului (perioadă și comparație, nu filtrele modulului). */
export function sharedSearch(params: URLSearchParams): string {
  const keep = new URLSearchParams()
  for (const k of ['period', 'from', 'to', 'compare']) {
    const v = params.get(k)
    if (v !== null) keep.set(k, v)
  }
  const s = keep.toString()
  return s ? `?${s}` : ''
}
