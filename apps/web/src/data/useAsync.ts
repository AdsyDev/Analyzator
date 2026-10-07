import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export type AsyncState<T> = { status: 'loading' } | { status: 'done'; value: T } | { status: 'failed'; message: string }

/**
 * Încarcă o valoare asincronă. Un răspuns întârziat al unei cereri vechi nu suprascrie cererea
 * curentă (schimbare de brand sau de filtre). `reload` reia cererea (de ex. „Reîncearcă").
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): { state: AsyncState<T>; reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const latest = useRef(0)
  const run = useCallback(load, deps)

  useEffect(() => {
    const id = ++latest.current
    setState({ status: 'loading' })
    run().then(
      (value) => {
        if (id === latest.current) setState({ status: 'done', value })
      },
      (e: unknown) => {
        if (id === latest.current) setState({ status: 'failed', message: e instanceof Error ? e.message : 'Eroare necunoscută.' })
      },
    )
    return () => {
      latest.current++
    }
  }, [run, nonce])

  return { state, reload: () => setNonce((n) => n + 1) }
}
