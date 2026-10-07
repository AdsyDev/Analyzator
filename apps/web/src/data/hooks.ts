import type { MetricDefinition, MetricsBundle, ProviderResult, QueryContext, TrendSeries } from '../contracts'
import { useProviders } from './DataProvidersContext'
import { useAsync, type AsyncState } from './useAsync'

/** Cheie stabilă pentru contextul interogării: cererile se reiau doar când se schimbă ceva real. */
export const ctxKey = (c: QueryContext): string =>
  [c.brandId, c.period.preset, c.period.from, c.period.to, c.comparison, JSON.stringify(c.filters)].join('|')

/** Definițiile din registru, pe cheie. O cheie fără definiție lipsește din hartă: nu se inventează. */
export function useDefinitions(keys: readonly string[]): { state: AsyncState<ProviderResult<MetricDefinition[]>>; byKey: Map<string, MetricDefinition> } {
  const { metrics } = useProviders()
  const { state } = useAsync(() => metrics.definitions(keys), [metrics, keys.join(',')])
  const byKey = new Map<string, MetricDefinition>()
  if (state.status === 'done' && state.value.kind === 'ready') for (const d of state.value.data) byKey.set(d.metric_key, d)
  return { state, byKey }
}

export function useMetrics(ctx: QueryContext, keys: readonly string[]): { state: AsyncState<MetricsBundle>; reload: () => void } {
  const { metrics } = useProviders()
  return useAsync(() => metrics.metrics(ctx, keys), [metrics, ctxKey(ctx), keys.join(',')])
}

export function useTrends(ctx: QueryContext, keys: readonly string[]): { state: AsyncState<TrendSeries[]>; reload: () => void } {
  const { metrics } = useProviders()
  return useAsync(() => metrics.trends(ctx, keys), [metrics, ctxKey(ctx), keys.join(',')])
}
