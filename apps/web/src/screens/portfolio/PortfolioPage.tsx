import { Link, useSearchParams } from 'react-router-dom'
import type { Brand, MetricItem, QueryContext } from '../../contracts'
import { FilterBar } from '../../components/FilterBar'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { useDefinitions } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { csvFileName } from '../../lib/csv'
import { metricView } from '../../lib/metricView'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { ProviderProblem } from '../../routing/pages'
import { useQueryContext } from '../../routing/useQueryContext'
import { KPI_SLOTS } from '../overview/slots'

/** Indicatorii din portofoliu: aceiași ca pe cardurile din Overview, ca cifra de aici să fie cea de acolo. */
const KEYS: readonly string[] = KPI_SLOTS.map((s) => s.key)

interface Row {
  brand: Brand
  /** `null` când indicatorii brandului nu au putut fi citiți; rândul rămâne, cu motivul. */
  items: MetricItem[] | null
  error: string | null
}

/**
 * Portofoliu (Etapa 3, K-3): toate brandurile la care utilizatorul are acces, pe aceeași perioadă, cu indicatorii
 * din Overview. Fiecare brand e citit separat, cu drepturile utilizatorului (RLS); un brand căzut nu le ascunde pe celelalte.
 */
export function PortfolioPage() {
  const { brands } = useLayout()
  const providers = useProviders()
  const [params] = useSearchParams()
  // Perioada și comparația vin din URL, ca în modulele de brand; brandul din context e doar purtătorul lor.
  const { ctx, change, reset } = useQueryContext(brands[0]?.id ?? null, [])
  const { byKey } = useDefinitions(KEYS)
  const periodKey = ctx ? [ctx.period.preset, ctx.period.from, ctx.period.to, ctx.comparison].join('|') : ''

  const { state, reload } = useAsync<Row[]>(
    async () => {
      if (!ctx) return []
      return Promise.all(
        brands.map(async (brand): Promise<Row> => {
          try {
            const bundle = await providers.metrics.metrics({ ...ctx, brandId: brand.id, filters: {} } satisfies QueryContext, KEYS)
            return { brand, items: bundle.items, error: null }
          } catch (e) {
            return { brand, items: null, error: e instanceof Error ? e.message : 'Indicatorii nu au putut fi citiți.' }
          }
        }),
      )
    },
    [providers, brands.map((b) => b.id).join(','), periodKey],
  )

  if (!ctx) return null
  const search = sharedSearch(params)
  const item = (r: Row, key: string) => r.items?.find((i) => i.metric_key === key) ?? null

  const columns: Column<Row>[] = [
    {
      key: 'brand',
      header: 'Brand',
      cardTitle: true,
      sortValue: (r) => r.brand.name,
      render: (r) => (
        <div className="flex flex-col">
          <Link to={{ pathname: brandPath(r.brand.id, 'overview'), search }} className="font-semibold text-accent-text hover:underline">
            {r.brand.name}
          </Link>
          {r.error && <span role="alert" className="text-[12px] text-neg-text">{r.error}</span>}
        </div>
      ),
    },
    { key: 'client', header: 'Client', sortValue: (r) => r.brand.tenant_name, exportValue: (r) => r.brand.tenant_name, render: (r) => r.brand.tenant_name ?? <span className="text-text-3">Necunoscut</span> },
    ...KPI_SLOTS.map<Column<Row>>((slot) => ({
      key: slot.key,
      header: byKey.get(slot.key)?.label ?? slot.label,
      align: 'right',
      sortValue: (r) => item(r, slot.key)?.value ?? null,
      render: (r) => {
        const m = item(r, slot.key)
        const v = m ? metricView(m) : null
        if (!v?.hasValue) return <span className="text-text-3" title={v?.emptyReason ?? undefined}>{v?.emptyTitle ?? 'Fără date'}</span>
        return (
          <span className="inline-flex flex-col items-end">
            <span className="font-semibold">{v.valueText}</span>
            <span className="text-[12px] text-text-2">{v.deltaText ?? 'fără comparație'}</span>
          </span>
        )
      },
    })),
  ]

  return (
    <div className="flex flex-col gap-5">
      <FilterBar value={ctx} onChange={change} onReset={reset} filterDefs={[]} />
      {state.status === 'loading' ? (
        <div role="status" aria-label="Se încarcă portofoliul" className="h-64 rounded-xl bg-skeleton" />
      ) : state.status === 'failed' ? (
        <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={reload} />
      ) : (
        <SortableTable
          caption="Portofoliu: indicatorii brandurilor"
          columns={columns}
          rows={state.value}
          rowKey={(r) => r.brand.id}
          pageSize={25}
          emptyText="Nu ai acces la niciun spațiu de brand."
          exportFileName={csvFileName('portofoliu', ctx.period.from, ctx.period.to)}
        />
      )}
      <p className="text-[12.5px] leading-snug text-text-2">Indicatorii sunt cei de pe cardurile din Overview, pe perioada aleasă. Deschide un brand ca să vezi detaliile și dovezile din spatele fiecărei cifre.</p>
    </div>
  )
}
