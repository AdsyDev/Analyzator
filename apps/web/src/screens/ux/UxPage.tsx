import type { Brand, QueryContext } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { BehaviorSection } from './BehaviorSection'
import { CLARITY_KEYS } from './slots'

/**
 * User experience (E-1, varianta a): comportamentul vizitatorilor din Microsoft Clarity, mutat din Trafic. Aceleași
 * metrici din registru, aceeași defalcare pe device și aceleași stări (sursă neconectată, sincronizare cu probleme).
 */
export function UxPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <UxContent brand={brand} ctx={ctx} canManageSources={user.role === 'agency_admin'} />
}

function UxContent({ brand, ctx, canManageSources }: { brand: Brand; ctx: QueryContext; canManageSources: boolean }) {
  const providers = useProviders()
  const key = ctxKey(ctx)
  const metrics = useMetrics(ctx, CLARITY_KEYS)
  const { byKey } = useDefinitions(CLARITY_KEYS)
  const clarity = useAsync(() => providers.traffic.clarityDevices(ctx), [providers, key])
  const sources = useAsync(() => providers.sources.statuses(brand.id), [providers, brand.id])

  const items = metrics.state.status === 'done' ? metrics.state.value.items : []
  const clarityStatus = sources.state.status === 'done' && sources.state.value.kind === 'ready' ? (sources.state.value.data.find((s) => s.provider === 'clarity') ?? null) : null

  return (
    <div className="flex flex-col gap-5">
      <BehaviorSection devices={clarity.state} items={items} definitions={byKey} source={clarityStatus} canManageSources={canManageSources} onRetry={clarity.reload} />
    </div>
  )
}
