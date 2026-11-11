import { useId, useState, type FormEvent } from 'react'
import type { Brand, IndexState, IndexStatus, IndexedUrl } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { csvFileName } from '../../lib/csv'
import { formatDate, formatInteger } from '../../lib/format'
import { safeUrl } from '../../lib/safeUrl'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const STATE: Record<IndexState, { label: string; tone: ChipTone }> = {
  indexed: { label: 'În index', tone: 'pos' },
  not_indexed: { label: 'În afara indexului', tone: 'neg' },
  unknown: { label: 'Necunoscut', tone: 'neutral' },
}
const missing = <span className="text-text-3">Fără date</span>

/**
 * Indexare (Etapa 3, L): starea în Google a URL-urilor prioritare ale brandului și a paginilor cu cele mai multe
 * clickuri, după ultima inspecție Search Console. Numerele sunt din lista inspectată, nu din tot site-ul; clasificarea
 * („în index”, „în afara indexului”) vine de pe server.
 */
export function IndexingPage() {
  const { brand, user } = useLayout()
  if (!brand) return null
  return <Indexing brand={brand} canEdit={user.role !== 'client_viewer'} />
}

function Indexing({ brand, canEdit }: { brand: Brand; canEdit: boolean }) {
  const providers = useProviders()
  const status = useAsync(() => providers.search.indexStatus(brand.id), [providers, brand.id])
  return (
    <Resolved state={status.state} onRetry={status.reload} loadingLabel="Se încarcă starea indexării" skeletonClass="h-64">
      {(d) => (
        <div className="flex flex-col gap-5">
          <Summary status={d} />
          <UrlTable status={d} brandName={brand.name} />
          <PriorityList status={d} canEdit={canEdit} onAdd={async (url) => done(await providers.search.addIndexUrl(brand, url), status.reload)} onRemove={async (id) => done(await providers.search.removeIndexUrl(id), status.reload)} />
        </div>
      )}
    </Resolved>
  )
}

/** Rezultatul unei scrieri: `null` la reușită (și reîncarcă lista), altfel mesajul de afișat. */
function done(r: { kind: 'ready' } | { kind: 'error'; message: string } | { kind: 'not_connected'; reason: string }, reload: () => void): string | null {
  if (r.kind === 'ready') {
    reload()
    return null
  }
  return r.kind === 'error' ? r.message : r.reason
}

function Summary({ status: d }: { status: IndexStatus }) {
  const tiles: Array<{ label: string; value: number; hint: string }> = [
    { label: 'URL-uri inspectate', value: d.summary.total, hint: 'Lista agenției și paginile cu cele mai multe clickuri.' },
    { label: 'În index', value: d.summary.indexed, hint: 'Google le poate arăta în rezultate.' },
    { label: 'În afara indexului', value: d.summary.not_indexed, hint: 'Excluse sau cu erori de indexare.' },
    { label: 'Stare necunoscută', value: d.summary.unknown, hint: 'Google nu a dat un verdict la inspecție.' },
    { label: 'Canonical diferit', value: d.summary.canonical_mismatch, hint: 'Google a ales alt canonical decât cel declarat.' },
  ]
  return (
    <Section id="index-summary" title="Starea indexării" description={d.inspected_on ? `După inspecția din ${formatDate(d.inspected_on)}. Numerele sunt din lista inspectată, nu din tot site-ul.` : 'Numerele sunt din lista inspectată, nu din tot site-ul.'}>
      {d.summary.total === 0 ? (
        <EmptyState compact title="Nicio inspecție încă" text="Inspecția rulează săptămânal, marțea, pentru URL-urile prioritare și pentru paginile cu cele mai multe clickuri din Search Console." />
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-border bg-surface-2 px-4 py-3">
              <dt className="text-[12.5px] font-medium text-text-2">{t.label}</dt>
              <dd className="mt-1 font-display text-[24px] font-semibold tabular-nums">{formatInteger(t.value)}</dd>
              <p className="mt-0.5 text-[12px] leading-snug text-text-2">{t.hint}</p>
            </div>
          ))}
        </dl>
      )}
    </Section>
  )
}

function canonicalText(u: IndexedUrl): string {
  return u.canonical_matches === null ? 'Necunoscut' : u.canonical_matches ? 'Același' : 'Diferit'
}

