import { useState } from 'react'
import type { Brand, SourceProviderId, SourceStatusInfo, SyncRun } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { SourceStatus, type SourceAction } from '../../components/SourceStatus'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate, formatDateTime } from '../../lib/format'
import { ADMIN_SOURCE_GRID, PROVIDER_DESCRIPTIONS, sourceName } from '../../lib/sources'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { AddConnection, CONNECTABLE } from './AddConnection'
import { ConnectionCard } from './ConnectionCard'
import { SYNC_LABELS } from './labels'

const duration = (r: SyncRun): string => {
  if (!r.finished_at) return '—'
  const s = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

const runColumns: Column<SyncRun>[] = [
  { key: 'source', header: 'Sursă', sortValue: (r) => sourceName(r.provider), render: (r) => sourceName(r.provider) },
  { key: 'started', header: 'Început', sortValue: (r) => r.started_at, render: (r) => <span className="font-mono text-[12px]">{formatDateTime(r.started_at)}</span> },
  { key: 'range', header: 'Perioadă', sortValue: (r) => r.range_from, render: (r) => <span className="font-mono text-[12px]">{formatDate(r.range_from)}{r.range_to !== r.range_from ? ` – ${formatDate(r.range_to)}` : ''}</span> },
  { key: 'duration', header: 'Durată', render: (r) => <span className="font-mono text-[12px]">{duration(r)}</span> },
  { key: 'rows', header: 'Rânduri', align: 'right', sortValue: (r) => r.rows, render: (r) => (r.rows === null ? '—' : r.rows.toLocaleString('ro-RO')) },
  {
    key: 'status',
    header: 'Status',
    sortValue: (r) => r.status,
    render: (r) => (
      <span className="flex flex-col gap-0.5">
        <StatusChip tone={SYNC_LABELS[r.status].tone}>{SYNC_LABELS[r.status].label}</StatusChip>
        {r.error && <span className="text-[12px] text-neg-text">{r.error}</span>}
      </span>
    ),
  },
]

/** Completează grila cu sursele pe care providerul nu le-a raportat: lipsa unui rând înseamnă „neconectat", nu „necunoscut". */
function gridFrom(list: SourceStatusInfo[]): SourceStatusInfo[] {
  return ADMIN_SOURCE_GRID.map(
    (p) => list.find((s) => s.provider === p) ?? { provider: p, state: 'not_connected', description: PROVIDER_DESCRIPTIONS[p], data_as_of: null, imported_at: null, note: 'Nicio conexiune configurată pentru acest spațiu.' },
  )
}

/** Administrare → Surse (doar `agency_admin`): starea surselor, conexiuni cu token, istoricul sincronizărilor. */
export function SourcesPage() {
  const { activeBrand } = useLayout()
  if (!activeBrand) {
    return <EmptyState title="Niciun spațiu de brand" text="Nu există niciun spațiu de brand la care să ai acces; nu avem ce conexiuni să afișăm." />
  }
  return <SourcesContent key={activeBrand.id} brand={activeBrand} />
}

function SourcesContent({ brand }: { brand: Brand }) {
  const providers = useProviders()
  const toast = useToast()
  const [adding, setAdding] = useState<SourceProviderId | null>(null)
  const statuses = useAsync(() => providers.sources.statuses(brand.id), [providers, brand.id])
  const connections = useAsync(() => providers.sources.connections(brand.id), [providers, brand.id])
  const runs = useAsync(() => providers.sources.syncRuns(brand.id), [providers, brand.id])

  function refresh() {
    statuses.reload()
    connections.reload()
    runs.reload()
  }

  function onAction(action: SourceAction, provider: SourceProviderId) {
    if (action === 'retry') return refresh()
    if (provider === 'csv_import') return toast('Importul de fișiere CSV nu este încă disponibil în această versiune.')
    if (CONNECTABLE.includes(provider)) setAdding(provider)
  }

  return (
    <div className="flex flex-col gap-5">
      <Section id="status" title="Starea surselor" description={`Pentru ${brand.name}. Starea vine din conexiuni și din sincronizările înregistrate; nu estimăm date lipsă.`}>
        <Resolved state={statuses.state} onRetry={statuses.reload} loadingLabel="Se încarcă starea surselor" skeletonClass="h-48">
          {(list) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {gridFrom(list).map((s) => (
                <SourceStatus key={s.provider} info={s} canManage onAction={onAction} />
              ))}
            </div>
          )}
        </Resolved>
      </Section>

      <Section id="connections" title="Conexiuni și credențiale" description="Un token per conexiune. Se salvează în seiful serverului și nu mai poate fi citit din aplicație.">
        <div className="flex flex-col gap-3">
          <Resolved state={connections.state} onRetry={connections.reload} loadingLabel="Se încarcă conexiunile" skeletonClass="h-40">
            {(list) =>
              list.length === 0 ? (
                <EmptyState compact title="Nicio conexiune" text={`${brand.name} nu are nicio conexiune configurată. Adaugă una mai jos.`} />
              ) : (
                <div className="flex flex-col gap-3">
                  {list.map((c) => (
                    <ConnectionCard key={c.id} connection={c} onChanged={refresh} />
                  ))}
                </div>
              )
            }
          </Resolved>
          <AddConnection key={adding ?? 'none'} brandId={brand.id} initialProvider={adding ?? undefined} onCreated={() => { setAdding(null); refresh() }} />
        </div>
      </Section>

      <Section id="sync-runs" title="Istoricul sincronizărilor" description="Ultimele rulări ale conectorilor pentru acest spațiu.">
        <Resolved state={runs.state} onRetry={runs.reload} loadingLabel="Se încarcă istoricul" skeletonClass="h-40">
          {(list) => <SortableTable caption="Istoricul sincronizărilor" columns={runColumns} rows={list} rowKey={(r) => r.id} pageSize={8} emptyText="Nicio sincronizare înregistrată pentru acest spațiu." />}
        </Resolved>
      </Section>
    </div>
  )
}
