import type { Brand, CompetitionGap, CompetitionMatrix, ProviderResult, QueryContext } from '../../contracts'
import { ComparisonTable, type ComparisonColumn, type ComparisonGroup } from '../../components/ComparisonTable'
import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync, type AsyncState } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

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
  { key: 'subject', header: 'Subiect', sortValue: (g) => g.subject, render: (g) => <span className="font-medium">{g.subject}</span> },
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
  return (
    <Section id="gaps" title="Unde apare concurența și noi lipsim" description="Căutări și subiecte în care un competitor e prezent, iar brandul lipsește sau e mai slab. Sunt puncte de plecare pentru discuție, nu concluzii.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă diferențele" skeletonClass="h-48">
        {(gaps) =>
          gaps.length === 0 ? (
            <EmptyState compact title="Nicio diferență găsită" text="Nu am găsit subiecte în care un competitor apare și brandul lipsește." />
          ) : (
            <SortableTable caption="Unde apare concurența și noi lipsim" columns={gapColumns} rows={gaps} rowKey={(g) => g.id} pageSize={8} emptyText="Nicio diferență." />
          )
        }
      </Resolved>
    </Section>
  )
}

/** Concurență (spec cap. 20): matricea comparativă și „Unde apare concurența și noi lipsim". Fiecare secțiune are stările ei. */
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
    </div>
  )
}
