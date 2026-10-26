import { useId, useState, type FormEvent } from 'react'
import type { SourceConnection, SyncRun, ValidationOutcome } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { formatDateTime } from '../../lib/format'
import { PROVIDER_LABELS } from '../../lib/sources'
import { BUDGET_RESET_NOTE, CREDENTIAL_LABELS, OUTCOME_TONE, VALIDATABLE } from './labels'

/**
 * Conexiunile care folosesc cheia clientului (pasul 1 din cardul sursei), nu un token pe conexiune. Pentru ele contează
 * doar dacă cheia are acces la cont; textul spune ce trebuie făcut când accesul e refuzat.
 */
const ACCESS_FIX: Record<string, string> = {
  ga4: 'Adaugă service account-ul clientului ca Viewer în proprietatea GA4.',
  gsc: 'Adaugă service account-ul clientului ca utilizator în proprietatea Search Console.',
  planable: 'Tokenul Planable al clientului trebuie să aibă acces la acest workspace.',
  meta_ads: 'Atribuie contul de ads system user-ului din Business Manager.',
  google_ads: 'Contul trebuie să fie sub MCC-ul conectat la pasul 1.',
  tiktok_ads: 'Advertiserul trebuie să fie printre cele autorizate la pasul 1.',
  airbyte: 'Contul trebuie să apară în tabelele Airbyte văzute de utilizatorul read-only de la pasul 1.',
}

/** Sursele fără colectare încă: fără rulări, cardul spune asta, nu „se confirmă la prima colectare”. */
const NOT_COLLECTED_YET: Record<string, AccessState> = {
  airbyte: { tone: 'neutral', label: 'Colectare neactivă', text: 'Contul e legat de site. Colectarea din Airbyte în Paid Media nu e încă activă (E-6, etapa 2).' },
}
export const USES_TENANT_KEY: readonly string[] = Object.keys(ACCESS_FIX)

export interface AccessState {
  tone: ChipTone
  label: string
  text: string
}

const rowsLabel = (n: number) => (n === 1 ? '1 rând' : `${n.toLocaleString('ro-RO')} ${n % 100 === 0 || n % 100 >= 20 ? 'de ' : ''}rânduri`)

/**
 * Accesul cheii clientului la cont, din rulările conexiunii. Nu există un test separat: dovada e
 * ultima colectare care a scris date, iar un refuz de acces la ultima rulare are prioritate.
 */
