import { describe, expect, it } from 'vitest'
import { normalizeDomain, slugify, SLUG_PATTERN } from './slug'

describe('slugify', () => {
  it('scoate diacriticele și spațiile', () => {
    expect(slugify('STADA România')).toBe('stada-romania')
    expect(slugify('  Ștefan & Țară  ')).toBe('stefan-tara')
  })
  it('respectă forma acceptată de baza de date', () => {
    for (const s of ['Brand -- nou!', 'a', 'Minimartieni 2026', '—x—']) expect(slugify(s)).toMatch(SLUG_PATTERN)
  })
  it('text fără litere sau cifre → gol (formularul cere un nume valid)', () => {
    expect(slugify('—!—')).toBe('')
  })
})

describe('normalizeDomain', () => {
  it('păstrează doar domeniul', () => {
    expect(normalizeDomain('https://www.Urinal.ro/produse?x=1')).toBe('urinal.ro')
    expect(normalizeDomain('proenzi.ro/')).toBe('proenzi.ro')
    expect(normalizeDomain('http://user@shop.exemplu.ro:8080/a')).toBe('shop.exemplu.ro')
  })
  it('gol → null, invalid → undefined', () => {
    expect(normalizeDomain('   ')).toBeNull()
    expect(normalizeDomain('nu e domeniu')).toBeUndefined()
    expect(normalizeDomain('localhost')).toBeUndefined()
  })
})
