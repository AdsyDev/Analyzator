import { describe, expect, it } from 'vitest'
import { platformOf } from './platform'

describe('platformOf: aspectul cardului din adresă, apoi din numele sursei', () => {
  it('domeniul adresei are prioritate față de numele sursei', () => {
    expect(platformOf('https://www.facebook.com/post/1', 'Forum')).toBe('facebook')
    expect(platformOf('https://m.facebook.com/x', '')).toBe('facebook')
    expect(platformOf('https://www.instagram.com/p/abc', '')).toBe('instagram')
    expect(platformOf('https://youtu.be/abc', '')).toBe('youtube')
    expect(platformOf('https://twitter.com/a/status/1', '')).toBe('x')
    expect(platformOf('https://www.reddit.com/r/x', '')).toBe('reddit')
  })

  it('fără adresă recunoscută: numele sursei (CSV și Planable)', () => {
    expect(platformOf(null, 'Facebook (public)')).toBe('facebook')
    expect(platformOf('https://exemplu.ro/a', 'Instagram (public)')).toBe('instagram')
    expect(platformOf(null, 'Forum Sănătatea Ta')).toBe('forum')
    expect(platformOf(null, 'Grup mămici')).toBe('forum')
    expect(platformOf(null, 'Review farmacie online')).toBe('review')
    expect(platformOf(null, 'Știri online')).toBe('news')
    expect(platformOf(null, 'tiktok')).toBe('tiktok')
  })

  it('ce nu se recunoaște e „web”, nu o presupunere; o adresă invalidă nu aruncă', () => {
    expect(platformOf('https://exemplu.ro/a', 'exemplu.ro')).toBe('web')
    expect(platformOf('nu e url', 'Blog')).toBe('web')
    // Un domeniu care doar conține numele rețelei nu e rețeaua.
    expect(platformOf('https://notfacebook.com.evil.ro/x', 'blog')).toBe('web')
  })
})
