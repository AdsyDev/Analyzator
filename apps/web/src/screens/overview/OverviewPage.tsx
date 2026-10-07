import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isAgencyRole, type Brand, type QueryContext, type SessionUser } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { useDefinitions, useMetrics, useTrends, ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { CompetitorSection } from './CompetitorSection'
import { ContextBar } from './ContextBar'
import { EvidenceHost, type EvidenceTarget } from './EvidenceHost'
import { LatestInsight, Opportunities } from './InsightSections'
import { KpiGrid } from './KpiGrid'
import { KPI_KEYS, TREND_SLOTS } from './slots'
import { TrendSection } from './TrendSection'

const TREND_KEYS = [...new Set([...KPI_KEYS, ...TREND_SLOTS.map((s) => s.key)])]

/**
 * Overview (spec cap. 12): bara de context, 6 KPI, evoluție, ultima analiză publicată, comparația scurtă cu
 * C1-C3 și oportunități. Toate datele vin prin provideri; fiecare secțiune are stările ei de încărcare,
 * eroare și „Sursă neconectată", deci o sursă lentă nu blochează restul paginii.
 */
export function OverviewPage() {
  const { brand, ctx, user } = useLayout()
  // Layout-ul garantează brandul permis și contextul din URL; fără ele nu se montează nimic și nu se cere nimic.
  if (!brand || !ctx) return null
  return <OverviewContent brand={brand} ctx={ctx} user={user} />
}

function OverviewContent({ brand, ctx, user }: { brand: Brand; ctx: QueryContext; user: SessionUser }) {
  const providers = useProviders()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)

  const metrics = useMetrics(ctx, KPI_KEYS)
  const { byKey } = useDefinitions(KPI_KEYS)
  const trends = useTrends(ctx, TREND_KEYS)
  const insights = useAsync(() => providers.insights.list(ctx), [providers, ctxKey(ctx)])

  const agency = isAgencyRole(user.role)
  const search = sharedSearch(params)
  const trendLabels = new Map([...byKey].map(([k, d]) => [k, d.label]))
  const openEvidence = (query: EvidenceTarget['query'], label: string) => setTarget({ page: 'Overview', label, query })

  return (
    <div className="flex flex-col gap-5">
      <ContextBar brand={brand} ctx={ctx} items={metrics.state.status === 'done' ? metrics.state.value.items : null} />
      <KpiGrid metrics={metrics.state} definitions={byKey} trends={trends.state} onRetry={metrics.reload} onOpen={setTarget} />
      <TrendSection trends={trends.state} labels={trendLabels} onRetry={trends.reload} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <LatestInsight state={insights.state} agencyView={agency} allHref={`${brandPath(brand.id, 'insights')}${search}`} onRetry={insights.reload} onOpenEvidence={openEvidence} />
        <CompetitorSection brand={brand} ctx={ctx} fullHref={`${brandPath(brand.id, 'competition')}${search}`} />
      </div>
      <Opportunities state={insights.state} onRetry={insights.reload} onOpenEvidence={openEvidence} />
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={user.role === 'agency_admin'} />
    </div>
  )
}
