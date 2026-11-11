import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { AiReply, AiSettings, Brand, QueryContext, Role } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatInteger, formatRange } from '../../lib/format'
import { brandPath } from '../../lib/navigation'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { Documents } from './Documents'

/**
 * AdSy AI (Etapa 4, deciziile M): întrebări despre brand, cu răspunsuri verificate pe server față de dovezi, și cele trei
 * controale (chat, generare, afișare). Interfața nu cheamă niciun model: trimite întrebarea funcției server, care verifică
 * din nou accesul, controalele și dovezile.
 */
export function AssistantPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <Assistant brand={brand} ctx={ctx} role={user.role} />
}

function Assistant({ brand, ctx, role }: { brand: Brand; ctx: QueryContext; role: Role }) {
  const canManageSources = role === 'agency_admin'
  const providers = useProviders()
  const settings = useAsync(() => providers.assistant.settings(brand.id), [providers, brand.id])
  return (
    <Resolved state={settings.state} onRetry={settings.reload} loadingLabel="Se încarcă AdSy AI" skeletonClass="h-64">
      {(s) => (
        <div className="flex flex-col gap-5">
          <Chat brand={brand} ctx={ctx} settings={s} canManageSources={canManageSources} />
          <Documents brand={brand} role={role} />
          <Controls brand={brand} settings={s} onChanged={settings.reload} />
        </div>
      )}
    </Resolved>
  )
}

interface Turn {
  id: number
  question: string
  period: { from: string; to: string }
  reply: AiReply | null
  error: string | null
}

export const BLOCKED: Partial<Record<AiReply['status'], { title: string; text: string }>> = {
  not_configured: { title: 'AdSy AI nu e configurat încă', text: 'Serverul nu are un model configurat. Până atunci nu pleacă nicio cerere.' },
  budget_exhausted: { title: 'Plafonul lunar a fost atins', text: 'Brandul și-a consumat plafonul lunar de AdSy AI. Răspunsurile deja date rămân disponibile; întrebările noi pornesc luna viitoare sau după ridicarea plafonului.' },
  rate_limited: { title: 'Prea multe întrebări azi', text: 'Ai atins limita zilnică de întrebări. Încearcă din nou mâine.' },
  model_error: { title: 'AdSy AI nu a putut răspunde', text: 'Modelul nu a răspuns sau răspunsul a fost blocat. Întrebarea nu a fost pierdută: încearcă din nou.' },
  rejected: { title: 'Răspuns respins', text: 'Răspunsul modelului nu a respectat forma cerută, așa că nu îl arătăm.' },
  out_of_scope: { title: 'În afara datelor brandului', text: 'AdSy AI răspunde doar la întrebări despre datele acestui brand, din perioada aleasă.' },
  insufficient_evidence: { title: 'Dovezi insuficiente', text: 'Răspunsul nu a putut fi susținut cu dovezi din datele brandului, așa că nu îl arătăm ca pe o concluzie.' },
}

