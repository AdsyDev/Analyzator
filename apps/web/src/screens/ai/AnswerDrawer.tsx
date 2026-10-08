import { FlagIcon } from '@phosphor-icons/react'
import type { AiAnswerDetail, AnswerSegment, Brand, PvItemRef } from '../../contracts'
import { VALID_OUTCOMES } from '../../contracts'
import { PharmacovigilanceButton } from '../../components/PharmacovigilanceButton'
import { StatusChip } from '../../components/ui/Chip'
import { Dialog } from '../../components/ui/Dialog'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { AI_ENGINE_LABELS, OUTCOME_LABELS } from '../../lib/ai'
import { formatDateTime } from '../../lib/format'
import { safeUrl } from '../../lib/safeUrl'
import { ProviderProblem } from '../../routing/pages'

/** Textul răspunsului sanitizat. Segmentele vin marcate de server; UI-ul nu detectează branduri în text. */
export function AnswerText({ segments, ownId }: { segments: AnswerSegment[]; ownId: string }) {
  return (
    <p className="text-[14px] leading-relaxed text-text" data-testid="answer-text">
      {segments.map((s, i) => {
        if (s.kind === 'text') return <span key={i}>{s.text}</span>
        if (s.kind === 'cite') {
          return (
            <sup key={i} className="font-mono text-[11px] text-accent-text" aria-label={`citarea ${s.n}`}>
              [{s.n}]
            </sup>
          )
        }
        const own = s.entity_id === ownId
        return own ? (
          <mark key={i} className="rounded bg-accent-soft px-1 font-semibold text-accent-text">
            {s.text}
            <span className="sr-only"> (brandul tău)</span>
          </mark>
        ) : (
          <span key={i} className="rounded border-b border-dashed border-border-strong px-0.5 font-medium">
            {s.text}
            <span className="sr-only"> (competitor)</span>
          </span>
        )
      })}
    </p>
  )
}

interface Props {
  brand: Brand
  answerId: string | null
  onClose: () => void
}

export function AnswerDrawer({ brand, answerId, onClose }: Props) {
  const providers = useProviders()
  const { state, reload } = useAsync(() => (answerId ? providers.ai.answer(brand.id, answerId) : Promise.resolve(null)), [providers, brand.id, answerId])
  if (!answerId) return null

  return (
    <Dialog open onClose={onClose} title="Răspuns AI" placement="right">
      {state.status === 'loading' && <div role="status" aria-label="Se încarcă răspunsul" className="h-48 rounded-lg bg-skeleton" />}
      {state.status === 'failed' && <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={reload} />}
      {state.status === 'done' && state.value && (state.value.kind === 'ready' ? <Detail brand={brand} a={state.value.data} /> : <ProviderProblem result={state.value} onRetry={reload} />)}
    </Dialog>
  )
}

function Detail({ brand, a }: { brand: Brand; a: AiAnswerDetail }) {
  const providers = useProviders()
  const o = OUTCOME_LABELS[a.outcome]
  const names = new Map<string, string>()
  for (const s of a.segments) if (s.kind === 'brand') names.set(s.entity_id, s.text)
  const list = (ids: string[]) => (ids.length ? ids.map((id) => names.get(id) ?? id).join(', ') : 'niciunul')
  const item: PvItemRef = { kind: 'ai_answer', id: a.id }
  const valid = VALID_OUTCOMES.has(a.outcome)

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h3 className="font-display text-[16px] font-semibold leading-snug">{a.question}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-text-2">
          <span className="font-medium text-text">{AI_ENGINE_LABELS[a.engine]}</span>
          <span className="font-mono text-[12px]">{formatDateTime(a.collected_at)}</span>
          <StatusChip tone={o.tone}>{o.label}</StatusChip>
          {a.pv_flag && (
            <span className="inline-flex items-center gap-1 text-pv">
              <FlagIcon size={13} weight="fill" aria-hidden="true" /> Marcat pentru farmacovigilență
            </span>
          )}
        </div>
        {a.collection_note && <p className="rounded-lg bg-neutral-soft px-3 py-2 text-[12.5px] leading-snug text-text-2">{a.collection_note}</p>}
      </header>

      {a.segments.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-[13.5px] leading-normal text-text">{o.explanation}</p>
      ) : (
        <section aria-label="Răspuns original, sanitizat de date personale" className="flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold">Răspuns original, sanitizat de date personale</h4>
          <AnswerText segments={a.segments} ownId={brand.id} />
          <p className="flex flex-wrap items-center gap-3 text-[12px] text-text-2">
            <span><mark className="rounded bg-accent-soft px-1 font-semibold text-accent-text">Brandul tău</mark></span>
            <span><span className="rounded border-b border-dashed border-border-strong px-0.5 font-medium text-text">Competitor</span></span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-text-2">Prezente</dt>
            <dd>{list(a.entities_present)}</dd>
            <dt className="text-text-2">Recomandate</dt>
            <dd>{list(a.entities_recommended)}</dd>
          </dl>
        </section>
      )}

      {a.citations.length > 0 && (
        <section aria-label="Citări" className="flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold">Citări</h4>
          <ol className="flex flex-col gap-2">
            {a.citations.map((c) => {
              const href = safeUrl(c.url)
              return (
                <li key={c.n} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-[12.5px]">
                  <span className="font-mono text-[11.5px] text-accent-text">[{c.n}]</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-text">{c.title}</span>
                    <span className="block font-mono text-[11.5px] text-text-2">{c.domain}</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
                        Deschide sursa originală
                      </a>
                    ) : (
                      <span className="text-text-3">URL indisponibil</span>
                    )}
                  </span>
                  {c.owned && <StatusChip tone="accent">Owned</StatusChip>}
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {valid && (
        <footer className="border-t border-border pt-4">
          <PharmacovigilanceButton item={item} flag={a.pv_flag} loadSnapshot={(i) => providers.mentions.pvPreview(brand.id, i)} onConfirm={(i) => providers.mentions.pvFlag(brand.id, i)} />
        </footer>
      )}
    </div>
  )
}
