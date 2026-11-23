import { describe, expect, it } from 'vitest'
import type { AirbyteAccount } from '../contracts'
import { proposeAirbyteMapping, siteKeys } from './airbyteMapping'

const acc = (platform: AirbyteAccount['platform'], account_id: string, name: string): AirbyteAccount => ({
  id: `${platform}:${account_id}`, name, detail: `${platform} · ID ${account_id}`, platform, account_id,
  rows: 10, first_date: '2026-10-01', last_date: '2026-10-20', last_synced_at: '2026-10-21T03:00:00Z', tables: 1,
})
const site = (id: string, name: string, domain: string | null = null, status: 'active' | 'archived' = 'active') => ({ id, name, domain, status })

describe('propunerea de mapare Airbyte', () => {
  const spaces = [site('b-pro', 'Proenzi', 'proenzi.ro'), site('b-afl', 'Aflamin', 'https://www.aflamin.ro'), site('b-gel', 'Aflamin Gel'), site('b-old', 'Urinal', null, 'archived')]

  it('fiecare platformă primește site-ul după nume, cu diacritice și sufixe de țară sau monedă ignorate', () => {
    const p = proposeAirbyteMapping(
      [acc('meta_ads', '1', 'Proenzi RO (EUR)'), acc('google_ads', '2', 'PROENZI - Search'), acc('tiktok_ads', '3', 'proenzi_ro')],
      spaces, 'STADA România', new Map(),
    )
    expect(p.rows.map((r) => [r.account.id, r.proposed])).toEqual([
      ['google_ads:2', 'b-pro'], ['meta_ads:1', 'b-pro'], ['tiktok_ads:3', 'b-pro'],
    ])
  })

  it('cel mai specific site câștigă; la scor egal, contul rămâne nepropus, cu candidații', () => {
    const p = proposeAirbyteMapping([acc('meta_ads', '1', 'Aflamin Gel RO'), acc('meta_ads', '2', 'Aflamin RO')], spaces, 'STADA', new Map())
    const by = Object.fromEntries(p.rows.map((r) => [r.account.account_id, r]))
    expect(by['1']!.proposed).toBe('b-gel')
    expect(by['2']!.proposed).toBeNull()
    expect(by['2']!.candidates.sort()).toEqual(['b-afl', 'b-gel'])
  })

  it('conturile legate deja nu se propun; site-urile arhivate nu primesc propuneri; fără potrivire = null', () => {
    const p = proposeAirbyteMapping([acc('meta_ads', '1', 'Proenzi RO'), acc('meta_ads', '9', 'Urinal RO'), acc('google_ads', '5', 'Alt client')], spaces, 'STADA', new Map([['meta_ads:1', 'b-pro']]))
    expect(p.linked.map((l) => [l.account.id, l.brand_id])).toEqual([['meta_ads:1', 'b-pro']])
    expect(p.rows.map((r) => [r.account.id, r.proposed, r.candidates])).toEqual([['google_ads:5', null, []], ['meta_ads:9', null, []]])
  })

  it('cuvintele din numele clientului nu leagă un cont de toate site-urile', () => {
    expect(siteKeys({ name: 'STADA Proenzi', domain: 'stada-proenzi.ro' }, 'STADA România')).toEqual(['proenzi'])
    const p = proposeAirbyteMapping([acc('meta_ads', '1', 'STADA Corporate')], [site('a', 'STADA Proenzi'), site('b', 'STADA Aflamin')], 'STADA România', new Map())
    expect(p.rows[0]!.proposed).toBeNull()
    expect(p.rows[0]!.candidates).toEqual([])
  })
})
