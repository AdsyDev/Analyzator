import { CopyIcon } from '@phosphor-icons/react'
import type { Evidence, MetricDefinition, MetricResponse, ProviderResult } from '../contracts'
import { formatDate, formatDateTime, formatRange } from '../lib/format'
import { coveragePercent, metricView } from '../lib/metricView'
import { sourceName } from '../lib/sources'
import { CoverageBadge } from './CoverageBadge'
import { EmptyState } from './EmptyState'
import { Button } from './ui/Button'
import { Dialog } from './ui/Dialog'

export interface EvidenceDrawerProps {
  open: boolean
  onClose: () => void
  /** Pagina din care s-a deschis (de ex. „Overview"). */
  page: string
  label: string
  metric: MetricResponse | null
  definition: MetricDefinition | null
  period: { from: string; to: string }
  /** `null` cât timp se încarcă dovada. */
  evidence: ProviderResult<Evidence> | null
  onRetry?: () => void
  /** Acțiunea de conectare, când sursa lipsește (doar agenția primește una). */
  connectAction?: { label: string; onClick: () => void }
  onCopyHash?: (hash: string) => void
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 text-[13px]">
      <dt className="w-28 flex-none text-text-2">{term}</dt>
      <dd className="min-w-0 flex-1 text-text">{children}</dd>
    </div>
  )
}

/** Dovada din spatele unui indicator: definiție, sursă, interval, acoperire, formulă și înregistrări. */
export function EvidenceDrawer({ open, onClose, page, label, metric, definition, period, evidence, onRetry, connectAction, onCopyHash }: EvidenceDrawerProps) {
  const view = metric ? metricView(metric) : null

  return (
    <Dialog open={open} onClose={onClose} title="Dovezi" placement="right">
      <div className="flex flex-col gap-5">
        <header>
          <p className="text-[12px] text-text-2">{page}</p>
          <h3 className="font-display text-[17px] font-semibold">{label}</h3>
          {definition?.aggregation_label && <p className="mt-0.5 text-[12.5px] text-text-3">{definition.aggregation_label}</p>}
          {definition?.lifecycle === 'draft' && (
            <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn-text">
              <strong className="font-semibold">Definiție provizorie.</strong> {definition.lifecycle_note}
            </p>
          )}
        </header>

        {view && (
          <div className="rounded-xl border border-border bg-surface p-4">
            {view.hasValue ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-[28px] font-semibold tabular-nums">{view.valueText}</span>
                {view.deltaText && <span className="text-[13px] font-semibold tabular-nums text-text-2">{view.deltaText}</span>}
              </div>
            ) : (
              <div>
                <p className="font-display text-[15px] font-semibold">{view.emptyTitle}</p>
                {view.emptyReason && <p className="mt-1 text-[13px] text-text-2">{view.emptyReason}</p>}
                <p className="mt-1 text-[12.5px] text-text-3">Nu afișăm valori estimate.</p>
              </div>
            )}
            {view.caveat && <p className="mt-2 text-[12.5px] text-text-2">{view.caveat}</p>}
            {view.notes.map((n) => (
              <p key={n} className="mt-1 text-[12.5px] text-text-2">{n}</p>
            ))}
          </div>
        )}

        <dl className="divide-y divide-border">
          {metric?.source && <Row term="Sursă">{sourceName(metric.source)}</Row>}
          <Row term="Interval">{formatRange(period.from, period.to)}</Row>
          {metric?.data_as_of && <Row term="Date până la"><span className="font-mono text-[12px]">{formatDate(metric.data_as_of)}</span></Row>}
          {metric && (
            <Row term="Acoperire">
              <CoverageBadge state={view?.coverage ?? 'unavailable'} pct={coveragePercent(metric.coverage)} />
            </Row>
          )}
        </dl>

        {definition && (
          <section>
            <h4 className="mb-1 text-[13px] font-semibold">Cum se calculează</h4>
            <p className="text-[13px] leading-normal text-text-2">{definition.formula}</p>
            <p className="mt-1 font-mono text-[11px] text-text-3">Versiunea definiției: v{definition.version} · {definition.doc_ref}</p>
          </section>
        )}

        <section aria-live="polite">
          <h4 className="mb-2 text-[13px] font-semibold">Înregistrări sursă</h4>
          {evidence === null && <div role="status" aria-label="Se încarcă dovezile" className="h-24 rounded-lg bg-skeleton" />}
          {evidence?.kind === 'error' && (
            <EmptyState compact title="Nu am putut încărca dovezile" text={evidence.message} action={onRetry ? { label: 'Reîncearcă', onClick: onRetry } : undefined} />
          )}
          {evidence?.kind === 'not_connected' && (
            <EmptyState
              compact
              title="Sursă neconectată"
              text={`${evidence.reason} Nu afișăm valori estimate până la conectare.`}
              action={connectAction}
            />
          )}
          {evidence?.kind === 'ready' &&
            (evidence.data.records.length === 0 ? (
              <p className="text-[13px] text-text-2">Nu există înregistrări pentru acest interval.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-text-2">
                  Cele mai recente {evidence.data.records.length} din <span className="font-mono">{evidence.data.total_records}</span>
                </p>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full border-collapse text-[12.5px]">
                    <caption className="sr-only">Înregistrări sursă pentru {label}</caption>
                    <thead>
                      <tr className="bg-surface-2 text-left text-text-2">
                        {evidence.data.columns.map((c) => (
                          <th key={c.key} scope="col" className="px-3 py-1.5 font-semibold">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.data.records.map((r) => (
                        <tr key={r.id} className="border-t border-border">
                          {evidence.data.columns.map((c) => {
                            const v = r.fields[c.key]
                            return (
                              <td key={c.key} className="px-3 py-1.5 tabular-nums">
                                {v === null || v === undefined ? <span className="text-text-3">Fără date</span> : v}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="divide-y divide-border">
                  {evidence.data.imported_at && <Row term="Importat la"><span className="font-mono text-[12px]">{formatDateTime(evidence.data.imported_at)}</span></Row>}
                  {evidence.data.payload_hash && (
                    <Row term="Payload">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-[11.5px]">{evidence.data.payload_hash.slice(0, 16)}…</span>
                        {onCopyHash && (
                          <Button variant="ghost" icon={<CopyIcon size={14} aria-hidden="true" />} onClick={() => onCopyHash(evidence.data.payload_hash ?? '')}>
                            Copiază hash
                          </Button>
                        )}
                      </span>
                    </Row>
                  )}
                </dl>
              </div>
            ))}
        </section>
      </div>
    </Dialog>
  )
}
