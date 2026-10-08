import type { Brand, PaidFilters, PaidPlatform, QueryContext } from '../../contracts'
import { PAID_PLATFORMS } from '../../contracts'
import { TrendChart } from '../../components/TrendChart'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { formatDate, formatDateTime, formatDayMonth } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { BRAND_MODULES } from '../../routing/modules'
import { ProviderProblem } from '../../routing/pages'
import { ImportGate } from '../shared/ImportGate'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { BudgetSection } from './BudgetSection'
import { PaidKpis } from './PaidKpis'
import { PaidTable } from './PaidTable'

export function paidFiltersFrom(ctx: QueryContext): PaidFilters {
  const p = ctx.filters.platform
  return { platform: (PAID_PLATFORMS as readonly string[]).includes(p ?? '') ? (p as PaidPlatform) : null }
}

/**
 * Paid Media (spec cap. 15). Poarta paginii e `paid.summary`: fără import, „Sursă neconectată" cu acțiunea
 * „Importă CSV"; cu import, KPI, buget și pacing, evoluție și tabelul pe zi/platformă/cont/campanie.
 */
export function PaidPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <PaidContent brand={brand} ctx={ctx} canImport={user.role === 'agency_admin'} />
}

function PaidContent({ brand, ctx, canImport }: { brand: Brand; ctx: QueryContext; canImport: boolean }) {
  const providers = useProviders()
  const f = paidFiltersFrom(ctx)
  const key = ctxKey(ctx)
  const summary = useAsync(() => providers.paid.summary(ctx, f), [providers, key])
  const budget = useAsync(() => providers.paid.budget(ctx), [providers, brand.id])
  const series = useAsync(() => providers.paid.series(ctx, f), [providers, key])
  const rows = useAsync(() => providers.paid.rows(ctx, f), [providers, key])

  if (summary.state.status === 'loading') return <div role="status" aria-label="Se încarcă Paid Media" className="h-64 rounded-xl bg-skeleton" />
  if (summary.state.status === 'failed') return <ProviderProblem result={{ kind: 'error', message: summary.state.message }} onRetry={summary.reload} />
  const result = summary.state.value
  if (result.kind === 'not_connected') return <ImportGate text={BRAND_MODULES.paid?.disconnected?.(brand.name) ?? result.reason} canImport={canImport} />
  if (result.kind === 'error') return <ProviderProblem result={result} onRetry={summary.reload} />
  const s = result.data

  return (
    <div className="flex flex-col gap-5">
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px] text-text-2 shadow-1">
        <span>Date până la <span className="font-mono text-[12px] text-text">{formatDate(s.data_as_of)}</span></span>
        <span>Importat la <span className="font-mono text-[12px] text-text">{formatDateTime(s.imported_at)}</span></span>
        <span>Monedă <strong className="font-semibold text-text">{s.currency}</strong></span>
        <span>Fus orar al exportului <strong className="font-semibold text-text">{s.source_timezone}</strong></span>
      </p>
      <PaidKpis kpis={s.kpis} ctx={ctx} />
      <BudgetSection state={budget.state} onRetry={budget.reload} />
      <Section id="evolution" title="Evoluție" description={`Spend (${s.currency}) și rezultate, în grafice separate. Zilele neimportate apar ca gol, nu ca zero.`}>
        <Resolved state={series.state} onRetry={series.reload} loadingLabel="Se încarcă evoluția" skeletonClass="h-60">
          {(d) => {
            const labels = d.spend.map((p) => formatDayMonth(p.date))
            return (
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                <TrendChart title={`Spend (${d.currency})`} labels={labels} series={[{ key: 'spend', name: `Spend (${d.currency})`, color: 'var(--accent)', values: d.spend.map((p) => p.value) }]} format="int" height={200} />
                <TrendChart title={d.results_label} labels={labels} series={[{ key: 'results', name: d.results_label, color: 'var(--lav)', values: d.results.map((p) => p.value) }]} format="int" height={200} />
              </div>
            )
          }}
        </Resolved>
      </Section>
      <PaidTable state={rows.state} currency={s.currency} onRetry={rows.reload} />
    </div>
  )
}
