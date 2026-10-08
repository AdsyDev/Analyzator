import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@phosphor-icons/react'
import type { ProviderResult, SearchKeyword } from '../../contracts'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import type { AsyncState } from '../../data/useAsync'
import { cn } from '../../lib/cn'
import { formatDate, formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

/** Rank absent = „Fără rank", niciodată 100 (spec 2.2). Un rank din Top 3 e accentuat și prin text, nu doar prin culoare. */
function Rank({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-3">Fără rank</span>
  return <span className={cn(value <= 3 && 'font-semibold text-accent-text')}>{value}</span>
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-3" title="Fără comparație">—</span>
  if (value === 0) return <span className="inline-flex items-center gap-1 text-text-2"><MinusIcon size={12} aria-hidden="true" />0</span>
  const up = value > 0
  return (
    <span className={cn('inline-flex items-center gap-1 font-semibold', up ? 'text-pos-text' : 'text-neg-text')}>
      {up ? <ArrowUpIcon size={12} weight="bold" aria-hidden="true" /> : <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />}
      {up ? '+' : '−'}
      {Math.abs(value)}
      <span className="sr-only">{up ? ' poziții câștigate' : ' poziții pierdute'}</span>
    </span>
  )
}

const columns: Column<SearchKeyword>[] = [
  {
    key: 'keyword',
    header: 'Keyword',
    sortValue: (k) => k.keyword,
    render: (k) => (
      <span className="flex flex-col">
        <span className="font-medium text-text">{k.keyword}</span>
        <span className="flex items-center gap-2 font-mono text-[11.5px] text-text-2">
          {k.url}
          {k.shared && <StatusChip tone="warn">URL partajat</StatusChip>}
        </span>
      </span>
    ),
  },
  {
    key: 'volume',
    header: 'Volum',
    align: 'right',
    sortValue: (k) => k.volume,
    render: (k) => (k.volume === null ? <span className="text-text-3">Fără date</span> : <span title={k.volume_as_of ? `Volum furnizor, la ${formatDate(k.volume_as_of)}` : undefined}>{formatInteger(k.volume)}</span>),
  },
  { key: 'rm', header: 'Rank mobil', align: 'right', sortValue: (k) => k.rank_mobile, render: (k) => <Rank value={k.rank_mobile} /> },
  { key: 'rd', header: 'Rank desktop', align: 'right', sortValue: (k) => k.rank_desktop, render: (k) => <Rank value={k.rank_desktop} /> },
  { key: 'change', header: 'Trend mobil', align: 'right', sortValue: (k) => k.change_mobile, render: (k) => <Change value={k.change_mobile} /> },
  {
    key: 'competitor',
    header: 'Competitor prezent',
    render: (k) =>
      k.competitor ? (
        <span>
          {k.competitor.name} <span className="font-mono text-[11.5px] text-text-2">{k.competitor.label}</span>
          <span className="text-text-2"> · poziția {k.competitor.position}</span>
        </span>
      ) : (
        <span className="text-text-2">Niciun competitor prezent</span>
      ),
  },
]

export function KeywordTable({ state, onRetry }: { state: AsyncState<ProviderResult<SearchKeyword[]>>; onRetry: () => void }) {
  return (
    <Section id="keywords" title="Keywords urmărite" description="Rank din SEOmonitor, la ultima observație din perioadă. Trend: poziții câștigate sau pierdute pe mobil. Keywords fără rank apar ultimele la sortare.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă keywords" skeletonClass="h-72">
        {(rows) => <SortableTable caption="Keywords urmărite" columns={columns} rows={rows} rowKey={(k) => k.id} pageSize={8} emptyText="Niciun keyword pentru filtrele alese." />}
      </Resolved>
    </Section>
  )
}
