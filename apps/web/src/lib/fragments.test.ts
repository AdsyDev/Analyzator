import { describe, expect, it } from 'vitest'
import { splitIntoFragments } from './fragments'

describe('splitIntoFragments', () => {
  it('un text scurt e un singur fragment, fără secțiune', () => {
    expect(splitIntoFragments('Un singur paragraf.\nPe două rânduri.')).toEqual([{ section_ref: null, content: 'Un singur paragraf.\nPe două rânduri.' }])
  })

  it('rândurile cu # dau secțiunea fragmentelor care urmează și nu intră în text', () => {
    const f = splitIntoFragments('Introducere.\n\n# Administrare\nUn comprimat pe zi.\n\n## Păstrare\n\nLa temperatura camerei.')
    expect(f).toEqual([
      { section_ref: null, content: 'Introducere.' },
      { section_ref: 'Administrare', content: 'Un comprimat pe zi.' },
      { section_ref: 'Păstrare', content: 'La temperatura camerei.' },
    ])
  })

  it('paragrafele scurte ale aceleiași secțiuni se grupează; o secțiune nouă începe un fragment nou', () => {
    const f = splitIntoFragments('# A\nunu\n\ndoi\n\n# B\ntrei')
    expect(f).toEqual([{ section_ref: 'A', content: 'unu\n\ndoi' }, { section_ref: 'B', content: 'trei' }])
  })

  it('un paragraf lung se taie la sfârșit de propoziție, sub limita bazei, fără să piardă text', () => {
    const sentence = 'Aceasta este o propoziție de umplutură pentru testul de tăiere. '
    const long = sentence.repeat(60).trim()
    const f = splitIntoFragments(long)
    expect(f.length).toBeGreaterThan(1)
    expect(f.every((x) => x.content.length <= 1500)).toBe(true)
    expect(f.slice(0, -1).every((x) => x.content.endsWith('.'))).toBe(true)
    expect(f.map((x) => x.content).join(' ').replace(/\s+/g, ' ')).toBe(long)
  })

  it('un șir fără spații se taie oricum la limită', () => {
    const f = splitIntoFragments('x'.repeat(3200))
    expect(f.map((x) => x.content.length)).toEqual([1500, 1500, 200])
  })

  it('text gol, doar spații sau doar titluri: niciun fragment', () => {
    expect(splitIntoFragments('')).toEqual([])
    expect(splitIntoFragments('  \n\n \r\n')).toEqual([])
    expect(splitIntoFragments('# Doar un titlu')).toEqual([])
  })
})
