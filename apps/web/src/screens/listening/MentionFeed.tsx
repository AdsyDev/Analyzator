import { useState } from 'react'
import type { Brand, Mention, QueryContext, SentimentFilter } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { PharmacovigilanceButton } from '../../components/PharmacovigilanceButton'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { formatDateTime } from '../../lib/format'
import { safeUrl } from '../../lib/safeUrl'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { SENTIMENT_LABELS } from './labels'

const PAGE_SIZE = 6

export interface MentionFilters {
  sentiment: SentimentFilter | null
  source: string | null
}

function SentimentBadge({ m }: { m: Mention }) {
  if (m.sentiment === null) {
    return (
      <span title="Sentimentul nu a fost încă revizuit de un om">
        <StatusChip tone="warn">Nerevizuit</StatusChip>
      </span>
    )
  }
  const s = SENTIMENT_LABELS[m.sentiment]
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>
}

/**
 * Feed-ul de mențiuni: sursă, dată, text, sentiment cu starea validării (revizuit de un om sau nerevizuit) și
 * butonul de marcare pentru farmacovigilență. Starea „marcat" vine de la provider, deci rămâne după reîncărcare.
 */
export function MentionFeed({ brand, ctx, filters, onChanged }: { brand: Brand; ctx: QueryContext; filters: MentionFilters; onChanged: () => void }) {
  const providers = useProviders()
  const [page, setPage] = useState(1)
  const state = useAsync(() => providers.mentions.list(ctx, { sentiment: filters.sentiment, source: filters.source, page, page_size: PAGE_SIZE }), [providers, ctxKey(ctx), page])

  return (
    <Section id="feed" title="Mențiuni" description="Cele mai recente mențiuni eligibile. Sentimentul e etichetat de un om; „Nerevizuit” înseamnă că încă nu a fost verificat.">
      <Resolved state={state.state} onRetry={state.reload} loadingLabel="Se încarcă mențiunile" skeletonClass="h-64">
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState compact title="Nicio mențiune pentru filtrele alese" text="Schimbă sentimentul, sursa sau perioada." />
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-3">
                {p.items.map((m) => {
                  const href = safeUrl(m.url)
                  return (
                    <li key={m.id} data-testid="mention" data-flagged={m.pv_flag ? 'true' : 'false'}>
                      <article className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2 p-4">
                        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-2">
                          <span className="font-semibold text-text">{m.source_name}</span>
                          {m.author && <span>{m.author}</span>}
                          <span className="font-mono text-[12px]">{formatDateTime(m.published_at)}</span>
                          <span className="flex-1" />
                          <SentimentBadge m={m} />
                        </header>
                        <p className="text-[13.5px] leading-relaxed text-text">{m.text}</p>
                        <footer className="flex flex-wrap items-center gap-3 text-[12.5px]">
                          <span className="text-text-2">{m.reviewed_by ? `Revizuit de ${m.reviewed_by}` : 'Fără revizuire umană încă'}</span>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-text hover:underline">
                              Deschide sursa
                            </a>
                          ) : (
                            <span className="text-text-3">URL indisponibil</span>
                          )}
                          <span className="flex-1" />
                          <PharmacovigilanceButton
                            item={{ kind: 'mention', id: m.id }}
                            flag={m.pv_flag}
                            loadSnapshot={(i) => providers.mentions.pvPreview(brand.id, i)}
                            onConfirm={(i) => providers.mentions.pvFlag(brand.id, i)}
                            onFlagged={() => {
                              state.reload()
                              onChanged()
                            }}
                          />
                        </footer>
                      </article>
                    </li>
                  )
                })}
              </ul>
              <nav aria-label="Paginare mențiuni" className="flex items-center gap-3 text-[12px] text-text-2">
                <span>
                  {(p.page - 1) * p.page_size + 1}-{Math.min(p.page * p.page_size, p.total)} din {p.total}
                </span>
                <span className="flex-1" />
                <Button variant="ghost" disabled={p.page <= 1} onClick={() => setPage(p.page - 1)}>Înapoi</Button>
                <Button variant="ghost" disabled={p.page * p.page_size >= p.total} onClick={() => setPage(p.page + 1)}>Înainte</Button>
              </nav>
            </div>
          )
        }
      </Resolved>
    </Section>
  )
}
