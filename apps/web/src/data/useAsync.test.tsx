import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAsync } from './useAsync'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAsync', () => {
  it('loading → done', async () => {
    const { result } = renderHook(() => useAsync(async () => 42, []))
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state).toEqual({ status: 'done', value: 42 }))
  })

  it('o respingere devine failed cu mesajul', async () => {
    const { result } = renderHook(() => useAsync(async () => { throw new Error('Cădere.') }, []))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed', message: 'Cădere.' }))
  })

  it('un răspuns întârziat al unei cereri vechi nu suprascrie cererea curentă (schimbare de brand)', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const { result, rerender } = renderHook(({ id }) => useAsync(() => (id === 'a' ? first.promise : second.promise), [id]), { initialProps: { id: 'a' } })
    rerender({ id: 'b' })
    second.resolve('B')
    await waitFor(() => expect(result.current.state).toEqual({ status: 'done', value: 'B' }))
    await act(async () => first.resolve('A'))
    expect(result.current.state).toEqual({ status: 'done', value: 'B' })
  })

  it('reload reia cererea', async () => {
    let n = 0
    const { result } = renderHook(() => useAsync(async () => ++n, []))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'done', value: 1 }))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.state).toEqual({ status: 'done', value: 2 }))
  })
})
