import { useState } from 'react'
import type { Brand, Device, QueryContext } from '../../contracts'
import { DEVICES } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics, useTrends } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { DEVICE_FILTER } from '../../routing/modules'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { KpiGrid } from '../shared/KpiGrid'
import { AiReferralsSection } from './AiReferralsSection'
import { BehaviorSection } from './BehaviorSection'
import { ChannelsSection } from './ChannelsSection'
import { CLARITY_KEYS, TRAFFIC_KPI_KEYS, TRAFFIC_KPI_SLOTS } from './slots'
import { TrackingSection } from './TrackingSection'

export function deviceFrom(ctx: QueryContext): Device | null {
  const d = ctx.filters.device
  return (DEVICES as readonly string[]).includes(d ?? '') ? (d as Device) : null
}

const ALL_KEYS = [...new Set([...TRAFFIC_KPI_KEYS, ...CLARITY_KEYS])]

/**
 * Trafic și conversii (spec cap. 16): KPI GA4 din registru, canale (filtrabile pe device), AI referrals,
 * comportament Clarity (cu defalcare pe device) și tracking quality. Fiecare secțiune are stările ei.
 */
export function TrafficPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <TrafficContent brand={brand} ctx={ctx} canManageSources={user.role === 'agency_admin'} />
}

function TrafficContent({ brand, ctx, canManageSources }: { brand: Brand; ctx: QueryContext; canManageSources: boolean }) {
  const providers = useProviders()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const device = deviceFrom(ctx)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, ALL_KEYS)
  const { byKey } = useDefinitions(ALL_KEYS)
  const sparks = useTrends(ctx, TRAFFIC_KPI_KEYS)
  const channels = useAsync(() => providers.traffic.channels(ctx, device), [providers, key])
  const referrals = useAsync(() => providers.traffic.aiReferrals(ctx), [providers, key])
  const clarity = useAsync(() => providers.traffic.clarityDevices(ctx), [providers, key])
  const tracking = useAsync(() => providers.traffic.trackingQuality(ctx), [providers, key])
  const sources = useAsync(() => providers.sources.statuses(brand.id), [providers, brand.id])

  const items = metrics.state.status === 'done' ? metrics.state.value.items : []
  const kpiState = metrics.state
  const clarityStatus = sources.state.status === 'done' && sources.state.value.kind === 'ready' ? (sources.state.value.data.find((s) => s.provider === 'clarity') ?? null) : null
  const deviceLabel = device ? (DEVICE_FILTER.options.find((o) => o.value === device)?.label ?? device) : null

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid slots={TRAFFIC_KPI_SLOTS} page="Trafic și conversii" metrics={kpiState} definitions={byKey} trends={sparks.state} onRetry={metrics.reload} onOpen={setTarget} />
      <ChannelsSection state={channels.state} onRetry={channels.reload} deviceLabel={deviceLabel} />
      <AiReferralsSection state={referrals.state} onRetry={referrals.reload} />
      <BehaviorSection devices={clarity.state} items={items} definitions={byKey} source={clarityStatus} canManageSources={canManageSources} onRetry={clarity.reload} />
      <TrackingSection state={tracking.state} onRetry={tracking.reload} />
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={canManageSources} />
    </div>
  )
}
