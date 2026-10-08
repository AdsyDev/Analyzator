import type { ReactNode } from 'react'
import type { ProviderResult } from '../../contracts'
import type { AsyncState } from '../../data/useAsync'
import { ProviderProblem } from '../../routing/pages'

interface Props<T> {
  state: AsyncState<ProviderResult<T>>
  onRetry: () => void
  /** Eticheta schelet-ului, pentru cititoarele de ecran. */
  loadingLabel: string
  /** Înălțimea schelet-ului, ca pagina să nu sară la încărcare. */
  skeletonClass?: string
  children: (data: T) => ReactNode
}

/**
 * Stările comune ale unei secțiuni care citește un provider: încărcare (schelet), eroare cu „Reîncearcă",
 * „Sursă neconectată" cu motivul, apoi conținutul. O secțiune lentă sau căzută nu blochează restul paginii.
 */
export function Resolved<T>({ state, onRetry, loadingLabel, skeletonClass = 'h-40', children }: Props<T>) {
  if (state.status === 'loading') return <div role="status" aria-label={loadingLabel} className={`${skeletonClass} rounded-xl bg-skeleton`} />
  if (state.status === 'failed') return <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={onRetry} />
  if (state.value.kind !== 'ready') return <ProviderProblem result={state.value} onRetry={onRetry} />
  return <>{children(state.value.data)}</>
}
