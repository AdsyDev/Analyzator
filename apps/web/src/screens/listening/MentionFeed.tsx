import { useState } from 'react'
import type { Brand, Mention, QueryContext, SentimentFilter, AuthorFilter } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { PharmacovigilanceButton } from '../../components/PharmacovigilanceButton'
import { SocialPostCard } from '../../components/SocialPostCard'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { platformOf } from '../../lib/platform'
import { safeUrl } from '../../lib/safeUrl'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { SENTIMENT_LABELS } from './labels'

const PAGE_SIZE = 6

export interface MentionFilters {
  sentiment: SentimentFilter | null
  source: string | null
  author: AuthorFilter | null
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
 * Feed-ul de mențiuni, cu fiecare mențiune ca o postare (E-3): platforma, autorul (cont propriu sau extern, fără nume
 * inventate), data, textul complet, sentimentul cu starea validării și butonul de marcare pentru farmacovigilență.
 * Starea „marcat" vine de la provider, deci rămâne după reîncărcare.
 */
export function MentionFeed({ brand, ctx, filters, onChanged }: { brand: Brand; ctx: QueryContext; filters: MentionFilters; onChanged: () => void }) {
  const providers = useProviders()
  const [page, setPage] = useState(1)
  const state = useAsync(() => providers.mentions.list(ctx, { sentiment: filters.sentiment, source: filters.source, author: filters.author, page, page_size: PAGE_SIZE }), [providers, ctxKey(ctx), page])

  return (
    <Section id="feed" title="Mențiuni" description="Cele mai recente mențiuni eligibile. Sentimentul e etichetat de un om; „Nerevizuit” înseamnă că încă nu a fost verificat.">
      <Resolved state={state.state} onRetry={state.reload} loadingLabel="Se încarcă mențiunile" skeletonClass="h-64">
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState compact title="Nicio mențiune pentru filtrele alese" text="Schimbă sentimentul, sursa sau perioada." />
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="grid gap-3 lg:grid-cols-2">
                {p.items.map((m) => {
                  const own = m.owned_account === true
                  return (
                    <li key={m.id} data-testid="mention" data-flagged={m.pv_flag ? 'true' : 'false'}>
                      <SocialPostCard
                        platform={platformOf(m.url, m.source_name)}
                        author={own ? brand.name : (m.author ?? 'Autor extern')}
                        own={own}
                        source={m.source_name}
                        publishedAt={m.published_at}
                        text={m.text}
                        href={safeUrl(m.url)}
                        aside={<SentimentBadge m={m} />}
                        tags={own ? <StatusChip tone="accent">Cont propriu</StatusChip> : undefined}
                        footer={<span className="text-text-2">{m.reviewed_by ? `Revizuit de ${m.reviewed_by}` : 'Fără revizuire umană încă'}</span>}
                        actions={
                          <>
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
                          </>
                        }
                      />
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
