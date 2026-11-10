import { useId, useState, type FormEvent } from 'react'
import type { ActionTransition, Insight, InsightDraft, MetricDefinition, NewAction, NewRecommendation } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { lastCompleteDay } from '../../lib/period'

const field = 'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent'
const labelCls = 'text-[12.5px] font-semibold'

/**
 * Metricile care pot fi citate ca dovezi din editor. Lista e doar ordinea de afișare: apar numai cele care au
 * definiție în registru, cu numele de acolo. `ga4_active_users` lipsește intenționat (raport doar pe interval).
 */
export const EVIDENCE_KEYS: readonly string[] = [
  'ai_mention_rate', 'ai_owned_citation_rate', 'ai_sov',
  'seomonitor_visibility_latest', 'seomonitor_keywords_top3', 'seomonitor_keywords_top10',
  'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position',
  'ga4_sessions', 'ga4_engaged_sessions', 'ga4_key_events',
  'mentions_count',
  'google_ads_spend', 'meta_ads_spend', 'tiktok_ads_spend',
]

function ErrorNote({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{message}</p> : null
}

interface EditorProps {
  /** `null` = analiză nouă. */
  insight: Insight | null
  defaultPeriod: { from: string; to: string }
  definitions: MetricDefinition[]
  onSave: (draft: InsightDraft) => Promise<string | null>
  onClose: () => void
}

/**
 * Ciorna unei analize: constatarea, interpretarea, limitele și metricile citate ca dovezi. Salvează doar ciorna;
 * trimiterea în review și publicarea sunt pași separați, cu regulile lor pe server (ce lipsește vine ca mesaj).
 */
export function InsightEditor({ insight, defaultPeriod, definitions, onSave, onClose }: EditorProps) {
  const id = useId()
  const [title, setTitle] = useState(insight?.title ?? '')
  const [from, setFrom] = useState(insight?.period.from ?? defaultPeriod.from)
  const [to, setTo] = useState(insight?.period.to ?? defaultPeriod.to)
  const [summary, setSummary] = useState(insight?.summary ?? '')
  const [interpretation, setInterpretation] = useState(insight?.interpretation ?? '')
  const [limits, setLimits] = useState(insight?.limits ?? '')
  const [keys, setKeys] = useState<string[]>(insight?.evidence.map((e) => e.evidence_query.metric_key) ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const max = lastCompleteDay()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Analiza are nevoie de un titlu.')
    if (!from || !to || from > to) return setError('Alege o perioadă cu data de început înaintea celei de sfârșit.')
    setBusy(true)
    setError(null)
    const failed = await onSave({ title, period: { from, to }, summary, interpretation, limits, evidence_keys: keys })
    setBusy(false)
    if (failed) setError(failed)
  }

  const toggle = (k: string) => setKeys((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))

  return (
    <Dialog
      open
      onClose={onClose}
      title={insight ? 'Editează ciorna' : 'Analiză nouă'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Renunță</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>Salvează ciorna</Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className={labelCls}>Titlu</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={field} autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-from`} className={labelCls}>Perioada, de la</label>
            <input id={`${id}-from`} type="date" value={from} max={to || max} onChange={(e) => setFrom(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-to`} className={labelCls}>până la</label>
            <input id={`${id}-to`} type="date" value={to} min={from} max={max} onChange={(e) => setTo(e.target.value)} className={field} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-summary`} className={labelCls}>Constatare</label>
          <textarea id={`${id}-summary`} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} maxLength={20000} className={field} placeholder="Ce arată datele, cu cifrele din dovezi." />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-interp`} className={labelCls}>Interpretare</label>
          <textarea id={`${id}-interp`} value={interpretation} onChange={(e) => setInterpretation(e.target.value)} rows={3} maxLength={20000} className={field} placeholder="Ce credem că înseamnă. O coincidență în timp nu e o cauză." />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-limits`} className={labelCls}>Limite</label>
          <textarea id={`${id}-limits`} value={limits} onChange={(e) => setLimits(e.target.value)} rows={2} maxLength={20000} className={field} placeholder="Eșantion, acoperire, ce nu arată analiza." />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className={labelCls}>Dovezi: metrici citate</legend>
          <p className="text-[12px] leading-snug text-text-2">Valorile lor pe perioada analizei se îngheață la publicare, ca analiza să rămână reproductibilă.</p>
          {definitions.length === 0 ? (
            <p className="text-[12.5px] text-text-2">Registrul de metrici nu a putut fi citit; dovezile se pot adăuga după reîncărcare.</p>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {definitions.map((d) => (
                <label key={d.metric_key} className="flex cursor-pointer items-start gap-2 text-[13px]">
                  <input type="checkbox" checked={keys.includes(d.metric_key)} onChange={() => toggle(d.metric_key)} className="mt-0.5" />
                  <span>{d.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <ErrorNote message={error} />
      </form>
    </Dialog>
  )
}

interface ActionFormProps {
  insightTitle: string
  definitions: MetricDefinition[]
  /** Membrii activi ai agenției dintre care se poate alege responsabilul; gol = doar utilizatorul curent. */
  owners?: ReadonlyArray<{ id: string; name: string }>
  onSave: (action: NewAction) => Promise<string | null>
  onClose: () => void
}

/** O acțiune nouă pe o analiză: ce facem, până când, cu ce efort și ce indicator urmărim după. */
export function ActionForm({ insightTitle, definitions, owners = [], onSave, onClose }: ActionFormProps) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [effort, setEffort] = useState('')
  const [metric, setMetric] = useState('')
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Acțiunea are nevoie de un titlu.')
    setBusy(true)
    setError(null)
    const failed = await onSave({ title, owner_id: owner || null, due: due || null, effort: effort.trim() || null, tracked_metric_key: metric || null })
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Acțiune nouă"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Renunță</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>Adaugă acțiunea</Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-[12.5px] text-text-2">Din analiza „{insightTitle}”. {owners.length === 0 ? 'Responsabilul ești tu; c' : 'C'}lientul o vede după ce e agreată.</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className={labelCls}>Ce facem</label>
          <input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} className={field} autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-due`} className={labelCls}>Termen propus</label>
            <input id={`${id}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-effort`} className={labelCls}>Efort estimat</label>
            <input id={`${id}-effort`} value={effort} onChange={(e) => setEffort(e.target.value)} maxLength={120} placeholder="de ex. 2 zile" className={field} autoComplete="off" />
          </div>
        </div>
        {owners.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-owner`} className={labelCls}>Responsabil</label>
            <select id={`${id}-owner`} value={owner} onChange={(e) => setOwner(e.target.value)} className={field}>
              <option value="">Eu</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-metric`} className={labelCls}>KPI urmărit</label>
          <select id={`${id}-metric`} value={metric} onChange={(e) => setMetric(e.target.value)} className={field}>
            <option value="">Niciunul</option>
            {definitions.map((d) => (
              <option key={d.metric_key} value={d.metric_key}>{d.label}</option>
            ))}
          </select>
        </div>
        <ErrorNote message={error} />
      </form>
    </Dialog>
  )
}

