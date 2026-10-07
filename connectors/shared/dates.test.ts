import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { calendarDateInBucharest, previousCalendarDayInBucharest } from './dates.ts'

describe('ziua anterioară în Europe/Bucharest', () => {
  const cases: Array<[string, string, string]> = [
    // [moment UTC, zi locală, zi anterioară]
    ['2026-10-07T12:00:00Z', '2026-10-07', '2026-10-06'],
    // Miezul nopții local (EEST, UTC+3) e încă ziua precedentă în UTC.
    ['2026-10-06T21:30:00Z', '2026-10-07', '2026-10-06'],
    ['2026-10-06T20:59:59Z', '2026-10-06', '2026-10-05'],
    // 25 octombrie 2026: ora 04:00 EEST devine 03:00 EET (01:00 UTC). Ziua are 25 de ore.
    ['2026-10-24T21:00:00Z', '2026-10-25', '2026-10-24'], // 00:00 EEST, 25 oct
    ['2026-10-25T00:59:59Z', '2026-10-25', '2026-10-24'], // 03:59:59 EEST, înainte de schimbare
    ['2026-10-25T01:00:00Z', '2026-10-25', '2026-10-24'], // 03:00 EET, după schimbare
    ['2026-10-25T21:59:59Z', '2026-10-25', '2026-10-24'], // 23:59:59 EET, ultima secundă din 25 oct
    ['2026-10-25T22:00:00Z', '2026-10-26', '2026-10-25'], // 00:00 EET, 26 oct → ziua de 25 de ore
    ['2026-10-26T04:00:00Z', '2026-10-26', '2026-10-25'], // rularea de luni dimineață
    // Trecerea la ora de vară: 29 martie 2026, 03:00 EET → 04:00 EEST.
    ['2026-03-28T22:00:00Z', '2026-03-29', '2026-03-28'],
    ['2026-03-29T21:00:00Z', '2026-03-30', '2026-03-29'],
    // Schimbare de lună și de an.
    ['2026-11-01T06:00:00Z', '2026-11-01', '2026-10-31'],
    ['2026-12-31T22:30:00Z', '2027-01-01', '2026-12-31'],
    ['2028-03-01T06:00:00Z', '2028-03-01', '2028-02-29'],
  ]

  for (const [instant, local, previous] of cases) {
    test(`${instant} → local ${local}, anterior ${previous}`, () => {
      assert.equal(calendarDateInBucharest(new Date(instant)), local)
      assert.equal(previousCalendarDayInBucharest(new Date(instant)), previous)
    })
  }
})
