import { describe, expect, it } from 'vitest'
import { count, runErrorCodes, runReason } from './runReason'

const cov = (expected: number, covered: number) => ({ expected_days: expected, covered_days: covered, coverage: covered / expected })

describe('runReason', () => {
  it('GA4 parțial (20 oct. 2026): zilele fără sesiuni și fără evenimente cheie, cu numărul lor', () => {
    expect(runReason('partial', [], { web_daily: cov(35, 30), web_key_events: cov(35, 0), web_active_users_interval: cov(6, 6) })).toBe(
      '5 din 35 de zile fără sesiuni; 35 din 35 de zile fără evenimente cheie',
    )
  })

  it('erorile vin înaintea golurilor; cel mult trei motive, fără repetări', () => {
    const errors = [{ code: 'ga4_thresholding', message: 'x' }, { code: 'ga4_thresholding', message: 'y' }, { code: 'ga4_sampled', message: 'z' }, { code: 'timezone_mismatch', message: 't' }]
    expect(runReason('partial', errors, { web_daily: cov(35, 34) })).toBe(
      'GA4 a ascuns valori mici (pragul de confidențialitate); GA4 a eșantionat raportul; fusul orar al proprietății diferă de cel configurat',
    )
  })

  it('SEOmonitor (20 oct. 2026): timeout la baza de date și originalele AI nesalvate', () => {
    expect(runReason('failed', [{ code: 'exception', message: 'POST ai_answer_originals: HTTP 500 57014 canceling statement due to statement timeout' }], null)).toBe('baza de date nu a răspuns la timp')
    expect(runReason('partial', [{ code: 'ai_originals_not_saved', message: '57014' }], null)).toBe('textele originale ale răspunsurilor AI nu au fost salvate')
    expect(runReason('failed', [{ code: 'exception', message: 'altceva' }], null)).toBe('eroare tehnică în timpul colectării')
  })

  it('observațiile (câmpuri noi în API) nu sunt motive; un cod necunoscut nu se interpretează', () => {
    expect(runReason('partial', [{ code: 'parser_unknown_field', message: 'ai_search_provider' }], null)).toBeNull()
    expect(runReason('partial', [{ code: 'ceva_nou', message: '?' }], null)).toBe('alte erori tehnice')
    expect(runReason('partial', [{ code: 'normalize_invalid_value', message: '3×' }], null)).toBe('unele rânduri au fost respinse la validare')
  })

  it('Search Console: cele două seturi de date dau un singur motiv, cu golul cel mai mare', () => {
    expect(runReason('partial', [], { search_daily: cov(35, 33), search_queries: cov(35, 32) })).toBe('3 din 35 de zile fără date Search Console')
  })

  it('reușit, în coadă sau fără explicație salvată: null', () => {
    expect(runReason('succeeded', [{ code: 'access_denied' }], { web_daily: cov(35, 1) })).toBeNull()
    expect(runReason('queued', [], null)).toBeNull()
    expect(runReason('failed', [], null)).toBeNull()
    expect(runReason('failed', 'nu e listă', 'nici asta')).toBeNull()
  })

  it('erorile ca text simplu (rulări vechi) se citesc ca coduri', () => {
    expect(runReason('failed', ['access_denied'], null)).toBe('accesul a fost refuzat de furnizor')
    expect(runErrorCodes(['access_denied', { code: 'parser_unknown_field' }, { code: 'empty_report' }, { code: 'empty_report' }])).toEqual(['access_denied', 'empty_report'])
  })

  it('count: „1 zi”, „7 zile”, „35 de zile”, „6 intervale”', () => {
    expect([count(1, 'zile'), count(7, 'zile'), count(19, 'zile'), count(20, 'zile'), count(35, 'zile'), count(6, 'intervale'), count(101, 'zile')]).toEqual([
      '1 zi', '7 zile', '19 zile', '20 de zile', '35 de zile', '6 intervale', '101 zile',
    ])
  })
})
