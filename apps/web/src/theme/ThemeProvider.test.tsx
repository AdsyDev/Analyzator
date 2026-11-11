import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeProvider'

function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: dark,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    set(next: boolean) {
      query.matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

function Probe() {
  const { theme, explicit, toggleTheme } = useTheme()
  return (
    <button onClick={toggleTheme}>
      {theme}:{explicit ? 'explicit' : 'sistem'}
    </button>
  )
}

const attr = () => document.documentElement.getAttribute('data-az-theme')

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-az-theme')
    window.localStorage.removeItem('az-theme')
  })


  it('pornește pe tema închisă când nu există alegere salvată, indiferent de tema sistemului', () => {
    mockSystem(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('dark:sistem')
    expect(attr()).toBe('dark')
  })

  it('nu urmărește tema sistemului', () => {
    const sys = mockSystem(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => sys.set(true))
    act(() => sys.set(false))
    expect(attr()).toBe('dark')
  })

  it('persistă alegerea explicită', async () => {
    mockSystem(true)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('light:explicit')
    expect(window.localStorage.getItem('az-theme')).toBe('light')
    expect(attr()).toBe('light')
  })

  it('citește tema salvată la pornire', () => {
    mockSystem(true)
    window.localStorage.setItem('az-theme', 'light')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(attr()).toBe('light')
  })

  it('ignoră o valoare salvată invalidă', () => {
    mockSystem(false)
    window.localStorage.setItem('az-theme', 'neon')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('dark:sistem')
  })
})
