import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { isAgencyRole, type Brand, type QueryContext, type SessionUser } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { useDefinitions, useMetrics, useTrends, ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout, type LayoutContext } from '../../routing/AppLayout'
import { AssistantPanel } from './AssistantPanel'
import { AiTrendCard, CompetitorsCard, ListeningCard, PlatformsCard, SeoTrafficCard } from './BoardCards'
import { ContextBar } from './ContextBar'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { LatestInsight, Opportunities } from './InsightSections'
import { ChangesSection } from './ChangesSection'
import { OverviewKpis } from './OverviewKpis'
import { AI_TREND_KEY, KPI_KEYS, TREND_KEYS } from './slots'

const ALL_ENGINES = { engine: null, group: null } as const

/**
 * Overview, în compoziția din macheta propunerii („Imaginea completă a brandului”): șase indicatori, evoluția
 * vizibilității AI și vizibilitatea pe platforme, apoi SEO și trafic, Social listening și Competitori. AdSy AI e un
 * sidebar în dreapta, deschis din comutatorul „AI insights” de lângă titlu; nu e prezent permanent. Dedesubt rămân „Ce s-a schimbat”, prioritățile și interpretarea echipei. Toate datele vin prin provideri;
 * fiecare secțiune are stările ei de încărcare, eroare și „Sursă neconectată”, deci o sursă lentă nu blochează restul.
 * Nu există un scor general de brand și nicio valoare demonstrativă.
 */
export function OverviewPage() {
  const { brand, ctx, user, aiPanel } = useLayout()
  // Layout-ul garantează brandul permis și contextul din URL; fără ele nu se montează nimic și nu se cere nimic.
  if (!brand || !ctx) return null
  return <OverviewContent brand={brand} ctx={ctx} user={user} aiPanel={aiPanel} />
}

function OverviewContent({ brand, ctx, user, aiPanel }: { brand: Brand; ctx: QueryContext; user: SessionUser; aiPanel: LayoutContext['aiPanel'] }) {
  const providers = useProviders()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, KPI_KEYS)
  const { byKey } = useDefinitions(TREND_KEYS)
  const trends = useTrends(ctx, TREND_KEYS)
  const insights = useAsync(() => providers.insights.list(ctx), [providers, key])
  const sentiment = useAsync(() => providers.mentions.sentiment(ctx), [providers, key])
  const matrix = useAsync(() => providers.competition.matrix(ctx), [providers, key])
  const engines = useAsync(() => providers.ai.engines(ctx, ALL_ENGINES), [providers, key])

  const agency = isAgencyRole(user.role)
  const search = sharedSearch(params)
  const href = (segment: string) => `${brandPath(brand.id, segment)}${search}`
  const openEvidence = (query: EvidenceTarget['query'], label: string) => setTarget({ page: 'Overview', label, query })
  const items = metrics.state.status === 'done' ? metrics.state.value.items : null

  return (
    <>
      {/* Grilele urmează lățimea coloanei (@container), nu a ferestrei: sidebarul AdSy AI o îngustează când e deschis. */}
      <div className="@container flex min-w-0 flex-col gap-5">
        <OverviewKpis brand={brand} search={search} metrics={metrics.state} definitions={byKey} sentiment={sentiment.state} matrix={matrix.state} onRetry={metrics.reload} onOpen={setTarget} />
        <div className="grid grid-cols-1 gap-5 @5xl:grid-cols-3">
          <AiTrendCard ctx={ctx} trends={trends.state} label={byKey.get(AI_TREND_KEY)?.label ?? 'AI Share of Voice'} onRetry={trends.reload} href={href('ai')} />
          <PlatformsCard state={engines.state} onRetry={engines.reload} href={href('ai')} />
        </div>
        <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-3">
          <SeoTrafficCard metrics={metrics.state} definitions={byKey} trends={trends.state} onRetry={metrics.reload} onRetryTrends={trends.reload} href={href('seo')} />
          <ListeningCard sentiment={sentiment.state} mentions={items?.find((i) => i.metric_key === 'mentions_count') ?? null} onRetry={sentiment.reload} href={href('listening')} />
          <CompetitorsCard matrix={matrix.state} onRetry={matrix.reload} href={href('competition')} />
        </div>
        <ContextBar brand={brand} ctx={ctx} items={items} />
        <ChangesSection
          metrics={metrics.state}
          definitions={byKey}
          insights={insights.state}
          onOpenMetric={(s) => setTarget({ page: 'Overview', label: s.definition.label, query: s.item.evidence_query, item: s.item, definition: s.definition })}
          onOpenEvidence={openEvidence}
        />
        <Opportunities state={insights.state} onRetry={insights.reload} onOpenEvidence={openEvidence} />
        <LatestInsight state={insights.state} agencyView={agency} allHref={href('insights')} onRetry={insights.reload} onOpenEvidence={openEvidence} />
      </div>
      {/* Sidebarul AdSy AI se montează doar cât e deschis din „AI insights”; închis, nu cere nimic de la server. */}
      {aiPanel.open && aiPanel.container && createPortal(<AssistantPanel brand={brand} ctx={ctx} search={search} insights={insights.state} onOpen={setTarget} onClose={() => aiPanel.setOpen(false)} />, aiPanel.container)}
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={user.role === 'agency_admin'} />
    </>
  )
}
