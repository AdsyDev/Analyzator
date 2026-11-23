import { useState } from 'react'
import type { Brand, CompetitionGap, CompetitionMatrix, CompetitorAd, CompetitorAdsPage, ProviderResult, QueryContext } from '../../contracts'
import { ComparisonTable, type ComparisonColumn, type ComparisonGroup } from '../../components/ComparisonTable'
import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/ui/Chip'
import { Pager } from '../../components/ui/Pager'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync, type AsyncState } from '../../data/useAsync'
import { formatDate, formatInteger } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { useExportName } from '../shared/useExportName'

const DIMENSION_LABELS = { ai: 'AI', seo: 'SEO' } as const

/** Matricea din provider → forma `ComparisonTable`. Nu se calculează nimic: celulele merg neschimbate. */
export function toComparison(m: CompetitionMatrix): { columns: ComparisonColumn[]; groups: ComparisonGroup[] } {
  return {
    columns: m.entities.map<ComparisonColumn>((e) => ({ key: e.id, short: e.kind === 'brand' ? e.name : e.label, full: e.name, kind: e.kind })),
    groups: m.groups.map<ComparisonGroup>((g) => ({
      name: g.title,
      source: g.source ?? undefined,
      rows: g.rows.map((r) => ({ key: r.key, label: r.label, definition: r.definition, direction: r.direction, cells: r.cells })),
    })),
  }
}

const gapColumns: Column<CompetitionGap>[] = [
  { key: 'dimension', header: 'Dimensiune', sortValue: (g) => g.dimension, render: (g) => <StatusChip tone={g.dimension === 'ai' ? 'lav' : 'accent'}>{DIMENSION_LABELS[g.dimension]}</StatusChip> },
  { key: 'subject', header: 'Subiect', cardTitle: true, sortValue: (g) => g.subject, render: (g) => <span className="font-medium">{g.subject}</span> },
  {
    key: 'competitors',
    header: 'Unde apare concurența',
    render: (g) => (
      <ul className="flex flex-col gap-0.5">
        {g.competitors.map((c) => (
          <li key={c.label}>
            {c.name} <span className="font-mono text-[11px] text-text-3">{c.label}</span> <span className="text-text-2">· {c.detail}</span>
          </li>
        ))}
      </ul>
    ),
  },
  { key: 'brand', header: 'Situația noastră', render: (g) => <span className="text-text-2">{g.brand}</span> },
]

function Matrix({ state, onRetry }: { state: AsyncState<ProviderResult<CompetitionMatrix>>; onRetry: () => void }) {
  return (
    <Section id="matrix" title="Matricea comparativă" description="Brandul și competitorii validați, pe aceleași definiții, surse și perioade. N/A înseamnă că sursa nu oferă metrica pentru acea entitate; nu e zero.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă matricea" skeletonClass="h-80">
        {(m) => {
          const { columns, groups } = toComparison(m)
          return <ComparisonTable caption="Comparație cu competitorii" columns={columns} groups={groups} setVersion={m.set_version} effectiveFrom={m.effective_from} dataAsOf={m.data_as_of} note="C1-C3 sunt sloturi până când numele, domeniile și advertiserii sunt confirmați de account, strategie și client." />
        }}
      </Resolved>
    </Section>
  )
}

function Gaps({ state, onRetry }: { state: AsyncState<ProviderResult<CompetitionGap[]>>; onRetry: () => void }) {
  const exportName = useExportName('diferente concurenta')
  return (
    <Section id="gaps" title="Unde apare concurența și noi lipsim" description="Căutări și subiecte în care un competitor e prezent, iar brandul lipsește sau e mai slab. Sunt puncte de plecare pentru discuție, nu concluzii.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă diferențele" skeletonClass="h-48">
        {(gaps) =>
          gaps.length === 0 ? (
            <EmptyState compact title="Nicio diferență găsită" text="Nu am găsit subiecte în care un competitor apare și brandul lipsește." />
          ) : (
            <SortableTable caption="Unde apare concurența și noi lipsim" exportFileName={exportName} columns={gapColumns} rows={gaps} rowKey={(g) => g.id} pageSize={8} emptyText="Nicio diferență." />
          )
        }
      </Resolved>
    </Section>
  )
}

const ADS_PAGE_SIZE = 20
const FORMAT_LABELS: Record<CompetitorAd['format'], string> = { text: 'Text', image: 'Imagine', video: 'Video', unknown: 'Necunoscut' }
const shownRange = (a: CompetitorAd) => (a.first_shown && a.last_shown ? `${formatDate(a.first_shown)} – ${formatDate(a.last_shown)}` : a.last_shown ? `până la ${formatDate(a.last_shown)}` : '—')

