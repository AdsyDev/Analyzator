import { useId, useState, type FormEvent } from 'react'
import type { SourceProviderId } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { useProviders } from '../../data/DataProvidersContext'
import { PROVIDER_LABELS } from '../../lib/sources'

/** Sursele cu conexiune prin cont; Import CSV nu are conexiune, ci fișiere. */
export const CONNECTABLE: readonly SourceProviderId[] = ['seomonitor', 'ga4', 'gsc', 'clarity', 'planable']

interface Props {
  brandId: string
  initialProvider?: SourceProviderId
  onCreated: () => void
}

export function AddConnection({ brandId, initialProvider, onCreated }: Props) {
  const providers = useProviders()
  const ids = [useId(), useId(), useId()] as const
  const [provider, setProvider] = useState<SourceProviderId>(initialProvider ?? 'clarity')
  const [account, setAccount] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const acc = account.trim()
    if (!acc || busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    const result = await providers.sources.createConnection(brandId, { provider, external_account_id: acc, display_name: name.trim() || null })
    setBusy(false)
    if (result.kind === 'ready') {
      setAccount('')
      setName('')
      setDone(true)
      onCreated()
    } else setError(result.kind === 'error' ? result.message : result.reason)
  }

  const field = 'h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'
  return (
    <form onSubmit={submit} aria-label="Adaugă conexiune" className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">Sursă</label>
          <select id={ids[0]} value={provider} onChange={(e) => setProvider(e.target.value as SourceProviderId)} className={field}>
            {CONNECTABLE.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p].name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">Cont sau proiect</label>
          <input id={ids[1]} value={account} onChange={(e) => setAccount(e.target.value)} placeholder="de ex. ID-ul proiectului" className={`${field} font-mono`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={ids[2]} className="text-[12.5px] font-semibold">Nume afișat (opțional)</label>
          <input id={ids[2]} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={account.trim() === ''}>Adaugă conexiunea</Button>
        <span className="text-[12px] text-text-3">Tokenul se setează după ce conexiunea există.</span>
      </div>
      <div aria-live="polite">
        {done && <p className="text-[12.5px] text-pos-text">Conexiune adăugată. Setează acum tokenul.</p>}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </form>
  )
}
