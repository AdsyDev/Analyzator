import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLLECTION_SCHEDULE, nextScheduledRun, nextScheduledRunFor, type Schedule } from './schedule'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const WORKFLOW = {
  seomonitor: 'seomonitor-daily.yml',
  ga4: 'google-daily.yml',
  gsc: 'google-daily.yml',
  planable: 'planable-daily.yml',
  google_ads: 'google-ads-daily.yml',
  meta_ads: 'meta-daily.yml',
  tiktok_ads: 'tiktok-daily.yml',
  clarity: 'clarity-daily.yml',
  airbyte: 'airbyte-daily.yml',
} as const

const cron = (s: Schedule) => (s.kind === 'weekly' ? `${s.minute} ${s.hour} * * ${s.weekday}` : `${s.minute} ${s.hour} * * *`)

describe('programarea colectării', () => {
  it('coincide cu cron-ul din workflow-ul fiecărei surse', () => {
    expect(Object.keys(COLLECTION_SCHEDULE).sort()).toEqual(Object.keys(WORKFLOW).sort())
    for (const [provider, file] of Object.entries(WORKFLOW)) {
      const yml = readFileSync(resolve(ROOT, '.github/workflows', file), 'utf8')
      const found = /cron:\s*'([^']+)'/.exec(yml)?.[1]
      expect(found, file).toBe(cron(COLLECTION_SCHEDULE[provider as keyof typeof WORKFLOW]!))
    }
  })

  it('conectorii API rulează zilnic la 03:17 UTC (AF), în orice zi a săptămânii, nu doar marțea', () => {
    expect(nextScheduledRun('ga4', new Date('2026-11-10T03:16:00Z'))?.toISOString()).toBe('2026-11-10T03:17:00.000Z')
    expect(nextScheduledRun('ga4', new Date('2026-11-10T03:17:00Z'))?.toISOString()).toBe('2026-11-11T03:17:00.000Z')
    expect(nextScheduledRun('seomonitor', new Date('2026-11-13T12:00:00Z'))?.toISOString()).toBe('2026-11-14T03:17:00.000Z')
    expect(nextScheduledRun('planable', new Date('2026-11-15T23:00:00Z'))?.toISOString()).toBe('2026-11-16T03:17:00.000Z')
  })

  it('săptămânal: următoarea zi programată; în ziua rulării, după oră, trece la săptămâna următoare', () => {
    const weekly: Schedule = { kind: 'weekly', weekday: 2, hour: 4, minute: 0 }
    const saved = COLLECTION_SCHEDULE.ga4
    COLLECTION_SCHEDULE.ga4 = weekly
    try {
      expect(nextScheduledRun('ga4', new Date('2026-11-10T03:59:00Z'))?.toISOString()).toBe('2026-11-10T04:00:00.000Z')
      expect(nextScheduledRun('ga4', new Date('2026-11-10T04:00:00Z'))?.toISOString()).toBe('2026-11-17T04:00:00.000Z')
    } finally {
      COLLECTION_SCHEDULE.ga4 = saved
    }
  })

  it('zilnic (Clarity): azi la 22:05 UTC sau mâine', () => {
    expect(nextScheduledRun('clarity', new Date('2026-11-10T12:00:00Z'))?.toISOString()).toBe('2026-11-10T22:05:00.000Z')
    expect(nextScheduledRun('clarity', new Date('2026-11-10T23:00:00Z'))?.toISOString()).toBe('2026-11-11T22:05:00.000Z')
  })

  it('o sursă fără programare nu are estimare; dintre mai multe surse se alege cea mai apropiată', () => {
    expect(nextScheduledRun('csv_import', new Date('2026-11-10T12:00:00Z'))).toBeNull()
    expect(nextScheduledRunFor(['csv_import'], new Date('2026-11-10T12:00:00Z'))).toBeNull()
    expect(nextScheduledRunFor(['ga4', 'clarity'], new Date('2026-11-10T12:00:00Z'))?.toISOString()).toBe('2026-11-10T22:05:00.000Z')
    expect(nextScheduledRunFor(['ga4', 'clarity'], new Date('2026-11-10T23:00:00Z'))?.toISOString()).toBe('2026-11-11T03:17:00.000Z')
  })
})
