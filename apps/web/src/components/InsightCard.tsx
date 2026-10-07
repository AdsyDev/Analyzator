import type { EvidenceQuery, Insight, InsightStatus } from '../contracts'
import { formatRange } from '../lib/format'
import { Avatar } from './ui/Avatar'
import { StatusChip, type ChipTone } from './ui/Chip'

export const INSIGHT_STATUS_LABELS: Record<InsightStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  in_review: { label: 'În review', tone: 'warn' },
  published: { label: 'Publicat', tone: 'pos' },
  superseded: { label: 'Înlocuit', tone: 'lav' },
}

interface InsightCardProps {
  insight: Insight
  /** Vederea agenției: arată badge-ul de status. Clientul nu-l vede. */
  agencyView?: boolean
  onOpenEvidence?: (evidenceQuery: EvidenceQuery) => void
}

/**
 * Clientul vede doar analize publicate. Filtrarea reală e în server (RLS); aici componenta refuză
 * să randeze o analiză nepublicată în vederea clientului, ca a doua barieră.
 */
export function InsightCard({ insight, agencyView = false, onOpenEvidence }: InsightCardProps) {
  if (!agencyView && insight.status !== 'published') return null
  const status = INSIGHT_STATUS_LABELS[insight.status]

  return (
    <article aria-label={insight.title} data-status={insight.status} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-1">
      <header className="flex items-start gap-3">
        <h3 className="flex-1 font-display text-[16px] font-semibold leading-snug tracking-[-0.01em]">{insight.title}</h3>
        {agencyView && <StatusChip tone={status.tone}>{status.label}</StatusChip>}
      </header>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-2">
        <Avatar name={insight.author.name} size="sm" tone="accent" />
        <span className="font-medium text-text">{insight.author.name}</span>
        <span>{insight.author.role}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono text-[12px]">{formatRange(insight.period.from, insight.period.to)}</span>
      </div>
      <p className="text-[13.5px] leading-relaxed text-text">{insight.summary}</p>
      {insight.evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-text-2">Dovezi atașate</span>
          {insight.evidence.map((e) => (
            <button
              key={`${e.label}-${e.evidence_query.metric_key}-${e.evidence_query.period.start}`}
              type="button"
              onClick={() => onOpenEvidence?.(e.evidence_query)}
              className="rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-accent-text hover:bg-accent-soft"
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
      {insight.limits && (
        <p className="rounded-lg bg-neutral-soft px-3 py-2 text-[12.5px] leading-snug text-text-2">
          <strong className="font-semibold text-text">Limite:</strong> {insight.limits}
        </p>
      )}
    </article>
  )
}
