import { useMemo, useState } from 'react'
import type { Brand, EvidenceQuery, Insight, InsightAction, InsightStatus, QueryContext } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { INSIGHT_STATUS_LABELS, InsightCard } from '../../components/InsightCard'
import { Avatar } from '../../components/ui/Avatar'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { Tabs, type TabItem } from '../../components/ui/Tabs'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { ACTION_LABEL } from '../overview/InsightSections'

type StatusTab = 'all' | InsightStatus

interface ActionRow extends InsightAction {
  insight: Insight
}

/** Acțiunile analizelor primite, cu analiza lor. Nu se calculează nimic: ce vine de la provider, în ordinea termenului. */
export function actionRows(insights: readonly Insight[]): ActionRow[] {
  return insights
    .flatMap((i) => i.actions.map<ActionRow>((a) => ({ ...a, insight: i })))
    .sort((a, b) => (a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31'))
}

const actionColumns: Column<ActionRow>[] = [
  { key: 'title', header: 'Acțiune', sortValue: (a) => a.title, render: (a) => <span className="font-medium">{a.title}</span> },
  { key: 'insight', header: 'Din analiza', sortValue: (a) => a.insight.title, render: (a) => <span className="text-text-2">{a.insight.title}</span> },
  {
    key: 'owner',
    header: 'Responsabil',
    sortValue: (a) => a.owner.name,
    render: (a) => (
      <span className="inline-flex items-center gap-2">
        <Avatar name={a.owner.name} size="sm" tone="accent" />
        <span className="leading-tight">
          <span className="block text-[12.5px] font-medium">{a.owner.name}</span>
          <span className="block text-[11.5px] text-text-2">{a.owner.role}</span>
        </span>
      </span>
    ),
  },
  { key: 'due', header: 'Termen', sortValue: (a) => a.due, render: (a) => (a.due ? <span className="font-mono text-[12px]">{formatDate(a.due)}</span> : <span className="text-text-3">Fără termen</span>) },
  { key: 'status', header: 'Status', sortValue: (a) => a.status, render: (a) => <StatusChip tone={ACTION_LABEL[a.status].tone}>{ACTION_LABEL[a.status].label}</StatusChip> },
]

/**
 * Analize și acțiuni (spec cap. 21). Agenția vede toate statusurile (draft, în review, publicat, înlocuit);
 * clientul vede doar analizele publicate, iar filtrarea reală e a providerului (RLS), nu a interfeței.
 */
export function InsightsPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <InsightsContent brand={brand} ctx={ctx} agencyView={user.role !== 'client_viewer'} />
}

function InsightsContent({ brand, ctx, agencyView }: { brand: Brand; ctx: QueryContext; agencyView: boolean }) {
  const providers = useProviders()
  const list = useAsync(() => providers.insights.list(ctx), [providers, ctxKey(ctx)])
  const [tab, setTab] = useState<StatusTab>('all')
  const [target, setTarget] = useState<EvidenceTarget | null>(null)

  const open = (q: EvidenceQuery, label: string) => setTarget({ page: 'Analize și acțiuni', label, query: q })

  return (
    <div className="flex flex-col gap-5">
      <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă analizele" skeletonClass="h-64">
        {(all) => <Body all={all} agencyView={agencyView} tab={tab} setTab={setTab} onOpenEvidence={open} />}
      </Resolved>
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={agencyView} />
    </div>
  )
}

function Body({ all, agencyView, tab, setTab, onOpenEvidence }: { all: Insight[]; agencyView: boolean; tab: StatusTab; setTab: (t: StatusTab) => void; onOpenEvidence: (q: EvidenceQuery, label: string) => void }) {
  // A doua barieră: chiar dacă providerul ar greși, clientul nu primește o analiză nepublicată.
  const visible = useMemo(() => (agencyView ? all : all.filter((i) => i.status === 'published')), [all, agencyView])
  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { all: visible.length, draft: 0, in_review: 0, published: 0, superseded: 0 }
    for (const i of visible) c[i.status]++
    return c
  }, [visible])
  const tabs: TabItem<StatusTab>[] = [
    { id: 'all', label: `Toate (${counts.all})` },
    ...(['draft', 'in_review', 'published', 'superseded'] as const).map((s) => ({ id: s, label: `${INSIGHT_STATUS_LABELS[s].label} (${counts[s]})` })),
  ]
  const shown = tab === 'all' || !agencyView ? visible : visible.filter((i) => i.status === tab)

  if (visible.length === 0) {
    return (
      <EmptyState
        title={agencyView ? 'Nicio analiză pentru acest brand' : 'Nicio analiză publicată'}
        text={agencyView ? 'Nu există încă nicio analiză, nici măcar ciornă, pentru acest brand.' : 'Echipa AdSymphony nu a publicat încă o analiză pentru acest brand.'}
      />
    )
  }

  return (
    <>
      <Section
        id="insights"
        title="Analize"
        description={agencyView ? 'Toate statusurile sunt vizibile echipei AdSymphony. Clientul vede doar analizele publicate.' : 'Interpretările publicate de echipa AdSymphony, cu dovezile și limitele lor.'}
        action={agencyView ? <Tabs label="Status analiză" items={tabs} value={tab} onChange={setTab} /> : undefined}
      >
        {shown.length === 0 ? (
          <EmptyState compact title="Nicio analiză cu acest status" text="Alege alt status sau vezi toate analizele." />
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((i) => (
              <li key={i.id} className={i.status === 'superseded' ? 'opacity-80' : undefined}>
                <InsightCard insight={i} agencyView={agencyView} onOpenEvidence={(q) => onOpenEvidence(q, i.evidence.find((e) => e.evidence_query === q)?.label ?? q.metric_key)} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="actions" title="Acțiuni" description="Ce urmează din analize, cu responsabil, termen și status.">
        <SortableTable caption="Acțiuni" columns={actionColumns} rows={actionRows(shown)} rowKey={(a) => `${a.insight.id}:${a.id}`} pageSize={8} emptyText="Analizele afișate nu au acțiuni." />
      </Section>
    </>
  )
}
