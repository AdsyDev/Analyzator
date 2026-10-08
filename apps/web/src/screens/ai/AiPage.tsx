import { useState } from 'react'
import { AI_ENGINES, type AiEngine, type AiFilters, type Brand, type QueryContext } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics, useTrends } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { KpiGrid } from '../shared/KpiGrid'
import { AI_KPI_KEYS, AI_KPI_SLOTS } from './slots'
import { AnswerExplorer } from './AnswerExplorer'
import { CitedSources } from './CitedSources'
import { EngineCards } from './EngineCards'
import { EngineTrend } from './EngineTrend'
import { TopicMatrix } from './TopicMatrix'

/** Filtrele din URL → filtrele provider-ului. Valorile au trecut deja de allowlist-ul din `useQueryContext`. */
export function aiFiltersFrom(ctx: QueryContext): AiFilters {
  const engine = ctx.filters.engine
  const group = ctx.filters.group
  return {
    engine: (AI_ENGINES as readonly string[]).includes(engine ?? '') ? (engine as AiEngine) : null,
    group: group && group !== 'all' ? group : null,
  }
}

/**
 * AI Visibility (spec cap. 13). Fiecare secțiune citește prin provider și are stările ei; cheile `ai_*` din
 * KPI nu sunt încă în registru, deci cardurile arată „Sursă neconectată" până intră.
 */
export function AiPage() {
  const { brand, ctx, changeFilters, user } = useLayout()
  if (!brand || !ctx) return null
  return <AiContent brand={brand} ctx={ctx} canManageSources={user.role === 'agency_admin'} onFilters={(engine) => changeFilters({ filters: { ...ctx.filters, engine: engine ?? 'all' } })} />
}

function AiContent({ brand, ctx, canManageSources, onFilters }: { brand: Brand; ctx: QueryContext; canManageSources: boolean; onFilters: (engine: AiEngine | null) => void }) {
  const providers = useProviders()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const f = aiFiltersFrom(ctx)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, AI_KPI_KEYS)
  const { byKey } = useDefinitions(AI_KPI_KEYS)
  const sparks = useTrends(ctx, AI_KPI_KEYS)
  const engines = useAsync(() => providers.ai.engines(ctx, f), [providers, key])
  const trends = useAsync(() => providers.ai.trends(ctx, f), [providers, key])
  const matrix = useAsync(() => providers.ai.topicMatrix(ctx, f), [providers, key])
  const cited = useAsync(() => providers.ai.citedSources(ctx, f), [providers, key])

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid slots={AI_KPI_SLOTS} page="AI Visibility" metrics={metrics.state} definitions={byKey} trends={sparks.state} onRetry={metrics.reload} onOpen={setTarget} />
      <EngineCards state={engines.state} onRetry={engines.reload} selected={f.engine} onSelect={onFilters} />
      <EngineTrend state={trends.state} onRetry={trends.reload} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TopicMatrix state={matrix.state} onRetry={matrix.reload} />
        <CitedSources state={cited.state} onRetry={cited.reload} />
      </div>
      <AnswerExplorer key={key} brand={brand} ctx={ctx} filters={f} />
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={canManageSources} />
    </div>
  )
}
