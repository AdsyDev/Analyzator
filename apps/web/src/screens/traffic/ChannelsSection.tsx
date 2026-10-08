import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from '@phosphor-icons/react'
import type { ProviderResult, TrafficChannel, TrafficChannels } from '../../contracts'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import type { AsyncState } from '../../data/useAsync'
import { cn } from '../../lib/cn'
import { changeDirection, formatInteger, formatMetricValue, formatRelativeChange } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const num = (v: number | null) => (v === null ? <span className="text-text-3">Fără date</span> : formatInteger(v))

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-3" title="Fără comparație">—</span>
  if (changeDirection(value) === 'flat') return <span className="inline-flex items-center gap-1 text-text-2"><MinusIcon size={12} aria-hidden="true" />0 %</span>
  const up = value > 0
  return (
    <span className={cn('inline-flex items-center gap-1 font-semibold', up ? 'text-pos-text' : 'text-neg-text')}>
      {up ? <ArrowUpIcon size={12} weight="bold" aria-hidden="true" /> : <ArrowDownIcon size={12} weight="bold" aria-hidden="true" />}
      {formatRelativeChange(value)}
      <span className="sr-only">{up ? ' creștere' : ' scădere'}</span>
    </span>
  )
}

const columns: Column<TrafficChannel>[] = [
  { key: 'channel', header: 'Canal', sortValue: (c) => c.channel, render: (c) => <span className="font-medium">{c.channel}</span> },
  { key: 'sessions', header: 'Sesiuni', align: 'right', sortValue: (c) => c.sessions, render: (c) => num(c.sessions) },
  { key: 'share', header: 'Pondere', align: 'right', sortValue: (c) => c.share_pct, render: (c) => formatMetricValue(c.share_pct, 'percent') ?? <span className="text-text-3">Fără date</span> },
  { key: 'change', header: 'Variație', align: 'right', sortValue: (c) => c.change_pct, render: (c) => <Change value={c.change_pct} /> },
  { key: 'engagement', header: 'Engagement', align: 'right', sortValue: (c) => c.engagement_rate, render: (c) => formatMetricValue(c.engagement_rate, 'percent') ?? <span className="text-text-3">Fără date</span> },
  { key: 'key_events', header: 'Key events', align: 'right', sortValue: (c) => c.key_events, render: (c) => num(c.key_events) },
]

interface Props {
  state: AsyncState<ProviderResult<TrafficChannels>>
  onRetry: () => void
  deviceLabel: string | null
}

export function ChannelsSection({ state, onRetry, deviceLabel }: Props) {
  return (
    <Section
      id="channels"
      title="Canale"
      description={deviceLabel ? `Filtrat pe device: ${deviceLabel}. Indicatorii de sus rămân pe toate device-urile.` : 'Sesiunile pe grupurile de canale GA4, cu pondere și variație față de comparație.'}
    >
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă canalele" skeletonClass="h-64">
        {(d) => <SortableTable caption="Canale" columns={columns} rows={d.channels} rowKey={(c) => c.channel} pageSize={10} emptyText="Niciun canal cu date în perioada aleasă." />}
      </Resolved>
    </Section>
  )
}
