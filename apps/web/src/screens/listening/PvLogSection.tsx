import type { PvLogEntry } from '../../contracts'
import type { ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { StatusChip } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDateTime } from '../../lib/format'
import { safeUrl } from '../../lib/safeUrl'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { PV_STATUS_LABELS } from './labels'

const columns: Column<PvLogEntry>[] = [
  { key: 'at', header: 'Marcat la', sortValue: (e) => e.flagged_at, render: (e) => <span className="font-mono text-[12px]">{formatDateTime(e.flagged_at)}</span> },
  {
    key: 'item',
    header: 'Item',
    sortValue: (e) => e.excerpt,
    render: (e) => {
      const href = safeUrl(e.link)
      return (
        <span className="flex max-w-[48ch] flex-col gap-0.5">
          <span className="text-[12px] font-semibold text-text-2">{e.item.kind === 'mention' ? 'Mențiune' : 'Răspuns AI'}</span>
          <span className="text-[13px] leading-snug">{e.excerpt}</span>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[12px] text-accent-text hover:underline">
              Deschide sursa
            </a>
          )}
        </span>
      )
    },
  },
  { key: 'user', header: 'Utilizator', sortValue: (e) => e.user, render: (e) => e.user },
  {
    key: 'notified',
    header: 'Notificat',
    sortValue: (e) => (e.notified ? 1 : 0),
    render: (e) => (e.notified ? <span className="text-[12.5px]">{e.notified_to.join(', ')}</span> : <span className="text-text-3">Nu încă</span>),
  },
  {
    key: 'status',
    header: 'Status',
    sortValue: (e) => e.status,
    render: (e) => <StatusChip tone={PV_STATUS_LABELS[e.status].tone}>{PV_STATUS_LABELS[e.status].label}</StatusChip>,
  },
]

/** Jurnalul de farmacovigilență. Doar `agency_admin` (brief cap. 6, spec cap. 28); nu se cere pentru alte roluri. */
export function PvLogSection({ state, onRetry }: { state: AsyncState<ProviderResult<PvLogEntry[]>>; onRetry: () => void }) {
  return (
    <Section id="pv-log" title="Jurnal de farmacovigilență" description="Vizibil doar administratorilor agenției. Marcajul rămâne în jurnal și nu poate fi șters, doar adnotat.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă jurnalul" skeletonClass="h-36">
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState compact title="Niciun marcaj" text="Nicio mențiune sau răspuns AI nu a fost marcat pentru acest brand." />
          ) : (
            <SortableTable caption="Jurnal de farmacovigilență" columns={columns} rows={rows} rowKey={(e) => e.id} pageSize={8} emptyText="Niciun marcaj." />
          )
        }
      </Resolved>
    </Section>
  )
}
