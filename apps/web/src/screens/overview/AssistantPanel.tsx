import { PaperPlaneRightIcon, SparkleIcon, XIcon } from '@phosphor-icons/react'
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AiReply, Brand, Insight, ProviderResult, QueryContext } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync, type AsyncState } from '../../data/useAsync'
import { brandPath } from '../../lib/navigation'
import { BLOCKED, Reply } from '../assistant/AssistantPage'
import type { EvidenceTarget } from '../shared/EvidenceHost'
import { latestPublished, opportunitiesFrom } from './InsightSections'

interface Props {
  brand: Brand
  ctx: QueryContext
  /** Perioada și comparația din URL, păstrate la deschiderea paginii AdSy AI. */
  search: string
  insights: AsyncState<ProviderResult<Insight[]>>
  onOpen: (target: EvidenceTarget) => void
  onClose: () => void
}

/**
 * Sidebarul AdSy AI din Overview (macheta din propunere). Se montează doar cât e deschis din comutatorul „AI insights”
 * de lângă titlul paginii: pașii recomandați din ultima analiză publicată de echipă și o întrebare rapidă, care trece
 * prin aceeași funcție server ca pagina AdSy AI. Deschiderea și închiderea nu schimbă nicio setare: politica brandului și
 * preferința personală se gestionează din pagina AdSy AI.
 */
export function AssistantPanel({ brand, ctx, search, insights, onOpen, onClose }: Props) {
  const providers = useProviders()
  const id = useId()
  const settings = useAsync(() => providers.assistant.settings(brand.id), [providers, brand.id])
  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState<{ question: string; period: { from: string; to: string }; reply: AiReply | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  const s = settings.state.status === 'done' && settings.state.value.kind === 'ready' ? settings.state.value.data : null
  const problem = settings.state.status === 'failed' ? settings.state.message : settings.state.status === 'done' && settings.state.value.kind !== 'ready' ? (settings.state.value.kind === 'error' ? settings.state.value.message : settings.state.value.reason) : null
  const steps = insights.status === 'done' && insights.value.kind === 'ready' ? opportunitiesFrom(latestPublished(insights.value.data)) : []
  const assistantHref = `${brandPath(brand.id, 'assistant')}${search}`

  async function submit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 3 || busy) return
    setBusy(true)
    setAsked({ question: q, period: { from: ctx.period.from, to: ctx.period.to }, reply: null, error: null })
    setQuestion('')
    const r = await providers.assistant.ask(ctx, q)
    setAsked((a) => (a ? { ...a, reply: r.kind === 'ready' ? r.data : null, error: r.kind === 'ready' ? null : r.kind === 'error' ? r.message : r.reason } : a))
    setBusy(false)
  }

  async function openMetric(key: string, label: string) {
    const bundle = await providers.metrics.metrics(ctx, [key])
    const item = bundle.items.find((m) => m.metric_key === key)
    if (item) onOpen({ page: 'Overview', label, query: item.evidence_query, item })
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    onClose()
  }

  return (
    <aside aria-label="AdSy AI" onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span aria-hidden="true" className="grid size-8 flex-none place-items-center rounded-[10px] bg-accent-soft text-accent-text">
          <SparkleIcon size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em]">AdSy AI</h2>
          <p className="text-[12px] text-text-2">Asistent de brand intelligence</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Închide AdSy AI" className="grid size-8 flex-none place-items-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text">
          <XIcon size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
        {settings.state.status === 'loading' && <div role="status" aria-label="Se încarcă AdSy AI" className="h-24 flex-none rounded-xl bg-skeleton" />}
        {problem && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{problem}</p>}

        <section aria-labelledby={`${id}-steps`} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-3">
          <h3 id={`${id}-steps`} className="text-[13px] font-semibold">Pașii recomandați</h3>
          {steps.length === 0 ? (
            <p className="text-[12.5px] leading-snug text-text-2">{insights.status === 'loading' ? 'Se încarcă…' : 'Ultima analiză publicată de echipă nu are acțiuni deschise.'}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {steps.map((a, i) => (
                <li key={a.id} className="flex items-baseline gap-2.5 py-1.5 text-[13px]">
                  <span aria-hidden="true" className="flex-none rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent-text">{String(i + 1).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 leading-snug">{a.title}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11.5px] text-text-2">Din analiza echipei AdSymphony, nu generate automat. <a href="#opportunities" className="font-medium text-accent-text hover:underline">Vezi prioritățile</a></p>
        </section>

        {s && !s.effective.chat && (
          <p className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[12.5px] leading-snug text-text-2">
            <strong className="font-semibold text-text">AdSy AI e oprit. </strong>
            {s.policy.chat ? (
              <>Ai oprit chatul din preferințele tale. Îl repornești din pagina <Link to={assistantHref} className="font-medium text-accent-text hover:underline">AdSy AI</Link>.</>
            ) : (
              'Chatul e oprit pentru acest brand prin politica brandului. Dashboardul și analizele echipei rămân neschimbate.'
            )}
          </p>
        )}

        {s?.effective.chat && asked && (
          <div className="flex flex-col gap-2">
            <p className="self-end rounded-xl bg-accent-soft px-3 py-2 text-[13px] text-accent-text">{asked.question}</p>
            {asked.error ? (
              <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{asked.error}</p>
            ) : asked.reply === null ? (
              <div role="status" aria-label="AdSy AI răspunde" className="h-16 rounded-xl bg-skeleton" />
            ) : asked.reply.status === 'not_configured' ? (
              <p className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[12.5px] leading-snug text-text-2"><strong className="font-semibold text-text">{BLOCKED.not_configured!.title}. </strong>{BLOCKED.not_configured!.text}</p>
            ) : (
              <Reply brandId={brand.id} reply={asked.reply} period={asked.period} onOpenMetric={(k, l) => void openMetric(k, l)} />
            )}
          </div>
        )}
      </div>

      {s?.effective.chat && (
        <section aria-labelledby={`${id}-ask`} className="flex flex-none flex-col gap-2 border-t border-border px-4 py-3.5">
          <h3 id={`${id}-ask`} className="sr-only">Întrebare rapidă</h3>
          <form onSubmit={submit} className="flex items-end gap-2" noValidate>
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-q`} className="sr-only">Întreabă AdSy AI</label>
              <input id={`${id}-q`} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} placeholder="Întreabă AdSy AI…" className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent" />
            </div>
            <button type="submit" disabled={busy || question.trim().length < 3} aria-label="Trimite întrebarea" className="grid size-[38px] flex-none place-items-center rounded-lg bg-accent-btn text-on-accent disabled:opacity-50">
              <PaperPlaneRightIcon size={18} aria-hidden="true" weight="fill" />
            </button>
          </form>
          <p className="text-[11.5px] leading-snug text-text-2">
            Răspunsurile sunt verificate față de datele brandului și rămân ipoteze până le validează echipa. <Link to={assistantHref} className="font-medium text-accent-text hover:underline">Deschide AdSy AI</Link>
          </p>
        </section>
      )}
    </aside>
  )
}
