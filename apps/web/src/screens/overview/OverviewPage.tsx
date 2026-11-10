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
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { LatestInsight, Opportunities } from './InsightSections'
import { ChangesSection } from './ChangesSection'
import { OverviewKpis } from './OverviewKpis'
import { KPI_KEYS, TREND_SLOTS } from './slots'
import { TrendSection } from './TrendSection'

const TREND_KEYS = [...new Set([...KPI_KEYS, ...TREND_SLOTS.map((s) => s.key)])]
const ALL_PLATFORMS = { platform: null, format: null } as const

/**
 * Overview pentru decizii rapide (spec cap. 12, propunerea din 10 nov. 2026): bara de context, șase indicatori, „Ce
 * s-a schimbat", evoluția brandului, poziția față de competitori, prioritățile următoare și interpretarea echipei.
 * Toate datele vin prin provideri; fiecare secțiune are stările ei de încărcare, eroare și „Sursă neconectată",
 * deci o sursă lentă nu blochează restul paginii. Nu există un scor general de brand.
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
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, KPI_KEYS)
  const { byKey } = useDefinitions(TREND_KEYS)
  const trends = useTrends(ctx, TREND_KEYS)
  const insights = useAsync(() => providers.insights.list(ctx), [providers, key])
  const sentiment = useAsync(() => providers.mentions.sentiment(ctx), [providers, key])
  const social = useAsync(() => providers.social.summary(ctx, ALL_PLATFORMS), [providers, key])

  const agency = isAgencyRole(user.role)
  const search = sharedSearch(params)
  const trendLabels = new Map([...byKey].map(([k, d]) => [k, d.label]))
  const openEvidence = (query: EvidenceTarget['query'], label: string) => setTarget({ page: 'Overview', label, query })

  return (
    <div className="flex flex-col gap-5">
      <ContextBar brand={brand} ctx={ctx} items={metrics.state.status === 'done' ? metrics.state.value.items : null} />
      <OverviewKpis brand={brand} ctx={ctx} search={search} metrics={metrics.state} definitions={byKey} trends={trends.state} sentiment={sentiment.state} social={social.state} onRetry={metrics.reload} onOpen={setTarget} />
      <ChangesSection
        metrics={metrics.state}
        definitions={byKey}
        insights={insights.state}
        onOpenMetric={(s) => setTarget({ page: 'Overview', label: s.definition.label, query: s.item.evidence_query, item: s.item, definition: s.definition })}
        onOpenEvidence={openEvidence}
      />
      <TrendSection ctx={ctx} trends={trends.state} labels={trendLabels} onRetry={trends.reload} />
      <CompetitorSection ctx={ctx} fullHref={`${brandPath(brand.id, 'competition')}${search}`} />
      <Opportunities state={insights.state} onRetry={insights.reload} onOpenEvidence={openEvidence} />
      <LatestInsight state={insights.state} agencyView={agency} allHref={`${brandPath(brand.id, 'insights')}${search}`} onRetry={insights.reload} onOpenEvidence={openEvidence} />
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={user.role === 'agency_admin'} />
    </div>
  )
}