function Chat({ brand, ctx, settings, canManageSources }: { brand: Brand; ctx: QueryContext; settings: AiSettings; canManageSources: boolean }) {
  const providers = useProviders()
  const id = useId()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const server = useAsync(() => (settings.effective.chat ? providers.assistant.serverStatus(brand.id) : Promise.resolve(null)), [providers, brand.id, settings.effective.chat])
  const configured = server.state.status === 'done' && server.state.value?.kind === 'ready' ? server.state.value.data.configured : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (q.length < 3 || busy) return
    setBusy(true)
    const turn: Turn = { id: Date.now(), question: q, period: { from: ctx.period.from, to: ctx.period.to }, reply: null, error: null }
    setTurns((t) => [...t, turn])
    setQuestion('')
    const r = await providers.assistant.ask(ctx, q)
    setTurns((t) => t.map((x) => (x.id === turn.id ? { ...x, reply: r.kind === 'ready' ? r.data : null, error: r.kind === 'ready' ? null : r.kind === 'error' ? r.message : r.reason } : x)))
    setBusy(false)
  }

  // Dovada unei metrici: aceeași cerere ca pe cardul ei, ca sertarul să arate aceleași înregistrări.
  async function openMetric(key: string, label: string) {
    const bundle = await providers.metrics.metrics(ctx, [key])
    const item = bundle.items.find((m) => m.metric_key === key)
    if (item) setTarget({ page: 'AdSy AI', label, query: item.evidence_query, item })
  }

  const description = `Întrebări despre ${brand.name}, pe perioada aleasă (${formatRange(ctx.period.from, ctx.period.to)}). Fiecare răspuns e verificat față de datele brandului și rămâne o ipoteză până o validează echipa.`
  if (!settings.effective.chat) {
    return (
      <Section id="ai-chat" title="Întreabă AdSy AI" description={description}>
        <EmptyState
          compact
          title="AdSy AI e oprit"
          text={settings.policy.chat ? 'Ai oprit chatul din preferințele tale. Îl poți reporni mai jos.' : 'Chatul e oprit pentru acest brand prin politica brandului. Dashboardurile și analizele echipei rămân neschimbate.'}
        />
      </Section>
    )
  }
  if (configured === false) {
    return (
      <Section id="ai-chat" title="Întreabă AdSy AI" description={description}>
        <EmptyState compact title={BLOCKED.not_configured!.title} text={BLOCKED.not_configured!.text} />
      </Section>
    )
  }

  return (
    <Section id="ai-chat" title="Întreabă AdSy AI" description={description}>
      {turns.length > 0 && (
        <ol aria-label="Conversație" className="flex flex-col gap-4">
          {turns.map((t) => (
            <li key={t.id} className="flex flex-col gap-2">
              <p className="self-end rounded-xl bg-accent-soft px-3 py-2 text-[13.5px] text-accent-text">{t.question}</p>
              {t.error ? (
                <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{t.error}</p>
              ) : t.reply === null ? (
                <div role="status" aria-label="AdSy AI răspunde" className="h-16 rounded-xl bg-skeleton" />
              ) : (
                <Reply brandId={brand.id} reply={t.reply} period={t.period} onOpenMetric={(k, l) => void openMetric(k, l)} />
              )}
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={`${id}-q`} className="text-[12.5px] font-semibold">Întrebarea ta</label>
        <textarea
          id={`${id}-q`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="De exemplu: cum au evoluat sesiunile față de perioada anterioară?"
          className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" type="submit" loading={busy} disabled={question.trim().length < 3}>Întreabă</Button>
          <p className="text-[12px] leading-snug text-text-2">AdSy AI vede doar indicatorii, analizele publicate și documentele aprobate ale acestui brand. Nu da sfaturi medicale pe baza răspunsurilor.</p>
        </div>
      </form>
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={canManageSources} />
    </Section>
  )
}

export function Reply({ brandId, reply, period, onOpenMetric }: { brandId: string; reply: AiReply; period: { from: string; to: string }; onOpenMetric: (key: string, label: string) => void }) {
  if (reply.status === 'ai_off') {
    return <EmptyState compact title="AdSy AI e oprit" text={reply.blocked_by === 'preference' ? 'Ai oprit chatul din preferințele tale.' : 'Chatul e oprit pentru acest brand prin politica brandului.'} />
  }
  const a = reply.answer
  if (reply.status !== 'ok' || !a) {
    const b = BLOCKED[reply.status] ?? BLOCKED.model_error!
    return (
      <article aria-label="Răspuns AdSy AI" data-status={reply.status} className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warn">{b.title}</StatusChip>
        </div>
        <p className="text-[13px] leading-relaxed text-text-2">{b.text}</p>
        {a?.limitations && <p className="text-[13px] leading-relaxed"><strong className="font-semibold">Ce lipsește. </strong>{a.limitations}</p>}
      </article>
    )
  }
  return (
    <article aria-label="Răspuns AdSy AI" data-status="ok" className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="accent">Generat de AdSy AI</StatusChip>
        <StatusChip tone="neutral">Nevalidat de echipă</StatusChip>
        <span className="text-[12px] text-text-2">Perioada <span className="font-mono text-[11.5px] text-text">{formatRange(period.from, period.to)}</span></span>
      </div>
      <p className="text-[13.5px] leading-relaxed">{a.summary}</p>
      {a.evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Dovezi">
          <span className="text-[12.5px] font-semibold">Dovezi</span>
          {a.evidence.map((e) =>
            e.kind === 'metric' && e.metric_key ? (
              <button key={e.id} type="button" onClick={() => onOpenMetric(e.metric_key as string, e.label)} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] text-accent-text hover:bg-surface">
                {e.label}
              </button>
            ) : e.kind === 'document' ? (
              <Link key={e.id} to={{ pathname: brandPath(brandId, 'assistant'), hash: '#ai-documents' }} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] text-lav-text hover:bg-surface">
                Document aprobat: {e.label}
              </Link>
            ) : (
              <Link key={e.id} to={brandPath(brandId, 'insights')} className="rounded-full border border-border px-2.5 py-1 text-[12.5px] text-accent-text hover:bg-surface">
                Analiză: {e.label}
              </Link>
            ),
          )}
        </div>
      )}
      {a.limitations && <p className="text-[12.5px] leading-snug text-text-2"><strong className="font-semibold text-text">Limite. </strong>{a.limitations}</p>}
      {a.proposed_action && <p className="text-[12.5px] leading-snug text-text-2"><strong className="font-semibold text-text">Propunere pentru echipă (ipoteză). </strong>{a.proposed_action}</p>}
    </article>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 flex-none accent-[var(--accent)]" />
      <label htmlFor={id} className="flex flex-col text-[13.5px]">
        <span className="font-medium">{label}</span>
        <span className="text-[12.5px] leading-snug text-text-2">{hint}</span>
      </label>
    </div>
  )
}

function Controls({ brand, settings: s, onChanged }: { brand: Brand; settings: AiSettings; onChanged: () => void }) {
  const providers = useProviders()
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cap, setCap] = useState(String(s.policy.monthly_token_cap ?? 2_000_000))

  async function run(work: () => Promise<{ kind: 'ready' } | { kind: 'error'; message: string } | { kind: 'not_connected'; reason: string }>) {
    setBusy(true)
    setError(null)
    const r = await work()
    setBusy(false)
    if (r.kind === 'ready') onChanged()
    else setError(r.kind === 'error' ? r.message : r.reason)
  }
  const capValue = Number(cap)
  const policy = (change: Partial<{ chat: boolean; generation: boolean; display: boolean }>) =>
    run(() => providers.assistant.savePolicy(brand, { chat: s.policy.chat, generation: s.policy.generation, display: s.policy.display, monthly_token_cap: s.policy.monthly_token_cap ?? 2_000_000, ...change }))
  const preference = (change: Partial<{ chat: boolean; display: boolean }>) => run(() => providers.assistant.savePreference(brand, { ...s.preference, ...change }))

  return (
    <Section id="ai-controls" title="Controale AdSy AI" description="Politica brandului hotărăște ce e permis; preferința ta poate doar să restrângă. Cu totul oprit, dashboardurile și analizele echipei rămân neschimbate.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <fieldset disabled={busy} className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
          <legend className="px-1 text-[12.5px] font-semibold">Preferința ta</legend>
          <Toggle label="Chat" hint={s.policy.chat ? 'Poți pune întrebări lui AdSy AI pe acest brand.' : 'Oprit de politica brandului; preferința ta nu îl poate porni.'} checked={s.preference.chat} onChange={(v) => void preference({ chat: v })} />
          <Toggle label="Afișare" hint={s.policy.display ? 'Vezi conținutul generat de AdSy AI, marcat ca atare.' : 'Oprit de politica brandului; preferința ta nu îl poate porni.'} checked={s.preference.display} onChange={(v) => void preference({ display: v })} />
          <p className="text-[12.5px] text-text-2">
            Pentru tine acum: chat {s.effective.chat ? 'pornit' : 'oprit'}, afișare {s.effective.display ? 'pornită' : 'oprită'}, generare {s.effective.generation ? 'pornită' : 'oprită'}.
          </p>
        </fieldset>

        {s.can_edit_policy ? (
          <fieldset disabled={busy} className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3">
            <legend className="px-1 text-[12.5px] font-semibold">Politica brandului</legend>
            <Toggle label="Chat" hint="Utilizatorii brandului pot pune întrebări lui AdSy AI." checked={s.policy.chat} onChange={(v) => void policy({ chat: v })} />
            <Toggle label="Generare" hint="Echipa poate cere, din Analize, ciorne scrise de AdSy AI. Se publică doar după revizuire și au nevoie și de afișare." checked={s.policy.generation} onChange={(v) => void policy({ generation: v })} />
            <Toggle label="Afișare" hint="Conținutul generat de AdSy AI e vizibil utilizatorilor brandului." checked={s.policy.display} onChange={(v) => void policy({ display: v })} />
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-cap`} className="text-[12.5px] font-semibold">Plafon lunar (tokeni)</label>
                <input id={`${id}-cap`} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} className="w-44 rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] tabular-nums outline-none focus-visible:border-accent" />
              </div>
              <Button variant="secondary" disabled={!Number.isInteger(capValue) || capValue < 1 || capValue === s.policy.monthly_token_cap} onClick={() => void run(() => providers.assistant.savePolicy(brand, { chat: s.policy.chat, generation: s.policy.generation, display: s.policy.display, monthly_token_cap: capValue }))}>
                Salvează plafonul
              </Button>
            </div>
            {s.month_tokens !== null && (
              <p className="text-[12.5px] text-text-2">
                Consum luna aceasta: <span className="font-mono text-[12px] text-text">{formatInteger(s.month_tokens)}</span> din <span className="font-mono text-[12px] text-text">{formatInteger(s.policy.monthly_token_cap ?? 0)}</span> tokeni.
              </p>
            )}
          </fieldset>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3">
            <p className="text-[12.5px] font-semibold">Politica brandului</p>
            <ul className="flex flex-col gap-1 text-[13px]">
              {([['Chat', s.policy.chat], ['Generare', s.policy.generation], ['Afișare', s.policy.display]] as const).map(([name, on]) => (
                <li key={name} className="flex items-center gap-2">
                  <span className="w-20">{name}</span>
                  <StatusChip tone={on ? 'pos' : 'neutral'}>{on ? 'Permis' : 'Oprit'}</StatusChip>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-text-2">Politica o stabilește administratorul agenției.</p>
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
    </Section>
  )
}
