import { describe, expect, it } from 'vitest'
import { safeUrl } from './safeUrl'

describe('safeUrl', () => {
  it.each([
    ['https://sfatulmedicului.example/cistita', 'https://sfatulmedicului.example/cistita'],
    ['http://farmacia.example/x?a=1#f', 'http://farmacia.example/x?a=1#f'],
    ['  https://x.example/a  ', 'https://x.example/a'],
  ])('acceptă %s', (input, out) => expect(safeUrl(input)).toBe(out))

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    'file:///etc/passwd',
    'ftp://x.example/f',
    '//evil.example/x',
    '/cale/relativa',
    'https://user:parola@x.example/',
    'https://:parola@x.example/',
    'nu e un url',
    '',
  ])('respinge %j', (input) => expect(safeUrl(input)).toBeNull())

  it('respinge null și undefined', () => {
    expect(safeUrl(null)).toBeNull()
    expect(safeUrl(undefined)).toBeNull()
  })
})