const columns: Column<IndexedUrl>[] = [
  {
    key: 'url',
    header: 'URL',
    cardTitle: true,
    sortValue: (u) => u.url,
    render: (u) => {
      const href = safeUrl(u.url)
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-[12.5px] text-accent-text hover:underline">{u.url}</a>
      ) : (
        <span className="break-all font-mono text-[12.5px]">{u.url}</span>
      )
    },
  },
  { key: 'priority', header: 'Prioritar', sortValue: (u) => (u.priority ? 'da' : 'nu'), render: (u) => (u.priority ? 'Da' : <span className="text-text-3">Nu</span>) },
  { key: 'state', header: 'Stare', sortValue: (u) => STATE[u.state].label, render: (u) => <StatusChip tone={STATE[u.state].tone}>{STATE[u.state].label}</StatusChip> },
  { key: 'coverage', header: 'Motiv (Google)', sortValue: (u) => u.coverage_state, render: (u) => u.coverage_state ?? missing },
  { key: 'crawl', header: 'Ultima accesare', sortValue: (u) => u.last_crawl_time, render: (u) => (u.last_crawl_time ? <span className="font-mono text-[12px]">{formatDate(u.last_crawl_time.slice(0, 10))}</span> : missing) },
  {
    key: 'canonical',
    header: 'Canonical',
    sortValue: (u) => canonicalText(u),
    render: (u) =>
      u.canonical_matches === false ? (
        <span title={`Ales de Google: ${u.google_canonical ?? ''}`} className="text-warn-text">Diferit</span>
      ) : u.canonical_matches === null ? (
        <span className="text-text-3">Necunoscut</span>
      ) : (
        'Același'
      ),
  },
  { key: 'google_canonical', header: 'Canonical ales de Google', exportValue: (u) => u.google_canonical, render: (u) => (u.canonical_matches === false && u.google_canonical ? <span className="break-all font-mono text-[12px]">{u.google_canonical}</span> : <span className="text-text-3">—</span>) },
  { key: 'inspected', header: 'Inspectat la', sortValue: (u) => u.inspected_on, render: (u) => <span className="font-mono text-[12px]">{formatDate(u.inspected_on)}</span> },
]

function UrlTable({ status: d, brandName }: { status: IndexStatus; brandName: string }) {
  return (
    <Section id="index-urls" title="URL-uri inspectate" description="Ultima inspecție a fiecărui URL. Motivul e cel raportat de Google, neschimbat.">
      <SortableTable caption="URL-uri inspectate" columns={columns} rows={d.urls} rowKey={(u) => u.url} pageSize={15} emptyText="Niciun URL inspectat încă." exportFileName={csvFileName('indexare', brandName, d.inspected_on)} />
    </Section>
  )
}

function PriorityList({ status: d, canEdit, onAdd, onRemove }: { status: IndexStatus; canEdit: boolean; onAdd: (url: string) => Promise<string | null>; onRemove: (id: string) => Promise<string | null> }) {
  const id = useId()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = url.trim()
    if (!/^https?:\/\/\S+$/.test(value)) return setError('Adresa trebuie să înceapă cu http:// sau https:// și să nu conțină spații.')
    setBusy(true)
    setError(null)
    const failed = await onAdd(value)
    setBusy(false)
    if (failed) return setError(failed)
    setUrl('')
  }
  async function remove(urlId: string) {
    setError(null)
    const failed = await onRemove(urlId)
    if (failed) setError(failed)
  }

  return (
    <Section id="index-priority" title="URL-uri prioritare" description="Paginile pe care agenția le urmărește mereu, pe lângă cele cu cele mai multe clickuri. Un URL adăugat intră la următoarea inspecție.">
      {d.priority_urls.length === 0 ? (
        <p className="text-[13px] text-text-2">Niciun URL prioritar. Inspecția acoperă doar paginile cu cele mai multe clickuri.</p>
      ) : (
        <ul aria-label="URL-uri prioritare" className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {d.priority_urls.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <span className="min-w-0 flex-1 break-all font-mono text-[12.5px]">{p.url}</span>
              {!p.inspected && <StatusChip tone="neutral">Neinspectat încă</StatusChip>}
              {canEdit && <Button variant="ghost" onClick={() => void remove(p.id)} aria-label={`Șterge ${p.url}`}>Șterge</Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
          <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
            <label htmlFor={`${id}-url`} className="text-[12.5px] font-semibold">Adaugă un URL prioritar</label>
            <input id={`${id}-url`} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" maxLength={2048} className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent" />
          </div>
          <Button variant="primary" type="submit" loading={busy}>Adaugă</Button>
          <p className="basis-full text-[12px] leading-snug text-text-2">Cel mult 150 de URL-uri pe brand. Adresa trebuie să țină de proprietatea Search Console a site-ului.</p>
        </form>
      )}
      {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
    </Section>
  )
}