interface RecommendationsProps {
  insight: Insight
  onAdd: (rec: NewRecommendation) => Promise<string | null>
  onDelete: (id: string) => Promise<string | null>
  onClose: () => void
}

/** Recomandările unei ciorne: problema, ce propunem, beneficiul așteptat și prioritatea (1–3). */
export function RecommendationsDialog({ insight, onAdd, onDelete, onClose }: RecommendationsProps) {
  const id = useId()
  const [problem, setProblem] = useState('')
  const [action, setAction] = useState('')
  const [benefit, setBenefit] = useState('')
  const [priority, setPriority] = useState<1 | 2 | 3>(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = insight.recommendations ?? []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!problem.trim() || !action.trim() || !benefit.trim()) return setError('Completează problema, recomandarea și beneficiul așteptat.')
    setBusy(true)
    setError(null)
    const failed = await onAdd({ problem, action, expected_benefit: benefit, priority })
    setBusy(false)
    if (failed) return setError(failed)
    setProblem('')
    setAction('')
    setBenefit('')
  }
  async function remove(recId: string) {
    setBusy(true)
    setError(await onDelete(recId))
    setBusy(false)
  }

  return (
    <Dialog open onClose={onClose} title="Recomandări" footer={<Button variant="ghost" onClick={onClose}>Închide</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-text-2">Pentru „{insight.title}”. Se pot schimba doar cât analiza e ciornă; clientul le vede după publicare.</p>
        {list.length === 0 ? (
          <p className="text-[13px] text-text-2">Nicio recomandare încă.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Recomandările analizei">
            {list.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.action}</span>
                  <span className="mt-0.5 block text-[12.5px] text-text-2">Prioritate {r.priority} · {r.problem}</span>
                </span>
                <Button variant="ghost" onClick={() => void remove(r.id)} disabled={busy} aria-label={`Șterge recomandarea: ${r.action}`}>Șterge</Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-problem`} className={labelCls}>Problema</label>
            <textarea id={`${id}-problem`} value={problem} onChange={(e) => setProblem(e.target.value)} rows={2} maxLength={5000} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-action`} className={labelCls}>Ce recomandăm</label>
            <textarea id={`${id}-action`} value={action} onChange={(e) => setAction(e.target.value)} rows={2} maxLength={5000} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-benefit`} className={labelCls}>Beneficiu așteptat</label>
            <textarea id={`${id}-benefit`} value={benefit} onChange={(e) => setBenefit(e.target.value)} rows={2} maxLength={5000} className={field} placeholder="Ce ne așteptăm să se schimbe și cum verificăm." />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-priority`} className={labelCls}>Prioritate</label>
            <select id={`${id}-priority`} value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)} className={field}>
              <option value={1}>1 (cea mai mare)</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <ErrorNote message={error} />
          <div>
            <Button variant="primary" type="submit" loading={busy}>Adaugă recomandarea</Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}

interface NoteProps {
  title: string
  label: string
  hint: string
  confirm: string
  onSave: (text: string) => Promise<string | null>
  onClose: () => void
}

/** Un pas care cere text: motivul returnării sau al anulării, rezultatul observat la măsurare. */
export function NoteDialog({ title, label, hint, confirm, onSave, onClose }: NoteProps) {
  const id = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return setError(`Completează: ${label.toLowerCase()}.`)
    setBusy(true)
    setError(null)
    const failed = await onSave(text)
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Renunță</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>{confirm}</Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-text`} className={labelCls}>{label}</label>
          <textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} className={field} />
          <p className="text-[12px] leading-snug text-text-2">{hint}</p>
        </div>
        <ErrorNote message={error} />
      </form>
    </Dialog>
  )
}

/** Textele pașilor unei acțiuni, pentru butoane și pentru dialogul care cere o notă. */
export const ACTION_STEP: Record<ActionTransition['to'], { label: string; done: string }> = {
  agreed: { label: 'Marchează agreată', done: 'Acțiunea e agreată; clientul o vede de acum.' },
  in_progress: { label: 'Începe lucrul', done: 'Acțiunea e în lucru.' },
  done: { label: 'Marchează finalizată', done: 'Acțiunea e finalizată; urmează măsurarea.' },
  measured: { label: 'Notează rezultatul', done: 'Rezultatul a fost notat.' },
  cancelled: { label: 'Anulează', done: 'Acțiunea a fost anulată.' },
}
