import { useId, useState, type ChangeEvent, type FormEvent } from 'react'
import type { TenantConnection, TenantId, ValidationOutcome } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDateTime } from '../../lib/format'
import { checkServiceAccount, type ServiceAccountCheck } from '../../lib/serviceAccount'
import { Resolved } from '../shared/Resolved'
import { CREDENTIAL_LABELS, OUTCOME_TONE } from './labels'

const field = 'h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'

/**
 * Conturile la nivel de client (un cont pentru toate brandurile clientului): cheia Google pentru GA4 și Search
 * Console, contul SEOmonitor și tokenul Planable. Cheia și tokenul pleacă o singură dată spre funcția server `source-credentials`;
 * nu se afișează și nu rămân în interfață.
 */
export function TenantAccounts({ tenantId, onChanged }: { tenantId: TenantId; onChanged: () => void }) {
  const providers = useProviders()
  const list = useAsync(() => providers.sources.tenantConnections(tenantId), [providers, tenantId])
  function changed() {
    list.reload()
    onChanged()
  }
  return (
    <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă conturile clientului" skeletonClass="h-40">
      {(conns) => (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <GoogleKeyCard tenantId={tenantId} connection={conns.find((c) => c.provider === 'google_service_account') ?? null} onChanged={changed} />
          <TokenAccountCard spec={SEOMONITOR} tenantId={tenantId} connection={conns.find((c) => c.provider === 'seomonitor') ?? null} onChanged={changed} />
          <TokenAccountCard spec={PLANABLE} tenantId={tenantId} connection={conns.find((c) => c.provider === 'planable_account') ?? null} onChanged={changed} />
        </div>
      )}
    </Resolved>
  )
}

function CardHeader({ title, subtitle, connection }: { title: string; subtitle: string; connection: TenantConnection | null }) {
  const cred = CREDENTIAL_LABELS[connection?.credential_status ?? 'missing']
  return (
    <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-[14.5px] font-semibold leading-tight">{title}</h3>
        <p className="text-[12.5px] text-text-2">{subtitle}</p>
      </div>
      <StatusChip tone={cred.tone}>{cred.label}</StatusChip>
    </header>
  )
}