const adColumns: Column<CompetitorAd>[] = [
  {
    key: 'competitor',
    header: 'Competitor',
    cardTitle: true,
    render: (a) => (
      <span className="font-medium">
        {a.competitor_name} <span className="font-mono text-[11px] font-normal text-text-3">{a.competitor_label}</span>
      </span>
    ),
  },
  { key: 'advertiser', header: 'Advertiser', render: (a) => a.advertiser_name ?? <span className="font-mono text-[12px] text-text-2">{a.advertiser_id}</span> },
  { key: 'format', header: 'Format', render: (a) => FORMAT_LABELS[a.format] },
  {
    key: 'shown',
    header: 'Afișată în România',
    render: (a) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="tabular-nums">{shownRange(a)}</span>
        {a.new_in_period && <StatusChip tone="accent">Nouă în perioadă</StatusChip>}
      </span>
    ),
  },
  {
    key: 'times',
    header: 'Afișări (interval Google)',
    align: 'right',
    render: (a) => (a.times_shown_lower === null || a.times_shown_upper === null ? <span className="text-text-3">Nepublicat</span> : <span className="tabular-nums">{formatInteger(a.times_shown_lower)}–{formatInteger(a.times_shown_upper)}</span>),
  },
  {
    key: 'link',
    header: 'Reclama',
    render: (a) =>
      a.source_url ? (
        <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
          Vezi în Ads Transparency
        </a>
      ) : (
        <span className="text-text-3">Fără link</span>
      ),
  },
]

// Fără export CSV: lista e paginată pe server, iar exportul ar conține doar pagina curentă.
function Ads({ state, page, onPage, onRetry }: { state: AsyncState<ProviderResult<CompetitorAdsPage>>; page: number; onPage: (p: number) => void; onRetry: () => void }) {
  return (
    <Section
      id="ads"
      title="Reclamele competitorilor"
      description="Reclamele advertiserilor configurați pentru fiecare competitor, pe care Google Ads Transparency Center le declară afișate în România în perioadă. Arată activitatea observată, nu bugetul, reach-ul sau eficiența; creația se vede pe pagina reclamei."
    >
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă reclamele" skeletonClass="h-48">
        {(p) =>
          p.total === 0 ? (
            <EmptyState compact title="Nicio reclamă în perioadă" text="Google nu declară nicio reclamă a advertiserilor din set afișată în România în această perioadă." />
          ) : (
            <div className="flex flex-col gap-2">
              <SortableTable caption="Reclamele competitorilor" columns={adColumns} rows={p.items} rowKey={(a) => a.id} pageSize={ADS_PAGE_SIZE} emptyText="Nicio reclamă." />
              <Pager current={page} pages={Math.max(1, Math.ceil(p.total / ADS_PAGE_SIZE))} pageSize={ADS_PAGE_SIZE} total={p.total} onPage={onPage} className="border-t border-border pt-2" />
              {p.data_as_of && <p className="text-[12px] text-text-3">Google interogat cu date până la {formatDate(p.data_as_of)}.</p>}
            </div>
          )
        }
      </Resolved>
    </Section>
  )
}

/** Concurență (spec cap. 20): matricea comparativă, „Unde apare concurența și noi lipsim" și reclamele competitorilor. Fiecare secțiune are stările ei. */
export function CompetitionPage() {
  const { brand, ctx } = useLayout()
  if (!brand || !ctx) return null
  return <CompetitionContent brand={brand} ctx={ctx} />
}

function CompetitionContent({ ctx }: { brand: Brand; ctx: QueryContext }) {
  const providers = useProviders()
  const key = ctxKey(ctx)
  const matrix = useAsync(() => providers.competition.matrix(ctx), [providers, key])
  const gaps = useAsync(() => providers.competition.gaps(ctx), [providers, key])
  return (
    <div className="flex flex-col gap-5">
      <Matrix state={matrix.state} onRetry={matrix.reload} />
      <Gaps state={gaps.state} onRetry={gaps.reload} />
      <AdsSection key={key} ctx={ctx} />
    </div>
  )
}

/** Pagina reclamelor se ține local și revine la 1 la schimbarea brandului sau a perioadei (cheia contextului). */
function AdsSection({ ctx }: { ctx: QueryContext }) {
  const providers = useProviders()
  const [page, setPage] = useState(1)
  const ads = useAsync(() => providers.competition.ads(ctx, { page, page_size: ADS_PAGE_SIZE }), [providers, ctxKey(ctx), page])
  return <Ads state={ads.state} page={page} onPage={setPage} onRetry={ads.reload} />
}
