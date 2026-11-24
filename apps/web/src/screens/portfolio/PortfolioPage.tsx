import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Brand, MetricItem, QueryContext } from '../../contracts'
import { FilterBar } from '../../components/FilterBar'
import { BrandMark } from '../../components/ui/BrandMark'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { useDefinitions } from '../../data/hooks'
import { csvFileName } from '../../lib/csv'
import { metricView } from '../../lib/metricView'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { useQueryContext } from '../../routing/useQueryContext'
import { KPI_SLOTS } from '../overview/slots'

/** Indicatorii din portofoliu: aceiași ca pe cardurile din Overview, ca cifra de aici să fie cea de acolo. */
const KEYS: readonly string[] = KPI_SLOTS.map((s) => s.key)

interface Row {
  brand: Brand
  /** `undefined` cât se încarcă; `null` când indicatorii brandului nu au putut fi citiți (rândul rămâne, cu motivul). */
  items: MetricItem[] | null | undefined
  error: string | null
}

type Loaded = { items: MetricItem[] | null; error: string | null }

/**
 * Portofoliu (Etapa 3, K-3): toate brandurile la care utilizatorul are acces, pe aceeași perioadă, cu indicatorii
 * din Overview. Fiecare brand e citit separat, cu drepturile utilizatorului (RLS); un brand căzut nu le ascunde pe celelalte.
 * Tabelul apare imediat, cu brandurile; cifrele fiecărui brand se completează când sosesc, fără să aștepte brandul cel mai lent.
 */
export function PortfolioPage() {
  const { brands } = useLayout()
  const providers = useProviders()
  const [params] = useSearchParams()
  // Perioada și comparația vin din URL, ca în modulele de brand; brandul din context e doar purtătorul lor.
  const { ctx, change, reset } = useQueryContext(brands[0]?.id ?? null, [])
  const { byKey } = useDefinitions(KEYS)
  const periodKey = ctx ? [ctx.period.preset, ctx.period.from, ctx.period.to, ctx.comparison].join('|') : ''
  const brandKey = brands.map((b) => b.id).join(',')
  const requestKey = `${brandKey}#${periodKey}`

  // Rezultatele sunt legate de cererea care le-a produs: la schimbarea perioadei, cifrele vechi nu apar nici un cadru.
  const [loaded, setLoaded] = useState<{ key: string; byBrand: Record<string, Loaded> }>({ key: '', byBrand: {} })
  useEffect(() => {
    if (!ctx) return
    let alive = true
    const put = (id: string, v: Loaded) => {
      if (alive) setLoaded((prev) => ({ key: requestKey, byBrand: { ...(prev.key === requestKey ? prev.byBrand : {}), [id]: v } }))
    }
    for (const brand of brands) {
      providers.metrics.metrics({ ...ctx, brandId: brand.id, filters: {} } satisfies QueryContext, KEYS).then(
        (bundle) => put(brand.id, { items: bundle.items, error: null }),
        (e: unknown) => put(brand.id, { items: null, error: e instanceof Error ? e.message : 'Indicatorii nu au putut fi citiți.' }),
      )
    }
    return () => {
      alive = false
    }
  }, [providers, requestKey])

  if (!ctx) return null
  const byBrand = loaded.key === requestKey ? loaded.byBrand : {}
  const rows: Row[] = brands.map((brand) => ({ brand, items: byBrand[brand.id]?.items, error: byBrand[brand.id]?.error ?? null }))
  const busy = rows.some((r) => r.items === undefined)
  const search = sharedSearch(params)
  const item = (r: Row, key: string) => r.items?.find((i) => i.metric_key === key) ?? null

  const columns: Column<Row>[] = [
    {
      key: 'brand',
      header: 'Brand',
      cardTitle: true,
      sortValue: (r) => r.brand.name,
      render: (r) => (
        <div className="flex items-center gap-3">
          <BrandMark name={r.brand.name} domain={r.brand.domain} decorative />
          <div className="flex min-w-0 flex-col">
            <Link to={{ pathname: brandPath(r.brand.id, 'overview'), search }} className="font-semibold text-accent-text hover:underline">
              {r.brand.name}
            </Link>
            {r.error && <span role="alert" className="text-[12px] text-neg-text">{r.error}</span>}
          </div>
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
        if (r.items === undefined) return <span aria-hidden="true" className="inline-block h-4 w-14 animate-pulse rounded bg-skeleton align-middle" />
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
      <div aria-busy={busy || undefined}>
        <SortableTable
          caption="Portofoliu: indicatorii brandurilor"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.brand.id}
          pageSize={25}
          emptyText="Nu ai acces la niciun spațiu de brand."
          exportFileName={csvFileName('portofoliu', ctx.period.from, ctx.period.to)}
        />
      </div>
      {busy && <span role="status" className="sr-only">Se încarcă indicatorii brandurilor</span>}
      <p className="text-[12.5px] leading-snug text-text-2">Indicatorii sunt cei de pe cardurile din Overview, pe perioada aleasă. Deschide un brand ca să vezi detaliile și dovezile din spatele fiecărei cifre.</p>
    </div>
  )
}
