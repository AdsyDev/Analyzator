import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Suita rulează zeci de fișiere în paralel; `findBy*` are nevoie de mai mult de 1 s sub încărcare.
configure({ asyncUtilTimeout: 3000 })

// Node recente expun un `localStorage` propriu, incomplet, care umbrește jsdom.
// Un Storage în memorie face testele deterministe indiferent de versiunea de Node.
function memoryStorage(): Storage {
  let data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => {
      data = new Map()
    },
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
