import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { QueryContext } from '../contracts'
import type { FilterBarChange } from '../components/FilterBar'
import { parseQueryContext, resolvePeriod, writeQueryContext, type FilterDef } from '../lib/period'

/**
 * Contextul interogării (brand, perioadă, comparație, filtre) vine integral din URL: singura sursă
 * de adevăr pentru provideri. Schimbările înlocuiesc intrarea din istoric, iar „înapoi" păstrează contextul.
 */
export function useQueryContext(brandId: string | null, filterDefs: readonly FilterDef[] = [], now?: Date): {
  ctx: QueryContext | null
  change: (change: FilterBarChange) => void
  reset: () => void
} {
  const [params, setParams] = useSearchParams()

  const ctx = useMemo(
    () => (brandId ? parseQueryContext(params, brandId, filterDefs, now) : null),
    [brandId, params, filterDefs, now],
  )

  const change = useCallback(
    (c: FilterBarChange) => {
      if (!ctx) return
      setParams(writeQueryContext(params, { period: c.period ?? ctx.period, comparison: c.comparison ?? ctx.comparison, filters: c.filters ?? ctx.filters }, filterDefs))
    },
    [ctx, params, setParams, filterDefs],
  )

  const reset = useCallback(() => {
    if (!ctx) return
    setParams(
      writeQueryContext(params, { period: resolvePeriod('28d', now), comparison: 'previous', filters: Object.fromEntries(filterDefs.map((d) => [d.key, d.defaultValue])) }, filterDefs),
    )
  }, [ctx, params, setParams, filterDefs, now])

  return { ctx, change, reset }
}
