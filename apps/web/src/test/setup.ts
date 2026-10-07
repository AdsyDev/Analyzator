import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

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
