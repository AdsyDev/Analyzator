import type { LandingPage, ProviderResult } from '../../contracts'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const num = (v: number | null) => (v === null ? <span className="text-text-3">Fără date</span> : formatInteger(v))

const columns: Column<LandingPage>[] = [
  {
    key: 'url',
    header: 'Pagină',
    sortValue: (p) => p.url,
    render: (p) => (
      <span className="flex items-center gap-2 font-mono text-[12.5px]">
        {p.url}
        {p.shared && <StatusChip tone="warn">URL partajat</StatusChip>}
      </span>
    ),
  },
  { key: 'clicks', header: 'Clicks', align: 'right', sortValue: (p) => p.clicks, render: (p) => num(p.clicks) },
  { key: 'impressions', header: 'Impressions', align: 'right', sortValue: (p) => p.impressions, render: (p) => num(p.impressions) },
  { key: 'ctr', header: 'CTR', align: 'right', sortValue: (p) => p.ctr, render: (p) => formatMetricValue(p.ctr, 'percent') ?? <span className="text-text-3">Fără date</span> },
  { key: 'position', header: 'Poz.', align: 'right', sortValue: (p) => p.position, render: (p) => formatMetricValue(p.position, 'position') ?? <span className="text-text-3">Fără date</span> },
  {
    key: 'key_events',
    header: 'Key events',
    align: 'right',
    sortValue: (p) => p.key_events,
    render: (p) => (p.key_events === null ? <span className="text-text-3" title="Maparea GA4 nu e validată pentru această pagină">Nemapat</span> : formatInteger(p.key_events)),
  },
]

export function LandingPages({ state, onRetry }: { state: AsyncState<ProviderResult<LandingPage[]>>; onRetry: () => void }) {
  return (
    <Section id="landing" title="Landing pages din search" description="Rezultatele din Search Console pe pagină. Key events GA4 apar doar când maparea paginii e validată; altfel „Nemapat”, nu zero.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă paginile" skeletonClass="h-48">
        {(rows) => <SortableTable caption="Landing pages din search" columns={columns} rows={rows} rowKey={(p) => p.url} pageSize={8} emptyText="Nicio pagină cu date în perioada aleasă." />}
      </Resolved>
    </Section>
  )
}
