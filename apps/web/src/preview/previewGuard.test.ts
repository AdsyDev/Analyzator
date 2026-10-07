import { describe, expect, it } from 'vitest'
import { PREVIEW_ALLOWED_MODES, assertPreviewAllowed, isPreviewEnabled } from '../../vite.preview-guard'

describe('garda VITE_DESIGN_PREVIEW', () => {
  it('fără flag, orice mod trece', () => {
    for (const mode of ['production', 'staging', 'development', 'test', 'altceva']) {
      expect(() => assertPreviewAllowed(mode, {})).not.toThrow()
      expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: '' })).not.toThrow()
      expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: 'false' })).not.toThrow()
    }
  })

  it.each(['production', 'staging'])('cu flag, modul %s eșuează', (mode) => {
    expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: 'true' })).toThrow(new RegExp(`„${mode}"`))
  })

  it('e allowlist: orice mod nou sau necunoscut eșuează, nu doar production și staging', () => {
    for (const mode of ['qa', 'preview', 'test', 'Production', 'STAGING', '']) {
      expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: 'true' }), `mod „${mode}"`).toThrow(/nu e permis/)
    }
  })

  it('doar modurile de dezvoltare și design-preview acceptă flag-ul', () => {
    expect([...PREVIEW_ALLOWED_MODES]).toEqual(['development', 'design-preview'])
    for (const mode of PREVIEW_ALLOWED_MODES) expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: 'true' })).not.toThrow()
  })

  it.each(['1', 'TRUE', 'yes', 'True', ' true'])('valoarea ambiguă %j eșuează în orice mod, nu e tratată ca dezactivat', (v) => {
    for (const mode of ['development', 'production', 'staging']) {
      expect(() => assertPreviewAllowed(mode, { VITE_DESIGN_PREVIEW: v })).toThrow(/Valorile acceptate/)
    }
  })

  it('isPreviewEnabled e adevărat doar pentru „true" exact', () => {
    expect(isPreviewEnabled({ VITE_DESIGN_PREVIEW: 'true' })).toBe(true)
    for (const v of [undefined, '', 'false', '1', 'TRUE']) expect(isPreviewEnabled({ VITE_DESIGN_PREVIEW: v })).toBe(false)
  })
})
