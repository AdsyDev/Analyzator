import type { Brand, QueryContext, SocialFilters, SocialFormat, SocialPlatform } from '../../contracts'
import { SOCIAL_FORMATS, SOCIAL_PLATFORMS } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { formatDate, formatDateTime } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { BRAND_MODULES } from '../../routing/modules'
import { ProviderProblem } from '../../routing/pages'
import { ImportGate } from '../shared/ImportGate'
import { CalendarSection } from './CalendarSection'
import { CompetitorsSection } from './CompetitorsSection'
import { GroupsSection } from './GroupsSection'
import { PostsSection } from './PostsSection'
import { SocialKpis } from './SocialKpis'

export function socialFiltersFrom(ctx: QueryContext): SocialFilters {
  const p = ctx.filters.platform
  const f = ctx.filters.format
  return {
    platform: (SOCIAL_PLATFORMS as readonly string[]).includes(p ?? '') ? (p as SocialPlatform) : null,
    format: (SOCIAL_FORMATS as readonly string[]).includes(f ?? '') ? (f as SocialFormat) : null,
  }
}

/**
 * Social propriu (spec cap. 17). Poarta paginii e `social.summary`: fără import, „Sursă neconectată" cu
 * „Importă CSV"; cu import, KPI, performanța conținutului, topic și format, calendar și concurența publică.
 */
export function SocialPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <SocialContent brand={brand} ctx={ctx} canImport={user.role === 'agency_admin'} />
}

function SocialContent({ brand, ctx, canImport }: { brand: Brand; ctx: QueryContext; canImport: boolean }) {
  const providers = useProviders()
  const f = socialFiltersFrom(ctx)
  const key = ctxKey(ctx)
  const summary = useAsync(() => providers.social.summary(ctx, f), [providers, key])
  const posts = useAsync(() => providers.social.posts(ctx, f), [providers, key])
  const groups = useAsync(() => providers.social.groups(ctx, f), [providers, key])
  const calendar = useAsync(() => providers.social.calendar(ctx, f), [providers, key])
  const competitors = useAsync(() => providers.social.competitors(ctx), [providers, brand.id])

  if (summary.state.status === 'loading') return <div role="status" aria-label="Se încarcă Social" className="h-64 rounded-xl bg-skeleton" />
  if (summary.state.status === 'failed') return <ProviderProblem result={{ kind: 'error', message: summary.state.message }} onRetry={summary.reload} />
  const result = summary.state.value
  if (result.kind === 'not_connected') return <ImportGate text={BRAND_MODULES.social?.disconnected?.(brand.name) ?? result.reason} canImport={canImport} />
  if (result.kind === 'error') return <ProviderProblem result={result} onRetry={summary.reload} />
  const s = result.data

  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px] text-text-2 shadow-1">
        <span>Date până la <span className="font-mono text-[12px] text-text">{formatDate(s.data_as_of)}</span></span>
        <span>Importat la <span className="font-mono text-[12px] text-text">{formatDateTime(s.imported_at)}</span></span>
        <span>Sursă <strong className="font-semibold text-text">Planable</strong></span>
      </p>
      <SocialKpis kpis={s.kpis} ctx={ctx} />
      <PostsSection state={posts.state} onRetry={posts.reload} />
      <GroupsSection state={groups.state} onRetry={groups.reload} />
      <CalendarSection state={calendar.state} onRetry={calendar.reload} />
      <CompetitorsSection state={competitors.state} onRetry={competitors.reload} />
    </div>
  )
}
