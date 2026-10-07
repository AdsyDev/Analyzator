import { describe, expect, it } from 'vitest'
import { addDays, comparisonRange, serverPeriodKind, daysBetween, isValidIsoDate, lastCompleteDay, parseQueryContext, resolvePeriod, sharedSearch, todayBucharest, writeQueryContext, type FilterDef } from './period'

// 6 oct. 2026, 10:00 în București (UTC+3 vara) -> azi = 2026-10-06, ultima zi completă = 2026-10-05.
const NOW = new Date('2026-10-06T07:00:00Z')

describe('zile în Europe/Bucharest', () => {
  it('trecerea de miezul nopții se face în ora României, nu în UTC', () => {
    // 22:30 UTC pe 5 oct. = 01:30 pe 6 oct. în București
    expect(todayBucharest(new Date('2026-10-05T22:30:00Z'))).toBe('2026-10-06')
    expect(todayBucharest(new Date('2026-10-05T20:30:00Z'))).toBe('2026-10-05')
  })
  it('iarna se folosește UTC+2', () => {
    expect(todayBucharest(new Date('2026-12-31T22:30:00Z'))).toBe('2027-01-01')
    expect(todayBucharest(new Date('2026-12-31T21:30:00Z'))).toBe('2026-12-31')
  })
  it('ultima zi completă e ieri', () => expect(lastCompleteDay(NOW)).toBe('2026-10-05'))
})

describe('aritmetică de date', () => {
  it('addDays trece peste luni și ani', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('daysBetween nu e afectat de schimbarea orei de iarnă', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })
  it('validează calendarul', () => {
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026-10-05')).toBe(true)
    expect(isValidIsoDate('05.10.2026')).toBe(false)
    expect(isValidIsoDate(null)).toBe(false)
  })
})

describe('resolvePeriod', () => {
  it('7 zile, 28 de zile, luna curentă, încheiate ieri', () => {
    expect(resolvePeriod('7d', NOW)).toEqual({ preset: '7d', from: '2026-09-29', to: '2026-10-05' })
    expect(resolvePeriod('28d', NOW)).toEqual({ preset: '28d', from: '2026-09-08', to: '2026-10-05' })
    expect(resolvePeriod('month', NOW)).toEqual({ preset: 'month', from: '2026-10-01', to: '2026-10-05' })
  })
  it('interval personalizat valid', () => {
    expect(resolvePeriod('custom', NOW, { from: '2026-07-01', to: '2026-09-30' })).toEqual({ preset: 'custom', from: '2026-07-01', to: '2026-09-30' })
  })
  it.each([
    ['inversat', '2026-09-30', '2026-07-01'],
    ['în viitor', '2026-09-01', '2026-10-20'],
    ['invalid', '2026-02-30', '2026-03-01'],
  ])('interval personalizat %s revine la implicit', (_n, from, to) => {
    expect(resolvePeriod('custom', NOW, { from, to }).preset).toBe('28d')
  })
})

describe('comparisonRange, ca la server', () => {
  it('luna curentă e MTD: aceleași zile din luna anterioară, nu perioada anterioară de aceeași lungime', () => {
    const mtd = resolvePeriod('month', NOW)
    expect(comparisonRange(mtd, 'previous')).toEqual({ from: '2026-09-01', to: '2026-09-05' })
    expect(serverPeriodKind('month')).toBe('mtd')
    expect(serverPeriodKind('28d')).toBe('custom')
    expect(serverPeriodKind('7d')).toBe('custom')
    expect(serverPeriodKind('custom')).toBe('custom')
  })
  it('MTD limitează la sfârșitul lunii anterioare (31 martie vs. 28 februarie)', () => {
    expect(comparisonRange({ preset: 'month', from: '2027-03-01', to: '2027-03-31' }, 'previous')).toEqual({ from: '2027-02-01', to: '2027-02-28' })
  })
  it('MTD în ianuarie compară cu decembrie anul anterior', () => {
    expect(comparisonRange({ preset: 'month', from: '2027-01-01', to: '2027-01-10' }, 'previous')).toEqual({ from: '2026-12-01', to: '2026-12-10' })
  })
})

describe('comparisonRange', () => {
  const p = { preset: '28d' as const, from: '2026-09-08', to: '2026-10-05' }
  it('perioada anterioară de aceeași lungime, fără suprapunere', () => {
    expect(comparisonRange(p, 'previous')).toEqual({ from: '2026-08-11', to: '2026-09-07' })
  })
  it('același interval cu un an înainte', () => {
    expect(comparisonRange(p, 'year_ago')).toEqual({ from: '2025-09-08', to: '2025-10-05' })
  })
  it('29 februarie nu sare în martie', () => {
    expect(comparisonRange({ preset: 'custom', from: '2028-02-29', to: '2028-03-02' }, 'year_ago')).toEqual({ from: '2027-02-28', to: '2027-03-02' })
  })
})

const defs: FilterDef[] = [
  { key: 'device', label: 'Device', defaultValue: 'all', options: [{ value: 'all', label: 'Toate' }, { value: 'mobile', label: 'Mobil' }] },
]

describe('URL ↔ context', () => {
  it('fără parametri: implicitele', () => {
    const c = parseQueryContext(new URLSearchParams(), 'b1', defs, NOW)
    expect(c.period.preset).toBe('28d')
    expect(c.comparison).toBe('previous')
    expect(c.filters).toEqual({ device: 'all' })
    expect(c.brandId).toBe('b1')
  })
  it('ignoră valorile invalide sau din afara allowlist-ului', () => {
    const c = parseQueryContext(new URLSearchParams('period=forever&compare=x&device=%27%3B%20drop'), 'b1', defs, NOW)
    expect(c.period.preset).toBe('28d')
    expect(c.comparison).toBe('previous')
    expect(c.filters.device).toBe('all')
  })
  it('ignoră filtrele necunoscute', () => {
    expect(parseQueryContext(new URLSearchParams('secret=1'), 'b1', defs, NOW).filters).toEqual({ device: 'all' })
  })
  it('round-trip, fără valori implicite în URL', () => {
    const ctx = parseQueryContext(new URLSearchParams('period=7d&compare=year_ago&device=mobile'), 'b1', defs, NOW)
    const out = writeQueryContext(new URLSearchParams('foo=bar'), ctx, defs)
    expect(out.get('period')).toBe('7d')
    expect(out.get('compare')).toBe('year_ago')
    expect(out.get('device')).toBe('mobile')
    expect(out.get('foo')).toBe('bar')
    const reset = writeQueryContext(out, { ...ctx, period: resolvePeriod('28d', NOW), comparison: 'previous', filters: { device: 'all' } }, defs)
    expect(reset.toString()).toBe('foo=bar')
  })
  it('intervalul personalizat se scrie cu from și to', () => {
    const ctx = parseQueryContext(new URLSearchParams('period=custom&from=2026-07-01&to=2026-09-30'), 'b1', [], NOW)
    expect(ctx.period).toEqual({ preset: 'custom', from: '2026-07-01', to: '2026-09-30' })
    expect(writeQueryContext(new URLSearchParams(), ctx).toString()).toBe('period=custom&from=2026-07-01&to=2026-09-30')
  })
  it('sharedSearch păstrează perioada și comparația, nu filtrele modulului', () => {
    expect(sharedSearch(new URLSearchParams('period=7d&compare=year_ago&device=mobile'))).toBe('?period=7d&compare=year_ago')
    expect(sharedSearch(new URLSearchParams('device=mobile'))).toBe('')
  })
})
