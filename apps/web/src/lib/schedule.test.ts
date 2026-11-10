import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLLECTION_SCHEDULE, nextScheduledRun, nextScheduledRunFor, type Schedule } from './schedule'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const WORKFLOW = {
  seomonitor: 'seomonitor-weekly.yml',
  ga4: 'google-weekly.yml',
  gsc: 'google-weekly.yml',
  planable: 'planable-weekly.yml',
  google_ads: 'google-ads-weekly.yml',
  meta_ads: 'meta-weekly.yml',
  tiktok_ads: 'tiktok-weekly.yml',
  clarity: 'clarity-daily.yml',
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

  it('săptămânal: următoarea marți la 04:00 UTC; în ziua rulării, după oră, trece la săptămâna următoare', () => {
    expect(nextScheduledRun('ga4', new Date('2026-11-10T03:59:00Z'))?.toISOString()).toBe('2026-11-10T04:00:00.000Z')
    expect(nextScheduledRun('ga4', new Date('2026-11-10T04:00:00Z'))?.toISOString()).toBe('2026-11-17T04:00:00.000Z')
    expect(nextScheduledRun('seomonitor', new Date('2026-11-13T12:00:00Z'))?.toISOString()).toBe('2026-11-17T04:00:00.000Z')
  })

  it('zilnic (Clarity): azi la 22:05 UTC sau mâine', () => {
    expect(nextScheduledRun('clarity', new Date('2026-11-10T12:00:00Z'))?.toISOString()).toBe('2026-11-10T22:05:00.000Z')
    expect(nextScheduledRun('clarity', new Date('2026-11-10T23:00:00Z'))?.toISOString()).toBe('2026-11-11T22:05:00.000Z')
  })

  it('o sursă fără programare nu are estimare; dintre mai multe surse se alege cea mai apropiată', () => {
    expect(nextScheduledRun('csv_import', new Date('2026-11-10T12:00:00Z'))).toBeNull()
    expect(nextScheduledRunFor(['csv_import'], new Date('2026-11-10T12:00:00Z'))).toBeNull()
    expect(nextScheduledRunFor(['ga4', 'clarity'], new Date('2026-11-10T12:00:00Z'))?.toISOString()).toBe('2026-11-10T22:05:00.000Z')
  })
})
