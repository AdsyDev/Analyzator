import { useId, useState, type FormEvent } from 'react'
import type { AirbyteAccount, AirbyteInspection, AirbyteOutcome, AirbyteTable, TenantConnection, TenantId } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { formatDate, formatDateTime, formatRange } from '../../lib/format'
import { CREDENTIAL_LABELS } from './labels'

const field = 'h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'

/** Verde = date găsite; galben = pană (starea cheii nu se schimbă); roșu = configurare greșită; gri = nu a rulat. */
export const AIRBYTE_OUTCOME_TONE: Record<AirbyteOutcome, ChipTone> = {
  ok: 'pos',
  budget_exhausted: 'neutral',
  dns_failed: 'warn',
  unreachable: 'warn',
  timeout: 'warn',
  database_error: 'warn',
  invalid_dsn: 'neg',
  tls_required: 'neg',
  host_not_allowed: 'neg',
  auth_failed: 'neg',
  database_not_found: 'neg',
  tls_failed: 'neg',
  permission_denied: 'neg',
  not_read_only: 'neg',
}

const LEVELS: Record<string, string> = { account: 'cont', campaign: 'campanie', adset: 'ad set', ad_group: 'ad group', ad: 'anunț', keyword: 'keyword' }
const TABLE_ERRORS: Record<NonNullable<AirbyteTable['error']>, string> = {
  timeout: 'nu a răspuns la timp; tabelul e probabil foarte mare',
  permission: 'utilizatorul nu are drept de citire pe tabel',
  failed: 'nu a putut fi citit',
  skipped: 'sărit: timpul inspecției s-a terminat',
}
const PLATFORM_NAMES: Record<AirbyteAccount['platform'], string> = { meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads' }

const period = (from: string | null, to: string | null) => (from && to ? (from === to ? formatDate(from) : formatRange(from, to)) : '—')
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString('ro-RO')} ${n % 100 === 0 || n % 100 >= 20 ? 'de ' : ''}${many}`)

const accountColumns: Column<AirbyteAccount>[] = [
  { key: 'platform', header: 'Platformă', sortValue: (a) => a.platform, render: (a) => PLATFORM_NAMES[a.platform] },
  {
    key: 'account',
    header: 'Cont',
    sortValue: (a) => a.name,
    render: (a) => (
      <span className="flex flex-col">
        <span>{a.name}</span>
        <span className="font-mono text-[11.5px] text-text-2">{a.account_id}</span>
      </span>
    ),
  },
  { key: 'period', header: 'Perioadă', sortValue: (a) => a.first_date, render: (a) => <span className="font-mono text-[12px]">{period(a.first_date, a.last_date)}</span> },
  { key: 'rows', header: 'Rânduri', align: 'right', sortValue: (a) => a.rows, render: (a) => a.rows.toLocaleString('ro-RO') },
  { key: 'synced', header: 'Sincronizat de Airbyte', sortValue: (a) => a.last_synced_at, render: (a) => <span className="font-mono text-[12px]">{a.last_synced_at ? formatDateTime(a.last_synced_at) : '—'}</span> },
]

/** Ce a găsit inspecția: tabelele pe platforme, conturile și metricile disponibile. */
export function AirbyteSummary({ inspection: r }: { inspection: AirbyteInspection }) {
  return (
    <div className="flex flex-col gap-3" data-outcome={r.outcome}>
      <p className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <StatusChip tone={AIRBYTE_OUTCOME_TONE[r.outcome]}>{r.outcome === 'ok' ? 'Date găsite' : r.outcome === 'budget_exhausted' ? 'Nu a rulat' : 'Problemă'}</StatusChip>
        <span>{r.message}</span>
      </p>
      {r.platforms.map((p) => (
        <section key={p.platform} aria-label={`Tabele ${p.label}`} className="flex flex-col gap-1.5">
          <h4 className="text-[13px] font-semibold">{p.label}</h4>
          <ul className="flex flex-col gap-1.5">
            {p.tables.map((t) => (
              <li key={`${t.schema}.${t.table}`} className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-snug">
                <span className="font-mono text-[12px]">{t.schema}.{t.table}</span>
                <span className="text-text-2">
                  {' · '}
                  {t.role === 'catalog' ? 'numele conturilor' : `raport pe ${LEVELS[t.level ?? ''] ?? t.level ?? 'cont'}`}
                  {t.error === null && t.accounts !== null && ` · ${plural(t.accounts, 'cont', 'conturi')}`}
                  {t.role === 'report' && t.error === null && ` · ${period(t.first_date, t.last_date)}`}
                  {t.last_synced_at && ` · sincronizat ${formatDateTime(t.last_synced_at)}`}
                </span>
                {t.error && <span className="block text-warn-text">Tabelul {TABLE_ERRORS[t.error]}.</span>}
                {t.metrics.length > 0 && (
                  <span className="block text-text-2">
                    Metrici: <span className="font-mono text-[11.5px]">{t.metrics.join(', ')}</span>
                  </span>
                )}
                {t.dimensions.length > 0 && (
                  <span className="block text-text-2">
                    Defalcări: <span className="font-mono text-[11.5px]">{t.dimensions.join(', ')}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {r.accounts.length > 0 && <SortableTable caption="Conturile găsite în Airbyte" columns={accountColumns} rows={r.accounts} rowKey={(a) => a.id} pageSize={10} emptyText="Niciun cont." />}
      {r.truncated && <p className="text-[12px] text-text-2">Rezultatul e parțial (prea multe tabele sau conturi, ori timpul inspecției s-a terminat).</p>}
      <p className="text-[12px] text-text-3">
        Inspecții azi: {r.calls_today} din {r.daily_limit}.{r.inspected_at ? ` Ultima: ${formatDateTime(r.inspected_at)}.` : ''}
      </p>
    </div>
  )
}

/**
 * Inspecția destinației (funcția server `airbyte`): butonul și rezultatul. Nu reîncarcă pagina după inspecție, ca
 * rezultatul să rămână vizibil; starea cheii din rezultat e cea nouă.
 */
export function AirbyteInspect({ connection }: { connection: TenantConnection }) {
  const providers = useProviders()
  const [inspecting, setInspecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspection, setInspection] = useState<AirbyteInspection | null>(null)

  async function inspect() {
    if (inspecting) return
    setInspecting(true)
    setError(null)
    const r = await providers.sources.inspectAirbyte(connection.id)
    setInspecting(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setInspection(r.data)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void inspect()} loading={inspecting}>Inspectează datele</Button>
        <span className="text-[12px] text-text-2">Deschide o conexiune read-only și citește doar catalogul și agregatele pe cont.</span>
      </div>
      <div aria-live="polite" className="flex flex-col gap-1.5">
        {inspection && <AirbyteSummary inspection={inspection} />}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </div>
  )
}

/**
 * Destinația Postgres Airbyte a clientului (E-6): connection string-ul unui utilizator read-only și, opțional,
 * certificatul autorității care a emis certificatul serverului. Pleacă o singură dată spre funcția server
 * `source-credentials`; inspecția (funcția server `airbyte`) arată ce tabele, conturi și metrici sunt disponibile.
 */
export function AirbyteKeyCard({ tenantId, connection, onChanged }: { tenantId: TenantId; connection: TenantConnection | null; onChanged: () => void }) {
  const providers = useProviders()
  const ids = [useId(), useId(), useId()] as const
  const [label, setLabel] = useState('')
  const [dsn, setDsn] = useState('')
  const [ca, setCa] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cred = CREDENTIAL_LABELS[connection?.credential_status ?? 'missing']
  const labelOk = connection !== null || /^.{2,120}$/.test(label.trim())
  const dsnOk = /^postgres(ql)?:\/\/\S+$/i.test(dsn.trim())
  const keySaved = connection !== null && connection.credential_status !== 'missing'

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!labelOk || !dsnOk || busy) return
    const value = ca.trim() ? JSON.stringify({ dsn: dsn.trim(), ca_cert: ca.trim() }) : dsn.trim()
    setBusy(true)
    setError(null)
    setSaved(false)
    let target = connection
    if (!target) {
      const created = await providers.sources.createTenantConnection(tenantId, { provider: 'airbyte_postgres', external_account_id: label.trim(), display_name: 'Airbyte (Postgres)' })
      if (created.kind !== 'ready') {
        setBusy(false)
        setDsn('')
        return setError(created.kind === 'error' ? created.message : created.reason)
      }
      target = created.data
    }
    const r = await providers.sources.setToken(target.id, value)
    // Câmpurile se golesc oricum: connection string-ul nu rămâne în interfață nici după o eroare.
    setDsn('')
    setCa('')
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setSaved(true)
    onChanged()
  }

  return (
    <article aria-label="Destinația Airbyte a clientului" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 shadow-1">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[14.5px] font-semibold leading-tight">Airbyte (destinația Postgres)</h3>
          <p className="text-[12.5px] text-text-2">Un utilizator read-only pe baza în care Airbyte scrie conturile Meta, Google Ads și TikTok; conturile site-ului se aleg la pasul 2.</p>
        </div>
        <StatusChip tone={cred.tone}>{cred.label}</StatusChip>
      </header>
      {connection && (
        <p className="text-[12.5px] text-text-2">
          <span className="font-mono text-[12px]">{connection.external_account_id}</span>
          {connection.credential_updated_at && <span className="font-mono text-[11.5px] text-text-3"> · connection string salvat {formatDateTime(connection.credential_updated_at)}</span>}
        </p>
      )}
      <form onSubmit={save} className="flex flex-col gap-3">
        {!connection && (
          <div className="flex flex-col gap-1">
            <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">Numele destinației</label>
            <input id={ids[0]} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="de ex. Airbyte AdSymphony" className={field} aria-describedby={`${ids[0]}-hint`} />
            <span id={`${ids[0]}-hint`} className="text-[12px] text-text-3">O etichetă, ca să recunoști destinația.</span>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">{keySaved ? 'Schimbă connection string-ul' : 'Connection string'}</label>
          <input
            id={ids[1]}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={dsn}
            onChange={(e) => setDsn(e.target.value)}
            placeholder="postgresql://analyzator_ro:parola@airbyte-db.exemplu.ro:5432/airbyte?sslmode=require"
            className={`${field} font-mono`}
            aria-invalid={dsn !== '' && !dsnOk}
          />
        </div>
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-text-2">Certificatul autorității (CA), dacă serverul nu folosește un certificat public</summary>
          <div className="mt-2 flex flex-col gap-1">
            <label htmlFor={ids[2]} className="text-[12.5px] font-semibold">Certificat CA (PEM)</label>
            <textarea id={ids[2]} value={ca} onChange={(e) => setCa(e.target.value)} rows={4} spellCheck={false} placeholder="-----BEGIN CERTIFICATE-----" className="rounded-[10px] border border-border-strong bg-surface px-3 py-2 font-mono text-[12px]" />
            <span className="text-[12px] text-text-3">Certificatul public al autorității care a emis certificatul serverului (nu cheia privată).</span>
          </div>
        </details>
        <span>
          <Button type="submit" variant="primary" loading={busy} disabled={!labelOk || !dsnOk}>Salvează</Button>
        </span>
        <p className="text-[12px] leading-snug text-text-3">
          Conexiunea e mereu criptată și verificată: serverul are nevoie de un nume de domeniu și de un certificat TLS valid pentru el. Ghid, inclusiv utilizatorul read-only: docs/connectors/airbyte.md.
        </p>
      </form>
      {keySaved && <AirbyteInspect connection={connection} />}
      <div aria-live="polite" className="flex flex-col gap-1.5">
        {saved && <p className="text-[12.5px] text-pos-text">Connection string salvat. Inspectează datele ca să vezi ce conturi și metrici sunt disponibile.</p>}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </article>
  )
}