function GoogleKeyCard({ tenantId, connection, onChanged }: { tenantId: TenantId; connection: TenantConnection | null; onChanged: () => void }) {
  const providers = useProviders()
  const inputId = useId()
  const [check, setCheck] = useState<ServiceAccountCheck | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedEmail, setSavedEmail] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const email = savedEmail ?? connection?.external_account_id ?? null

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null)
    setSavedEmail(null)
    const file = e.target.files?.[0]
    if (!file) return setCheck(null)
    if (file.size > 16_384) return setCheck({ ok: false, message: 'Fișierul e prea mare pentru o cheie de service account.' })
    setCheck(checkServiceAccount(await file.text()))
  }

  function reset() {
    // Cheia nu rămâne în interfață: nici în stare, nici în câmpul de fișier.
    setCheck(null)
    setFileKey((k) => k + 1)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!check?.ok || busy) return
    const key = check
    setBusy(true)
    setError(null)
    let target = connection
    if (!target) {
      const created = await providers.sources.createTenantConnection(tenantId, { provider: 'google_service_account', external_account_id: key.clientEmail, display_name: 'Google service account' })
      if (created.kind !== 'ready') {
        setBusy(false)
        reset()
        return setError(created.kind === 'error' ? created.message : created.reason)
      }
      target = created.data
    }
    const r = await providers.sources.setToken(target.id, key.compact)
    setBusy(false)
    reset()
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setSavedEmail(key.clientEmail)
    onChanged()
  }

  async function copy() {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const otherAccount = check?.ok && connection && check.clientEmail !== connection.external_account_id

  return (
    <article aria-label="Cheia Google a clientului" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1">
      <CardHeader title="Google (GA4 și Search Console)" subtitle="O cheie de service account pentru toate brandurile clientului." connection={connection} />
      {email && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5">
          <span className="text-[12px] text-text-3">Service account</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-[12.5px]">{email}</span>
            <Button variant="ghost" onClick={() => void copy()}>{copied ? 'Copiat' : 'Copiază adresa'}</Button>
          </span>
          <span className="text-[12px] leading-snug text-text-2">
            Adaug-o ca <strong>Viewer</strong> în GA4 (Property access management) și ca <strong>Restricted</strong> în Search Console (Users and permissions), pentru fiecare brand. Apoi adaugă proprietățile mai jos, pe fiecare brand.
          </span>
          {connection?.credential_updated_at && <span className="font-mono text-[11.5px] text-text-3">Cheie salvată {formatDateTime(connection.credential_updated_at)}</span>}
        </div>
      )}
      <form onSubmit={save} className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-[12.5px] font-semibold">
          {connection && connection.credential_status !== 'missing' ? 'Înlocuiește cheia' : 'Încarcă cheia JSON'}
        </label>
        <input key={fileKey} id={inputId} type="file" accept="application/json,.json" onChange={(e) => void onFile(e)} className="text-[12.5px] file:mr-3 file:h-8 file:rounded-[10px] file:border file:border-border-strong file:bg-surface file:px-3 file:text-[12.5px] file:text-text" />
        {check && !check.ok && <p role="alert" className="text-[12.5px] text-neg-text">{check.message}</p>}
        {check?.ok && (
          <p className="text-[12.5px] text-text-2">
            Cheie validă pentru <span className="font-mono">{check.clientEmail}</span>
            {check.projectId ? ` (proiect ${check.projectId})` : ''}.
          </p>
        )}
        {otherAccount && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-text">Cheia e pentru alt service account decât cel înregistrat ({connection.external_account_id}). Verifică că noul cont are acces în GA4 și Search Console; eticheta conexiunii rămâne cea veche.</p>}
        <span>
          <Button type="submit" variant="primary" loading={busy} disabled={!check?.ok}>Salvează cheia</Button>
        </span>
        <p className="text-[12px] text-text-3">Fișierul se verifică în browser și pleacă doar spre seiful serverului. Cheia nu se mai afișează; după salvare, șterge fișierul de pe calculator. Ghid: docs/connectors/google.md.</p>
      </form>
      <div aria-live="polite">
        {savedEmail && <p className="text-[12.5px] text-pos-text">Cheia a fost salvată. Prima rulare Google (manuală sau de marți) confirmă accesul.</p>}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </article>
  )
}

interface TokenAccountSpec {
  provider: 'seomonitor' | 'planable_account'
  aria: string
  title: string
  subtitle: string
  idLabel: string
  idPlaceholder: string
  idPattern: RegExp
  idHint: string
  tokenPlaceholder: string
  footnote: string
  savedNote: string
}

const SEOMONITOR: TokenAccountSpec = {
  provider: 'seomonitor',
  aria: 'Contul SEOmonitor al clientului',
  title: 'SEOmonitor',
  subtitle: 'Un cont pentru toate brandurile clientului; brandurile se despart prin grupurile de keywords.',
  idLabel: 'ID-ul companiei (company_id)',
  idPlaceholder: 'de ex. 4821',
  idPattern: /^\d+$/,
  idHint: 'Doar cifre.',
  tokenPlaceholder: 'Account Settings → Edit Profile → API Token',
  footnote: 'Datele intră pe branduri doar după maparea grupurilor SEOmonitor (Configurare → Grupuri SEOmonitor → brand). Ghid: docs/connectors/seomonitor.md.',
  savedNote: 'Token salvat. Testează conexiunea sau așteaptă prima rulare SEOmonitor.',
}

const PLANABLE: TokenAccountSpec = {
  provider: 'planable_account',
  aria: 'Contul Planable al clientului',
  title: 'Planable (social și Listening)',
  subtitle: 'Un token pentru toate workspace-urile clientului; workspace-ul fiecărui brand se adaugă mai jos, pe brand.',
  idLabel: 'Numele companiei în Planable',
  idPlaceholder: 'de ex. STADA România',
  idPattern: /^.{2,120}$/,
  idHint: 'O etichetă, ca să recunoști contul.',
  tokenPlaceholder: 'pln_… (Company settings → API tokens, scope Read)',
  footnote: 'Necesită plan Pro sau Enterprise. Ghid: docs/connectors/planable.md.',
  savedNote: 'Token salvat. Testează conexiunea pentru a confirma că funcționează.',
}

