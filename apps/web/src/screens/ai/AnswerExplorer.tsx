import { FlagIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import type { AiFilters, Brand, QueryContext } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { AI_ENGINE_LABELS, OUTCOME_LABELS } from '../../lib/ai'
import { formatDateTime } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { AnswerDrawer } from './AnswerDrawer'

const PAGE_SIZE = 8

interface Props {
  brand: Brand
  ctx: QueryContext
  filters: AiFilters
}

/**
 * Întrebările din panel și răspunsurile primite. Refuzul, eroarea și răspunsul necolectat au etichete
 * proprii: nu se confundă cu „Nemenționat". Filtrele engine și grup vin din URL.
 */
export function AnswerExplorer({ brand, ctx, filters }: Props) {
  const providers = useProviders()
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const state = useAsync(() => providers.ai.answers(ctx, filters, { page, page_size: PAGE_SIZE }), [providers, ctxKey(ctx), page])

  return (
    <Section id="explorer" title="Answer Explorer" description="Întrebările din panel și răspunsurile primite. Deschide un răspuns ca să vezi textul sanitizat, brandurile și citările.">
      <Resolved state={state.state} onRetry={state.reload} loadingLabel="Se încarcă răspunsurile" skeletonClass="h-64">
        {(p) =>
          p.items.length === 0 ? (
            <EmptyState compact title="Niciun răspuns pentru filtrele alese" text="Schimbă engine-ul, grupul sau perioada." />
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
                {p.items.map((a) => {
                  const o = OUTCOME_LABELS[a.outcome]
                  return (
                    <li key={a.id}>
                      <button type="button" onClick={() => setOpenId(a.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-medium leading-snug text-text">{a.question}</span>
                          <span className="mt-0.5 block text-[12px] text-text-2">
                            {AI_ENGINE_LABELS[a.engine]} · <span className="font-mono text-[11.5px]">{formatDateTime(a.collected_at)}</span> · {a.group}
                          </span>
                        </span>
                        {a.pv_flag && <FlagIcon size={14} weight="fill" className="flex-none text-pv" aria-label="Marcat pentru farmacovigilență" />}
                        <StatusChip tone={o.tone}>{o.label}</StatusChip>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <nav aria-label="Paginare răspunsuri" className="flex items-center gap-3 text-[12px] text-text-2">
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
      <AnswerDrawer brand={brand} answerId={openId} onClose={() => setOpenId(null)} />
    </Section>
  )
}
