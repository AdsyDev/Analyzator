import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Brand, Device, QueryContext } from '../../contracts'
import { DEVICES } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics, useTrends } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { DEVICE_FILTER } from '../../routing/modules'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { KpiGrid } from '../shared/KpiGrid'
import { AiReferralsSection } from './AiReferralsSection'
import { ChannelsSection } from './ChannelsSection'
import { TRAFFIC_KPI_KEYS, TRAFFIC_KPI_SLOTS } from './slots'
import { TrackingSection } from './TrackingSection'

export function deviceFrom(ctx: QueryContext): Device | null {
  const d = ctx.filters.device
  return (DEVICES as readonly string[]).includes(d ?? '') ? (d as Device) : null
}

/**
 * Trafic și conversii (spec cap. 16): KPI GA4 din registru, canale (filtrabile pe device), AI referrals și tracking
 * quality. Comportamentul Clarity are meniul lui, User experience (E-1). Fiecare secțiune are stările ei.
 */
export function TrafficPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <TrafficContent brand={brand} ctx={ctx} canManageSources={user.role === 'agency_admin'} />
}

function TrafficContent({ brand, ctx, canManageSources }: { brand: Brand; ctx: QueryContext; canManageSources: boolean }) {
  const providers = useProviders()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const device = deviceFrom(ctx)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, TRAFFIC_KPI_KEYS)
  const { byKey } = useDefinitions(TRAFFIC_KPI_KEYS)
  const sparks = useTrends(ctx, TRAFFIC_KPI_KEYS)
  const channels = useAsync(() => providers.traffic.channels(ctx, device), [providers, key])
  const referrals = useAsync(() => providers.traffic.aiReferrals(ctx), [providers, key])
  const tracking = useAsync(() => providers.traffic.trackingQuality(ctx), [providers, key])
  const deviceLabel = device ? (DEVICE_FILTER.options.find((o) => o.value === device)?.label ?? device) : null

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid slots={TRAFFIC_KPI_SLOTS} page="Trafic și conversii" metrics={metrics.state} definitions={byKey} trends={sparks.state} onRetry={metrics.reload} onOpen={setTarget} />
      <ChannelsSection state={channels.state} onRetry={channels.reload} deviceLabel={deviceLabel} />
      <AiReferralsSection state={referrals.state} onRetry={referrals.reload} />
      <TrackingSection state={tracking.state} onRetry={tracking.reload} />
      <p className="text-[12.5px] text-text-2">
        Comportamentul vizitatorilor pe site (rage clicks, dead clicks, quick backs, scroll), din Microsoft Clarity, e în{' '}
        <Link to={{ pathname: brandPath(brand.id, 'ux'), search: sharedSearch(params) }} className="font-medium text-accent-text underline-offset-2 hover:underline">
          User experience
        </Link>
        .
      </p>
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={canManageSources} />
    </div>
  )
}
