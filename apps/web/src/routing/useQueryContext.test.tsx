import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { FilterDef } from '../lib/period'
import { useQueryContext } from './useQueryContext'

const NOW = new Date('2026-10-06T07:00:00Z')
const defs: FilterDef[] = [{ key: 'device', label: 'Device', defaultValue: 'all', options: [{ value: 'all', label: 'Toate' }, { value: 'mobile', label: 'Mobil' }] }]

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
}

describe('useQueryContext', () => {
  it('brandul și filtrele vin din URL', () => {
    const { result } = renderHook(() => useQueryContext('b7', defs, NOW), { wrapper: wrapper('/brands/b7/traffic?period=7d&device=mobile') })
    expect(result.current.ctx?.brandId).toBe('b7')
    expect(result.current.ctx?.period.preset).toBe('7d')
    expect(result.current.ctx?.filters).toEqual({ device: 'mobile' })
  })

  it('fără brand (rută de administrare) nu există context de interogare', () => {
    const { result } = renderHook(() => useQueryContext(null, defs, NOW), { wrapper: wrapper('/admin/sources') })
    expect(result.current.ctx).toBeNull()
  })

  it('o schimbare scrie în URL, iar resetarea îl curăță', () => {
    const { result } = renderHook(() => ({ q: useQueryContext('b7', defs, NOW), loc: useLocation() }), { wrapper: wrapper('/brands/b7/traffic') })
    act(() => result.current.q.change({ filters: { device: 'mobile' } }))
    expect(result.current.loc.search).toBe('?device=mobile')
    expect(result.current.q.ctx?.filters.device).toBe('mobile')
    act(() => result.current.q.reset())
    expect(result.current.loc.search).toBe('')
  })
})