export function accessFromRuns(provider: string, runs: SyncRun[]): AccessState {
  const sorted = [...runs].sort((a, b) => b.started_at.localeCompare(a.started_at))
  const latest = sorted[0]
  // `access_denied` = cheia refuzată; `permission_denied` = cheia merge, dar nu are drept pe acest cont (Meta, Ads).
  if (latest && (latest.error_codes.includes('access_denied') || latest.error_codes.includes('permission_denied'))) {
    return { tone: 'neg', label: 'Acces refuzat', text: `Colectarea din ${formatDateTime(latest.started_at)} a fost refuzată. ${ACCESS_FIX[provider] ?? ''}`.trim() }
  }
  const proof = sorted.find((r) => (r.status === 'succeeded' || r.status === 'partial') && (r.rows ?? 0) > 0)
  if (proof) {
    return { tone: 'pos', label: 'Acces confirmat', text: `Confirmat de colectarea din ${formatDateTime(proof.finished_at ?? proof.started_at)}: ${rowsLabel(proof.rows ?? 0)}.` }
  }
  if (latest) {
    return { tone: 'warn', label: 'Neconfirmat', text: `Colectarea din ${formatDateTime(latest.started_at)} nu a adus date, deci accesul nu e confirmat încă.` }
  }
  return NOT_COLLECTED_YET[provider] ?? { tone: 'neutral', label: 'Neverificat', text: 'Accesul se confirmă la prima colectare, după ce cheia clientului e salvată.' }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** `credential_updated_by` e un id de utilizator: nu avem nume în schemă, deci afișăm un id scurt, nu un nume presupus. */
const who = (v: string | null) => (v === null ? null : UUID.test(v) ? `utilizator ${v.slice(0, 8)}` : v)

interface Props {
  connection: SourceConnection
  /** Rulările acestei conexiuni, cele mai noi întâi (pentru accesul confirmat de colectare). */
  runs: SyncRun[]
  /** Reîncarcă lista după o schimbare de stare. */
  onChanged: () => void
}

/** O conexiune a site-ului: cu cheia clientului, doar accesul la cont; cu token propriu, tokenul și testul lui. */
export function ConnectionCard({ connection, runs, onChanged }: Props) {
  return USES_TENANT_KEY.includes(connection.provider) ? <TenantKeyConnectionCard connection={connection} runs={runs} /> : <TokenConnectionCard connection={connection} onChanged={onChanged} />
}

/** Contul site-ului citit cu cheia clientului: nu are token, test sau buget propriu, deci arată doar accesul. */
function TenantKeyConnectionCard({ connection: c, runs }: { connection: SourceConnection; runs: SyncRun[] }) {
  const label = PROVIDER_LABELS[c.provider].name
  const access = accessFromRuns(c.provider, runs)
  return (
    <article aria-label={`Conexiune ${label}${c.display_name ? ` · ${c.display_name}` : ''}`} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-1">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[14.5px] font-semibold leading-tight">{label}</h3>
          <p className="text-[12.5px] text-text-2">
            {c.display_name ? `${c.display_name} · ` : ''}
            <span className="font-mono text-[12px]">{c.external_account_id}</span>
          </p>
        </div>
        <StatusChip tone={access.tone}>{access.label}</StatusChip>
      </header>
      <p className={`text-[12.5px] leading-snug ${access.tone === 'neg' ? 'text-neg-text' : 'text-text-2'}`}>{access.text}</p>
    </article>
  )
}

/**
 * O conexiune cu token propriu (Clarity): starea credențialului, formularul de token (câmp parolă, golit după salvare,
 * tokenul nu se mai afișează) și testul conexiunii cu bugetul zilnic vizibil.
 */
function TokenConnectionCard({ connection: c, onChanged }: { connection: SourceConnection; onChanged: () => void }) {
  const providers = useProviders()
  const inputId = useId()
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<ValidationOutcome | null>(null)
  // După un test, bugetul consumat vine din răspuns; până atunci, din listă.
  const used = outcome?.calls_today ?? c.calls_today
  const budget = outcome?.daily_limit ?? c.daily_call_budget
  const exhausted = used >= budget
  const label = PROVIDER_LABELS[c.provider].name
  const cred = CREDENTIAL_LABELS[c.credential_status]
  const canValidate = VALIDATABLE.includes(c.provider)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (token.trim() === '' || saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    setOutcome(null)
    const result = await providers.sources.setToken(c.id, token)
    // Câmpul se golește oricum: tokenul nu rămâne în interfață nici după o eroare.
    setToken('')
    setSaving(false)
    if (result.kind === 'ready') {
      setSaved(true)
      onChanged()
    } else setError(result.kind === 'error' ? result.message : result.reason)
  }

  async function test() {
    if (testing || exhausted) return
    setTesting(true)
    setError(null)
    setSaved(false)
    const result = await providers.sources.validate(c.id)
    setTesting(false)
    if (result.kind === 'ready') {
      setOutcome(result.data)
      onChanged()
    } else setError(result.kind === 'error' ? result.message : result.reason)
  }

  return (
    <article aria-label={`Conexiune ${label}${c.display_name ? ` · ${c.display_name}` : ''}`} data-credential={c.credential_status} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[14.5px] font-semibold leading-tight">{label}</h3>
          <p className="text-[12.5px] text-text-2">
            {c.display_name ? `${c.display_name} · ` : ''}
            <span className="font-mono text-[12px]">{c.external_account_id}</span>
          </p>
        </div>
        <StatusChip tone={cred.tone}>{cred.label}</StatusChip>
      </header>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="text-text-3">Ultima testare</dt>
          <dd className="font-mono text-[11.5px]">{c.last_validated_at ? formatDateTime(c.last_validated_at) : 'Netestat'}</dd>
          {c.last_validation_error && <dd className="text-neg-text">{c.last_validation_error}</dd>}
        </div>
        <div>
          <dt className="text-text-3">Configurat de</dt>
          <dd>{who(c.credential_updated_by) ?? '—'}</dd>
          {c.credential_updated_at && <dd className="font-mono text-[11.5px] text-text-2">{formatDateTime(c.credential_updated_at)}</dd>}
        </div>
        <div>
          <dt className="text-text-3">Apeluri azi</dt>
          <dd className="font-mono text-[11.5px]">
            {used} / {budget}
          </dd>
        </div>
      </dl>

      <form onSubmit={save} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-[12.5px] font-semibold">
          {c.credential_status === 'missing' ? 'Setează tokenul' : 'Rotește tokenul'}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Lipește tokenul"
            className="h-9 min-w-[16rem] flex-1 rounded-[10px] border border-border-strong bg-surface px-3 font-mono text-[13px]"
          />
          <Button type="submit" variant="primary" loading={saving} disabled={token.trim() === ''}>
            Salvează tokenul
          </Button>
        </div>
        <p className="text-[12px] text-text-3">Tokenul nu se mai afișează după salvare; aplicația primește doar starea lui.</p>
      </form>

      {canValidate ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void test()} loading={testing} disabled={exhausted || c.credential_status === 'missing'}>
              Testează conexiunea
            </Button>
            <p className="text-[12.5px] text-text-2">
              Testarea consumă 1 din cele {budget} apeluri zilnice. Azi: {used} folosite.
            </p>
          </div>
          {c.credential_status === 'missing' && <p className="text-[12px] text-text-3">Setează mai întâi un token.</p>}
          {exhausted && <p className="text-[12px] text-text-2">{BUDGET_RESET_NOTE}</p>}
        </div>
      ) : (
        <p className="text-[12px] text-text-3">Testarea conexiunii nu este disponibilă pentru această sursă.</p>
      )}

      <div aria-live="polite" className="flex flex-col gap-1.5">
        {saved && <p className="text-[12.5px] text-pos-text">Token salvat. Testează conexiunea pentru a confirma că funcționează.</p>}
        {outcome && (
          <p className="flex flex-wrap items-center gap-2 text-[12.5px]" data-outcome={outcome.outcome}>
            <StatusChip tone={OUTCOME_TONE[outcome.outcome]}>{CREDENTIAL_LABELS[outcome.credential_status].label}</StatusChip>
            <span>{outcome.message}</span>
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-neg-text">
            {error}
          </p>
        )}
      </div>
    </article>
  )
}