/** Un cont cu token (SEOmonitor, Planable): creare, rotirea tokenului și testul într-un singur apel de citire. */
function TokenAccountCard({ spec, tenantId, connection, onChanged }: { spec: TokenAccountSpec; tenantId: TenantId; connection: TenantConnection | null; onChanged: () => void }) {
  const providers = useProviders()
  const ids = [useId(), useId()] as const
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [outcome, setOutcome] = useState<ValidationOutcome | null>(null)
  const accountOk = connection !== null || spec.idPattern.test(account.trim())
  const ok = accountOk && token.trim() !== ''

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    const value = token
    setBusy(true)
    setError(null)
    setSaved(false)
    setOutcome(null)
    let target = connection
    if (!target) {
      const created = await providers.sources.createTenantConnection(tenantId, { provider: spec.provider, external_account_id: account.trim(), display_name: spec.title })
      if (created.kind !== 'ready') {
        setBusy(false)
        setToken('')
        return setError(created.kind === 'error' ? created.message : created.reason)
      }
      target = created.data
    }
    const r = await providers.sources.setToken(target.id, value)
    // Câmpul se golește oricum: tokenul nu rămâne în interfață nici după o eroare.
    setToken('')
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setSaved(true)
    onChanged()
  }

  async function test() {
    if (!connection || testing) return
    setTesting(true)
    setError(null)
    setSaved(false)
    const r = await providers.sources.validate(connection.id)
    setTesting(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setOutcome(r.data)
    onChanged()
  }

  return (
    <article aria-label={spec.aria} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1">
      <CardHeader title={spec.title} subtitle={spec.subtitle} connection={connection} />
      {connection && (
        <p className="text-[12.5px] text-text-2">
          <span className="font-mono text-[12px]">{connection.external_account_id}</span>
          {connection.credential_updated_at && <span className="font-mono text-[11.5px] text-text-3"> · token salvat {formatDateTime(connection.credential_updated_at)}</span>}
        </p>
      )}
      <form onSubmit={save} className="flex flex-col gap-3">
        {!connection && (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">{spec.idLabel}</label>
            <input id={ids[0]} value={account} onChange={(e) => setAccount(e.target.value)} placeholder={spec.idPlaceholder} className={`${field} font-mono`} aria-describedby={`${ids[0]}-hint`} />
            <span id={`${ids[0]}-hint`} className="text-[12px] text-text-3">{spec.idHint}</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">{connection && connection.credential_status !== 'missing' ? 'Rotește tokenul' : 'Token API'}</label>
          <div className="flex flex-wrap gap-2">
            <input id={ids[1]} type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder={spec.tokenPlaceholder} className={`${field} min-w-[16rem] flex-1 font-mono`} />
            <Button type="submit" variant="primary" loading={busy} disabled={!ok}>Salvează</Button>
          </div>
        </div>
        {connection && connection.credential_status !== 'missing' && (
          <span>
            <Button onClick={() => void test()} loading={testing}>Testează conexiunea</Button>
          </span>
        )}
        <p className="text-[12px] leading-snug text-text-3">{spec.footnote}</p>
      </form>
      <div aria-live="polite" className="flex flex-col gap-1.5">
        {saved && <p className="text-[12.5px] text-pos-text">{spec.savedNote}</p>}
        {outcome && (
          <p className="flex flex-wrap items-center gap-2 text-[12.5px]" data-outcome={outcome.outcome}>
            <StatusChip tone={OUTCOME_TONE[outcome.outcome]}>{CREDENTIAL_LABELS[outcome.credential_status].label}</StatusChip>
            <span>{outcome.message}</span>
          </p>
        )}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </article>
  )
}
