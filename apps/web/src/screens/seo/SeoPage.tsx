import { useState } from 'react'
import type { Brand, QueryContext, SearchFilters } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics, useTrends } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { KpiGrid } from '../shared/KpiGrid'
import { ContentGaps } from './ContentGaps'
import { KeywordTable } from './KeywordTable'
import { LandingPages } from './LandingPages'
import { SEO_KPI_KEYS, SEO_KPI_SLOTS } from './slots'

export function seoFiltersFrom(ctx: QueryContext): SearchFilters {
  const t = ctx.filters.kw
  return { keywordType: t === 'brand' || t === 'nonbrand' ? t : null }
}

/**
 * SEO și Search (spec cap. 14). KPI-urile vin din registru (toate cheile există); listele (keywords, landing
 * pages, content gaps) vin din provider, cu stările lor proprii.
 */
export function SeoPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <SeoContent brand={brand} ctx={ctx} canManageSources={user.role === 'agency_admin'} />
}

function SeoContent({ brand, ctx, canManageSources }: { brand: Brand; ctx: QueryContext; canManageSources: boolean }) {
  const providers = useProviders()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const f = seoFiltersFrom(ctx)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, SEO_KPI_KEYS)
  const { byKey } = useDefinitions(SEO_KPI_KEYS)
  const sparks = useTrends(ctx, SEO_KPI_KEYS)
  const keywords = useAsync(() => providers.search.keywords(ctx, f), [providers, key])
  const pages = useAsync(() => providers.search.landingPages(ctx), [providers, key])
  const gaps = useAsync(() => providers.search.contentGaps(ctx), [providers, key])

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid slots={SEO_KPI_SLOTS} page="SEO și Search" metrics={metrics.state} definitions={byKey} trends={sparks.state} onRetry={metrics.reload} onOpen={setTarget} />
      <KeywordTable state={keywords.state} onRetry={keywords.reload} />
      <LandingPages state={pages.state} onRetry={pages.reload} />
      <ContentGaps brandName={brand.name} state={gaps.state} onRetry={gaps.reload} />
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={canManageSources} />
    </div>
  )
}
