import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

export type AsyncState<T> = { status: 'loading' } | { status: 'done'; value: T } | { status: 'failed'; message: string }

const LOADING = { status: 'loading' } as const

/**
 * Încarcă o valoare asincronă. Un răspuns întârziat al unei cereri vechi nu suprascrie cererea
 * curentă (schimbare de brand sau de filtre). `reload` reia cererea (de ex. „Reîncearcă").
 *
 * Rezultatul e legat de cererea care l-a produs: din primul render după schimbarea dependențelor starea e
 * `loading`, deci cifrele brandului sau ale perioadei precedente nu apar nici măcar un cadru sub contextul nou.
 * `reload` păstrează comportamentul vechi: aceeași cerere, reluată, trece prin `loading` abia din efect.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList): { state: AsyncState<T>; reload: () => void } {
  const [settled, setSettled] = useState<{ run: () => Promise<T>; state: AsyncState<T> } | null>(null)
  const [nonce, setNonce] = useState(0)
  const latest = useRef(0)
  const run = useCallback(load, deps)

  useEffect(() => {
    const id = ++latest.current
    setSettled({ run, state: LOADING })
    run().then(
      (value) => {
        if (id === latest.current) setSettled({ run, state: { status: 'done', value } })
      },
      (e: unknown) => {
        if (id === latest.current) setSettled({ run, state: { status: 'failed', message: e instanceof Error ? e.message : 'Eroare necunoscută.' } })
      },
    )
    return () => {
      latest.current++
    }
  }, [run, nonce])

  const state: AsyncState<T> = settled && settled.run === run ? settled.state : LOADING
  return { state, reload: () => setNonce((n) => n + 1) }
}
