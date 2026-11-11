import { useId, useState, type FormEvent } from 'react'
import type { NewPaidBudget, PaidBudget, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import type { AsyncState } from '../../data/useAsync'
import { formatCurrency, formatDate, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

function Bar({ label, valueText, pct, tone }: { label: string; valueText: string; pct: number; tone: 'accent' | 'neutral' }) {
  const width = Math.min(100, Math.max(0, pct))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="flex-1" />
        <span className="tabular-nums text-text-2">{valueText}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={valueText} className="h-2 overflow-hidden rounded-full bg-neutral-soft">
        <div className={tone === 'accent' ? 'h-full rounded-full bg-accent' : 'h-full rounded-full bg-c1'} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

/** Scrierea bugetului, pentru echipa agenției. Fiecare funcție întoarce mesajul de eroare sau `null` la reușită. */
export interface BudgetEditing {
  defaultPeriod: { from: string; to: string }
  defaultCurrency: string
  onSave: (budget: NewPaidBudget) => Promise<string | null>
  onDelete: (id: string) => Promise<string | null>
}

interface Props {
  state: AsyncState<ProviderResult<PaidBudget>>
  onRetry: () => void
  /** Lipsește pentru client: vede bugetul aprobat, fără să îl poată schimba. */
  editing?: BudgetEditing
}

/**
 * Buget și pacing: spend cumulat față de bugetul aprobat și zilele trecute față de zilele planificate.
 * Progresul liniar e un reper, nu un verdict: cele două procente se arată separat, fără o judecată automată.
 */
export function BudgetSection({ state, onRetry, editing }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove(id: string) {
    if (!editing) return
    setBusy(true)
    setError(null)
    const failed = await editing.onDelete(id)
    setBusy(false)
    if (failed) setError(failed)
  }

  return (
    <Section id="budget" title="Buget și pacing" description="Spend cumulat față de bugetul aprobat introdus de agenție. Progresul liniar e un reper, nu un verdict.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă bugetul" skeletonClass="h-32">
        {(b) => (
          <div className="flex flex-col gap-4">
            {b.approved_budget === null ? (
              <EmptyState compact title="Fără buget aprobat" text="Nu există un buget introdus pentru perioada aleasă, deci nu putem arăta pacing-ul." />
            ) : (
              <>
                <p className="text-[12.5px] text-text-2">
                  Plan: <span className="font-mono text-[12px] text-text">{formatDate(b.plan_from)} - {formatDate(b.plan_to)}</span>
                  {b.plan_note && <> · {b.plan_note}</>}
                  {b.data_as_of && <> · cost până la <span className="font-mono text-[12px] text-text">{formatDate(b.data_as_of)}</span></>}
                </p>
                {b.currency_mismatch ? (
                  <p role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn-text">
                    Costul colectat e în altă monedă decât bugetul ({b.currency}), deci nu îl adunăm și nu calculăm procentul. Bugetul aprobat: {formatCurrency(b.approved_budget, b.currency)}.
                  </p>
                ) : (
                  <Bar
                    label="Spend față de buget"
                    tone="accent"
                    pct={b.spend_pct ?? 0}
                    valueText={`${formatCurrency(b.spent, b.currency) ?? 'Fără date'} din ${formatCurrency(b.approved_budget, b.currency)} (${formatMetricValue(b.spend_pct, 'percent') ?? 'Fără date'})`}
                  />
                )}
                <Bar label="Zile trecute din plan" tone="neutral" pct={b.time_pct} valueText={`${b.elapsed_days} din ${b.planned_days} zile (${formatMetricValue(b.time_pct, 'percent')})`} />
              </>
            )}
            {editing && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setOpen(true)}>{b.approved_budget === null ? 'Adaugă buget' : 'Buget nou'}</Button>
                {b.id && <Button variant="ghost" loading={busy} onClick={() => void remove(b.id as string)}>Șterge planul</Button>}
                {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
              </div>
            )}
          </div>
        )}
      </Resolved>
      {editing && open && <BudgetDialog editing={editing} onClose={() => setOpen(false)} />}
    </Section>
  )
}

const field = 'w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13.5px] text-text outline-none focus-visible:border-accent'
const labelCls = 'text-[12.5px] font-semibold'

/** Un plan nou. Planurile nu se modifică: la suprapunere, e în vigoare cel introdus cel mai recent. */
function BudgetDialog({ editing, onClose }: { editing: BudgetEditing; onClose: () => void }) {
  const id = useId()
  const [from, setFrom] = useState(editing.defaultPeriod.from)
  const [to, setTo] = useState(editing.defaultPeriod.to)
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(editing.defaultCurrency)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount.replace(',', '.'))
    if (!from || !to || from > to) return setError('Alege un interval cu data de început înaintea celei de sfârșit.')
    if (!Number.isFinite(value) || value <= 0) return setError('Suma trebuie să fie un număr mai mare ca zero.')
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) return setError('Moneda are trei litere, de exemplu RON sau EUR.')
    setBusy(true)
    setError(null)
    const failed = await editing.onSave({ plan_from: from, plan_to: to, amount: value, currency: currency.trim().toUpperCase(), note: note.trim() || null })
    setBusy(false)
    if (failed) return setError(failed)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Buget aprobat"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Renunță</Button>
          <Button variant="primary" type="submit" form={`${id}-form`} loading={busy}>Salvează bugetul</Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-from`} className={labelCls}>De la</label>
            <input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-to`} className={labelCls}>Până la</label>
            <input id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-amount`} className={labelCls}>Buget aprobat</label>
            <input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-currency`} className={labelCls}>Monedă</label>
            <input id={`${id}-currency`} value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className={`${field} uppercase`} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-note`} className={labelCls}>Notă (opțional)</label>
          <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={field} />
          <p className="text-[12px] leading-snug text-text-2">Bugetul acoperă toate platformele brandului și e vizibil clientului. Costul se compară doar în aceeași monedă.</p>
        </div>
        {error && <p role="alert" className="rounded-lg bg-neg-soft px-3 py-2 text-[12.5px] leading-snug text-neg-text">{error}</p>}
      </form>
    </Dialog>
  )
}
