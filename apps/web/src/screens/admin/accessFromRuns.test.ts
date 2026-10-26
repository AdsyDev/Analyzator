import { describe, expect, it } from 'vitest'
import type { SyncRun } from '../../contracts'
import { accessFromRuns } from './ConnectionCard'

const run = (o: Partial<SyncRun>): SyncRun => ({
  id: 'r', brand_id: 'b', provider: 'ga4', connection_id: 'c-1', range_from: '2026-09-15', range_to: '2026-10-19',
  started_at: '2026-10-20T08:59:00Z', finished_at: '2026-10-20T09:01:00Z', rows: 64, status: 'partial', error: null, reason: null, error_codes: [], ...o,
})

describe('accessFromRuns (conexiuni cu cheia clientului)', () => {
  it('ultima colectare cu date confirmă accesul, chiar dacă a fost parțială', () => {
    const a = accessFromRuns('ga4', [run({})])
    expect(a).toMatchObject({ tone: 'pos', label: 'Acces confirmat' })
    expect(a.text).toMatch(/^Confirmat de colectarea din .+: 64 de rânduri\.$/)
  })

  it('un refuz de acces la ultima rulare are prioritate față de o confirmare mai veche, cu ce trebuie făcut', () => {
    const a = accessFromRuns('ga4', [run({ started_at: '2026-10-13T08:00:00Z' }), run({ id: 'r2', started_at: '2026-10-20T08:00:00Z', status: 'failed', rows: 0, error_codes: ['access_denied'] })])
    expect(a).toMatchObject({ tone: 'neg', label: 'Acces refuzat' })
    expect(a.text).toMatch(/Adaugă service account-ul clientului ca Viewer în proprietatea GA4\./)
  })

  it('Meta: contul neatribuit system user-ului (permission_denied) = acces refuzat, cu pasul de rezolvare', () => {
    const a = accessFromRuns('meta_ads', [run({ provider: 'meta_ads', status: 'failed', rows: 0, error_codes: ['permission_denied'] })])
    expect(a).toMatchObject({ tone: 'neg', label: 'Acces refuzat' })
    expect(a.text).toMatch(/Atribuie contul de ads system user-ului/)
  })

  it('rulări fără date: neconfirmat; nicio rulare: neverificat', () => {
    expect(accessFromRuns('gsc', [run({ status: 'failed', rows: 0, error_codes: ['exception'] })])).toMatchObject({ tone: 'warn', label: 'Neconfirmat' })
    expect(accessFromRuns('planable', [])).toMatchObject({ tone: 'neutral', label: 'Neverificat' })
  })

  it('un rând la singular', () => {
    expect(accessFromRuns('gsc', [run({ rows: 1, status: 'succeeded' })]).text).toMatch(/: 1 rând\.$/)
  })
})
