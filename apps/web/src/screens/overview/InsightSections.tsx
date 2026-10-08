import { Link } from 'react-router-dom'
import type { EvidenceQuery, Insight, InsightAction, Person, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { InsightCard } from '../../components/InsightCard'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { ProviderProblem } from '../../routing/pages'
import { Section } from '../shared/Section'

type InsightsState = AsyncState<ProviderResult<Insight[]>>

/** Ultima analiză publicată: cea mai recentă după `published_at`; clientul primește oricum doar publicate (RLS). */
export function latestPublished(list: readonly Insight[]): Insight | null {
  return [...list].filter((i) => i.status === 'published').sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0] ?? null
}

function Skeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="h-40 rounded-xl bg-skeleton" />
}

interface LatestProps {
  state: InsightsState
  agencyView: boolean
  allHref: string
  onRetry: () => void
  onOpenEvidence: (q: EvidenceQuery, label: string) => void
}

export function LatestInsight({ state, agencyView, allHref, onRetry, onOpenEvidence }: LatestProps) {
  const link = (
    <Link to={allHref} className="text-[13px] font-medium text-accent-text hover:underline">
      Vezi toate analizele
    </Link>
  )
  let body
  if (state.status === 'loading') body = <Skeleton label="Se încarcă ultima analiză" />
  else if (state.status === 'failed') body = <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={onRetry} />
  else if (state.value.kind !== 'ready') body = <ProviderProblem result={state.value} onRetry={onRetry} />
  else {
    const latest = latestPublished(state.value.data)
    body = latest ? (
      <InsightCard insight={latest} agencyView={agencyView} onOpenEvidence={(q) => onOpenEvidence(q, latest.evidence.find((e) => e.evidence_query === q)?.label ?? q.metric_key)} />
    ) : (
      <EmptyState compact title="Nicio analiză publicată" text="Echipa AdSymphony nu a publicat încă o analiză pentru acest brand." />
    )
  }
  return (
    <Section plain id="latest-insight" title="Ultima analiză publicată" action={link}>
      {body}
    </Section>
  )
}

function Owner({ person }: { person: Person }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Avatar name={person.name} size="sm" tone="accent" />
      <span className="leading-tight">
        <span className="block text-[12.5px] font-medium text-text">{person.name}</span>
        <span className="block text-[11.5px] text-text-2">Responsabil, {person.role}</span>
      </span>
    </span>
  )
}

const OPEN_STATUSES: ReadonlySet<InsightAction['status']> = new Set(['open', 'in_progress'])
const ACTION_LABEL: Record<InsightAction['status'], { label: string; tone: 'neutral' | 'accent' | 'pos' }> = {
  open: { label: 'Deschisă', tone: 'neutral' },
  in_progress: { label: 'În lucru', tone: 'accent' },
  done: { label: 'Finalizată', tone: 'pos' },
  cancelled: { label: 'Anulată', tone: 'neutral' },
}

/** Acțiunile deschise ale ultimei analize publicate, cele mai apropiate de termen întâi; maximum 3 (spec cap. 12). */
export function opportunitiesFrom(insight: Insight | null): InsightAction[] {
  if (!insight) return []
  return insight.actions
    .filter((a) => OPEN_STATUSES.has(a.status))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
    .slice(0, 3)
}

interface OppProps {
  state: InsightsState
  onRetry: () => void
  onOpenEvidence: (q: EvidenceQuery, label: string) => void
}

export function Opportunities({ state, onRetry, onOpenEvidence }: OppProps) {
  let body
  if (state.status === 'loading') body = <Skeleton label="Se încarcă oportunitățile" />
  else if (state.status === 'failed') body = <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={onRetry} />
  else if (state.value.kind !== 'ready') body = <ProviderProblem result={state.value} onRetry={onRetry} />
  else {
    const latest = latestPublished(state.value.data)
    const items = opportunitiesFrom(latest)
    const evidence = latest?.evidence[0] ?? null
    body =
      items.length === 0 ? (
        <EmptyState compact title="Nicio oportunitate deschisă" text="Ultima analiză publicată nu are acțiuni deschise." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {items.map((a) => {
            const st = ACTION_LABEL[a.status]
            return (
              <li key={a.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4">
                <div className="flex items-start gap-2">
                  <h3 className="flex-1 text-[14px] font-semibold leading-snug">{a.title}</h3>
                  <StatusChip tone={st.tone}>{st.label}</StatusChip>
                </div>
                <Owner person={a.owner} />
                <p className="text-[12.5px] text-text-2">
                  Termen <span className="font-mono text-[12px] text-text">{a.due ? formatDate(a.due) : 'nesetat'}</span>
                </p>
                {evidence && (
                  <Button onClick={() => onOpenEvidence(evidence.evidence_query, evidence.label)} className="self-start">
                    Deschide dovezile
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )
  }
  return (
    <Section id="opportunities" title="Oportunități" description="Acțiunile deschise din ultima analiză publicată de echipa AdSymphony.">
      {body}
    </Section>
  )
}

