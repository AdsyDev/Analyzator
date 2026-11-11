import { describe, expect, it } from 'vitest'
import { csvFileName, toCsv } from './csv'

describe('toCsv', () => {
  it('separator „;”, zecimale cu virgulă, CRLF; lipsa e celulă goală, nu 0', () => {
    expect(toCsv(['Canal', 'Sesiuni', 'Rată'], [['Organic Search', 120, 4.5], ['Direct', null, undefined], ['Email', 0, 0]])).toBe(
      'Canal;Sesiuni;Rată\r\nOrganic Search;120;4,5\r\nDirect;;\r\nEmail;0;0\r\n',
    )
  })

  it('ghilimele pentru separator, ghilimele și rânduri noi', () => {
    expect(toCsv(['Text'], [['a;b'], ['zice "da"'], ['rând\nnou']])).toBe('Text\r\n"a;b"\r\n"zice ""da"""\r\n"rând\nnou"\r\n')
  })

  it('un text care ar fi citit ca formulă primește apostrof; numerele negative rămân numere', () => {
    expect(toCsv(['Campanie', 'Variație'], [['=HYPERLINK("http://rau.test")', -3.2], ['+40 700', 1], ['@cont', 2], ['-reducere', 3]])).toBe(
      'Campanie;Variație\r\n"\'=HYPERLINK(""http://rau.test"")";-3,2\r\n\'+40 700;1\r\n\'@cont;2\r\n\'-reducere;3\r\n',
    )
  })

  it('NaN și infinit nu se scriu ca valori', () => {
    expect(toCsv(['x'], [[Number.NaN], [Number.POSITIVE_INFINITY]])).toBe('x\r\n\r\n\r\n')
  })
})

describe('csvFileName', () => {
  it('fără diacritice și fără caractere speciale; părțile goale se sar', () => {
    expect(csvFileName('Keywords urmărite', 'Minimarțieni', null, '2026-10-01', '2026-10-31')).toBe('keywords-urmarite_minimartieni_2026-10-01_2026-10-31.csv')
    expect(csvFileName('', null)).toBe('export.csv')
    expect(csvFileName('../../etc/passwd')).toBe('etc-passwd.csv')
  })
})
