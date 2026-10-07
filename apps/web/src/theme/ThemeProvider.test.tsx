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
  beforeEach(() => document.documentElement.removeAttribute('data-az-theme'))
  

  it('pornește din prefers-color-scheme când nu există alegere salvată', () => {
    mockSystem(true)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('dark:sistem')
    expect(attr()).toBe('dark')
  })

  it('urmărește sistemul cât timp utilizatorul nu a ales', () => {
    const sys = mockSystem(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(attr()).toBe('light')
    act(() => sys.set(true))
    expect(attr()).toBe('dark')
  })

  it('persistă alegerea explicită și o preferă sistemului', async () => {
    const sys = mockSystem(false)
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button').textContent).toBe('dark:explicit')
    expect(window.localStorage.getItem('az-theme')).toBe('dark')
    act(() => sys.set(false))
    expect(attr()).toBe('dark')
  })

  it('citește tema salvată la pornire', () => {
    mockSystem(false)
    window.localStorage.setItem('az-theme', 'dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(attr()).toBe('dark')
  })

  it('ignoră o valoare salvată invalidă', () => {
    mockSystem(false)
    window.localStorage.setItem('az-theme', 'neon')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(screen.getByRole('button').textContent).toBe('light:sistem')
  })
})
