import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeftIcon, CaretDownIcon, CaretUpIcon, CheckCircleIcon, CircleHalfIcon, ClockIcon, PlugsIcon, WarningCircleIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { Client, ClientSpace, DiscoverKind, SourceConnection, SourceProviderId, SourceState, SourceStatusInfo, SyncRun, TenantConnection, TenantProviderId } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate, formatDateTime } from '../../lib/format'
import { adminPath, sitePath } from '../../lib/navigation'
import { normalizeDomain } from '../../lib/slug'
import { PROVIDER_DESCRIPTIONS, PROVIDER_LABELS, runSourcesFor, sourceName } from '../../lib/sources'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { AddConnection } from './AddConnection'
import { AirbyteInspect } from './AirbyteKeyCard'
import { SeomonitorCampaigns } from './SeomonitorCampaigns'
import { ConnectionCard } from './ConnectionCard'
import { CREDENTIAL_LABELS, SYNC_LABELS } from './labels'
import { TenantAccountCard } from './TenantAccounts'

const field = 'h-9 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'

/**
 * Sursele unui site, în ordinea din spec. `tenant` = cheia de client de care are nevoie sursa (salvată o dată,
 * refolosită de toate site-urile clientului); `brand` = sursa are o conexiune proprie a site-ului (proprietate,
 * workspace, cont de ads). SEOmonitor nu are conexiune pe site: datele se despart prin maparea grupurilor.
 */
interface SiteSource {
  provider: SourceProviderId
  tenant: TenantProviderId | null
  brand: boolean
}

export const SITE_SOURCES: readonly SiteSource[] = [
  { provider: 'ga4', tenant: 'google_service_account', brand: true },
  { provider: 'gsc', tenant: 'google_service_account', brand: true },
  { provider: 'clarity', tenant: null, brand: true },
  { provider: 'seomonitor', tenant: 'seomonitor', brand: false },
  { provider: 'planable', tenant: 'planable_account', brand: true },
  { provider: 'meta_ads', tenant: 'meta_account', brand: true },
  { provider: 'google_ads', tenant: 'google_ads_account', brand: true },
  { provider: 'tiktok_ads', tenant: 'tiktok_account', brand: true },
  { provider: 'airbyte', tenant: 'airbyte_postgres', brand: true },
  { provider: 'csv_import', tenant: null, brand: false },
]

/** Sursele cu selector: contul site-ului se alege din lista văzută de cheia clientului. */
const DISCOVER_KIND: Partial<Record<SourceProviderId, DiscoverKind>> = { ga4: 'ga4', gsc: 'gsc', planable: 'planable', meta_ads: 'meta_ads', airbyte: 'airbyte' }
/** Sursele cu mai multe conturi pe același site (Airbyte: câte un cont de ads pe platformă). */
const MULTI_ACCOUNT: readonly SourceProviderId[] = ['airbyte']

const STATE: Record<SourceState, { label: string; tone: ChipTone; icon: ReactNode }> = {
  connected: { label: 'Conectat', tone: 'pos', icon: <CheckCircleIcon size={11} weight="bold" aria-hidden="true" /> },
  partial: { label: 'Parțial', tone: 'warn', icon: <CircleHalfIcon size={11} weight="bold" aria-hidden="true" /> },
  stale: { label: 'Învechit', tone: 'neutral', icon: <ClockIcon size={11} weight="bold" aria-hidden="true" /> },
  error: { label: 'Eroare', tone: 'neg', icon: <WarningCircleIcon size={11} weight="bold" aria-hidden="true" /> },
  not_connected: { label: 'Neconectat', tone: 'neutral', icon: <PlugsIcon size={11} weight="bold" aria-hidden="true" /> },
}

/** Ce conține pasul „cheia clientului”, per cont. */
const TENANT_STEP: Record<TenantProviderId, string> = {
  google_service_account: 'Cheia Google (service account) a clientului',
  seomonitor: 'Contul SEOmonitor al clientului',
  planable_account: 'Tokenul Planable al clientului',
  meta_account: 'Tokenul Meta (system user) al clientului',
  google_ads_account: 'Contul Google Ads (MCC) al clientului',
  tiktok_account: 'Contul TikTok for Business al clientului',
  airbyte_postgres: 'Destinația Postgres Airbyte a clientului',
}

const duration = (r: SyncRun): string => {
  if (!r.finished_at) return '—'
  const s = Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

/** Motivul unei rulări parțiale sau eșuate; codul brut doar dacă nu există o explicație. */
const why = (r: SyncRun): string | null => r.reason ?? (r.status === 'failed' || r.status === 'partial' ? r.error : null)

const runColumns: Column<SyncRun>[] = [
  { key: 'source', header: 'Sursă', sortValue: (r) => sourceName(r.provider), render: (r) => sourceName(r.provider) },
  { key: 'started', header: 'Început', sortValue: (r) => r.started_at, render: (r) => <span className="font-mono text-[12px]">{formatDateTime(r.started_at)}</span> },
  { key: 'range', header: 'Perioadă', sortValue: (r) => r.range_from, render: (r) => <span className="font-mono text-[12px]">{formatDate(r.range_from)}{r.range_to !== r.range_from ? ` – ${formatDate(r.range_to)}` : ''}</span> },
  { key: 'duration', header: 'Durată', render: (r) => <span className="font-mono text-[12px]">{duration(r)}</span> },
  { key: 'rows', header: 'Rânduri', align: 'right', sortValue: (r) => r.rows, render: (r) => (r.rows === null ? '—' : r.rows.toLocaleString('ro-RO')) },
  {
    key: 'status',
    header: 'Status',
    sortValue: (r) => r.status,
    render: (r) => (
      <span className="flex flex-col gap-0.5">
        <StatusChip tone={SYNC_LABELS[r.status].tone}>{SYNC_LABELS[r.status].label}</StatusChip>
        {why(r) && <span className={`text-[12px] ${r.status === 'failed' ? 'text-neg-text' : 'text-text-2'}`}>{why(r)}</span>}
      </span>
    ),
  },
]

/** Motivele din întoarcerea OAuth (funcția server `oauth`), în română. */
export const OAUTH_REASONS: Record<string, string> = {
  state_invalid: 'Link de conectare expirat sau deja folosit. Pornește din nou conectarea.',
  denied: 'Autorizarea a fost refuzată la furnizor.',
  forbidden: 'Doar agency_admin al clientului poate conecta conturi.',
  code_missing: 'Furnizorul nu a trimis codul de autorizare.',
  exchange_failed: 'Furnizorul a refuzat schimbul codului pe token. Reîncearcă; dacă persistă, verifică aplicația (ID, secret, redirect URI).',
  no_refresh_token: 'Google nu a dat acces permanent (refresh token). Reîncearcă și acceptă toate permisiunile.',
  scope_missing: 'Permisiunea Google Ads nu a fost acordată. Reîncearcă și bifează accesul la Google Ads.',
  internal: 'Conectarea nu a reușit din cauza unei erori a serverului. Reîncearcă.',
}
const OAUTH_NAMES: Record<string, string> = { google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads' }

/** Mesajul de la întoarcerea OAuth; parametrii se scot din adresă după afișare. */
function OAuthReturn() {
  const [params, setParams] = useSearchParams()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    const provider = params.get('oauth')
    const result = params.get('result')
    if (!provider || !result || !(provider in OAUTH_NAMES)) return
    const name = OAUTH_NAMES[provider]
    setMessage(result === 'ok' ? { ok: true, text: `${name} a fost conectat.` } : { ok: false, text: `${name} nu a fost conectat. ${OAUTH_REASONS[params.get('reason') ?? ''] ?? OAUTH_REASONS.internal}` })
    const next = new URLSearchParams(params)
    for (const k of ['oauth', 'result', 'reason']) next.delete(k)
    // Cardul sursei rămâne deschis, ca să se vadă pasul următor (contul site-ului).
    next.set('source', provider)
    setParams(next, { replace: true })
  }, [params, setParams])
  if (!message) return null
  return (
    <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'rounded-lg bg-pos-soft px-3 py-2 text-[13px] text-pos-text' : 'rounded-lg bg-neg-soft px-3 py-2 text-[13px] text-neg-text'}>
      {message.text}
    </p>
  )
}

/**
 * `/admin/sources` (vechea pagină, încă ținta întoarcerii OAuth din funcția server): duce la pagina site-ului
 * ales în topbar, cu aceiași parametri.
 */
export function SourcesRedirect() {
  const { activeBrand } = useLayout()
  const [params] = useSearchParams()
  if (!activeBrand) return <Navigate to={adminPath('clients')} replace />
  const search = params.toString()
  return <Navigate to={`${sitePath(activeBrand.id)}${search ? `?${search}` : ''}`} replace />
}

/** Administrare → Clienți și site-uri → un site (doar `agency_admin`): detaliile site-ului, sursele lui și sincronizările. */
export function SitePage() {
  const { brandId } = useParams()
  const providers = useProviders()
  const list = useAsync(() => providers.clients.list(), [providers])
  return (
    <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă site-ul" skeletonClass="h-64">
      {(clients) => {
        const client = clients.find((c) => c.spaces.some((s) => s.id === brandId))
        const space = client?.spaces.find((s) => s.id === brandId)
        if (!client || !space) return <EmptyState title="Site negăsit" text="Site-ul nu există sau nu ai acces la el." />
        return <SiteContent key={space.id} client={client} space={space} onChanged={list.reload} />
      }}
    </Resolved>
  )
}

function SiteContent({ client, space, onChanged }: { client: Client; space: ClientSpace; onChanged: () => void }) {
  const providers = useProviders()
  const { selectBrand } = useLayout()
  const statuses = useAsync(() => providers.sources.statuses(space.id), [providers, space.id])
  const connections = useAsync(() => providers.sources.connections(space.id), [providers, space.id])
  const tenant = useAsync(() => providers.sources.tenantConnections(client.id), [providers, client.id])
  const runs = useAsync(() => providers.sources.syncRuns(space.id), [providers, space.id])

  // Topbar-ul urmează site-ul deschis (doar un site activ apare în selector).
  useEffect(() => {
    if (space.status === 'active') selectBrand(space.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space.id, space.status])

  function refresh() {
    statuses.reload()
    connections.reload()
    tenant.reload()
    runs.reload()
  }

  // Starea surselor nu blochează cardurile: fără ea, o sursă apare „Neconectat", nu ascunsă.
  const statusList = statuses.state.status === 'done' && statuses.state.value.kind === 'ready' ? statuses.state.value.data : []
  // La fel rulările: până se încarcă, accesul unei conexiuni apare „Neverificat”.
  const runList = runs.state.status === 'done' && runs.state.value.kind === 'ready' ? runs.state.value.data : []

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Link to={adminPath('clients')} className="inline-flex items-center gap-1.5 self-start text-[12.5px] text-text-2 hover:text-text">
          <ArrowLeftIcon size={12} aria-hidden="true" /> Înapoi la clienți și site-uri
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-[20px] font-semibold">{space.name}</h2>
          {space.status === 'active' ? <StatusChip tone="pos">Activ</StatusChip> : <StatusChip tone="neutral">Arhivat</StatusChip>}
        </div>
        <p className="text-[12.5px] text-text-2">
          {client.name}
          {space.domain && <> · <span className="font-mono text-[12px]">{space.domain}</span></>}
        </p>
      </div>

      <OAuthReturn />

      <Section id="details" title="Detalii">
        <SiteDetails space={space} onChanged={onChanged} />
      </Section>

      <Section
        id="sources"
        title="Surse"
        description={`Fiecare sursă se conectează aici, pentru ${space.name}. O cheie a clientului (Google, SEOmonitor, Planable, Meta, Google Ads, TikTok, Airbyte) se salvează o singură dată și e refolosită automat de celelalte site-uri ale lui ${client.name}.`}
      >
        <Resolved state={connections.state} onRetry={connections.reload} loadingLabel="Se încarcă sursele" skeletonClass="h-48">
          {(connList) => (
            <Resolved state={tenant.state} onRetry={tenant.reload} loadingLabel="Se încarcă cheile clientului" skeletonClass="h-48">
              {(tenantList) => (
                <div className="flex flex-col gap-3">
                  {SITE_SOURCES.map((src) => (
                    <SiteSourceCard
                      key={src.provider}
                      source={src}
                      space={space}
                      client={client}
                      status={statusList.find((s) => s.provider === src.provider) ?? null}
                      connections={connList.filter((c) => c.provider === src.provider)}
                      runs={runList.filter((r) => runSourcesFor(src.provider).includes(r.provider))}
                      tenantConnection={src.tenant ? (tenantList.find((t) => t.provider === src.tenant) ?? null) : null}
                      onChanged={refresh}
                    />
                  ))}
                </div>
              )}
            </Resolved>
          )}
        </Resolved>
      </Section>

      <Section id="sync-runs" title="Istoricul sincronizărilor" description={`Ultimele rulări ale conectorilor pentru ${space.name}.`}>
        <Resolved state={runs.state} onRetry={runs.reload} loadingLabel="Se încarcă istoricul" skeletonClass="h-40">
          {(rows) => <SortableTable caption="Istoricul sincronizărilor" columns={runColumns} rows={rows} rowKey={(r) => r.id} pageSize={8} emptyText="Nicio sincronizare înregistrată pentru acest site." />}
        </Resolved>
      </Section>
    </div>
  )
}

interface CardProps {
  source: SiteSource
  space: ClientSpace
  client: Client
  /** `null` = sursa nu e raportată: neconectată, nu necunoscută. */
  status: SourceStatusInfo | null
  connections: SourceConnection[]
  /** Rulările sursei pentru acest site, cele mai noi întâi. */
  runs: SyncRun[]
  tenantConnection: TenantConnection | null
  onChanged: () => void
}

/** O sursă a site-ului: starea ei și, la deschidere, pașii de conectare (cheia clientului, apoi contul site-ului). */
function SiteSourceCard({ source, space, client, status, connections, runs, tenantConnection, onChanged }: CardProps) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const bodyId = useId()
  const { provider } = source
  const { name, mono } = PROVIDER_LABELS[provider]
  const state: SourceState = status?.state ?? 'not_connected'
  const st = STATE[state]
  const open = params.get('source') === provider
  const keySaved = tenantConnection !== null && tenantConnection.credential_status !== 'missing'
  const [changingKey, setChangingKey] = useState(false)

  function toggle() {
    const next = new URLSearchParams(params)
    if (open) next.delete('source')
    else next.set('source', provider)
    setParams(next, { replace: true })
  }

  const steps = (source.tenant ? 1 : 0) + (source.brand || provider === 'seomonitor' ? 1 : 0)
  let n = 0

  return (
    <article aria-label={name} data-state={state} className="flex flex-col rounded-xl border border-border bg-surface shadow-1">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent-soft font-mono text-[11px] font-semibold text-accent-text">{mono}</span>
        <div className="min-w-[200px] flex-1">
          <h3 className="font-display text-[14.5px] font-semibold leading-tight">{name}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-text-2">{status?.description ?? PROVIDER_DESCRIPTIONS[provider]}</p>
          {state !== 'not_connected' && (status?.data_as_of || status?.imported_at) && (
            <p className="mt-1 font-mono text-[11.5px] text-text-2">
              {status?.data_as_of && `Date până la ${formatDate(status.data_as_of)}`}
              {status?.data_as_of && status?.imported_at && ' · '}
              {status?.imported_at && `importat ${formatDateTime(status.imported_at)}`}
            </p>
          )}
          {status?.note && state !== 'connected' && <p className="mt-1 text-[12.5px] leading-snug text-text-2">{status.note}</p>}
        </div>
        <div className="flex flex-none items-center gap-2">
          <StatusChip tone={st.tone} icon={st.icon}>{st.label}</StatusChip>
          <Button
            variant={open ? 'ghost' : state === 'not_connected' ? 'primary' : 'secondary'}
            aria-expanded={open}
            aria-controls={bodyId}
            icon={open ? <CaretUpIcon size={12} aria-hidden="true" /> : <CaretDownIcon size={12} aria-hidden="true" />}
            onClick={toggle}
          >
            {open ? 'Închide' : state === 'not_connected' && connections.length === 0 ? 'Conectează' : 'Gestionează'}
          </Button>
        </div>
      </div>

      {open && (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-border p-4">
          {source.tenant && (
            <Step n={++n} total={steps} title={TENANT_STEP[source.tenant]} done={keySaved}>
              {keySaved && !changingKey ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px]">
                    <span className="text-text-2">Folosește cheia clientului {client.name}:</span>
                    <span className="break-all font-mono text-[12px]">{tenantConnection.external_account_id}</span>
                    <StatusChip tone={CREDENTIAL_LABELS[tenantConnection.credential_status].tone}>{CREDENTIAL_LABELS[tenantConnection.credential_status].label}</StatusChip>
                    <span className="text-text-3">E aceeași pentru toate site-urile clientului.</span>
                    <Button variant="ghost" onClick={() => setChangingKey(true)}>Schimbă cheia</Button>
                  </div>
                  {source.tenant === 'airbyte_postgres' && <AirbyteInspect connection={tenantConnection} />}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {!keySaved && <p className="text-[12.5px] text-text-2">Clientul {client.name} nu are încă această cheie. O salvezi aici o singură dată; celelalte site-uri ale clientului o refolosesc.</p>}
                  <TenantAccountCard tenantId={client.id} provider={source.tenant} connection={tenantConnection} onChanged={onChanged} />
                  {changingKey && (
                    <span>
                      <Button variant="ghost" onClick={() => setChangingKey(false)}>Renunță</Button>
                    </span>
                  )}
                </div>
              )}
            </Step>
          )}

          {source.brand && (
            <Step n={++n} total={steps} title={MULTI_ACCOUNT.includes(provider) ? `Conturile ${space.name} din ${name}` : `Contul ${space.name} în ${name}`} done={connections.length > 0}>
              <div className="flex flex-col gap-3">
                {source.tenant && !keySaved && <p className="text-[12.5px] text-warn-text">Fără cheia clientului de la pasul 1, contul se adaugă, dar colectarea nu pornește.</p>}
                {connections.map((c) => (
                  <ConnectionCard key={c.id} connection={c} runs={runs.filter((r) => r.connection_id === c.id || r.connection_id === null)} onChanged={onChanged} />
                ))}
                {(connections.length === 0 || MULTI_ACCOUNT.includes(provider)) && (
                  <AddConnection
                    key={keySaved ? tenantConnection.id : 'manual'}
                    brandId={space.id}
                    provider={provider}
                    discovery={keySaved && DISCOVER_KIND[provider] ? { tenantConnectionId: tenantConnection.id, kind: DISCOVER_KIND[provider]!, siteName: space.name, siteDomain: space.domain } : undefined}
                    onCreated={onChanged}
                  />
                )}
              </div>
            </Step>
          )}

          {provider === 'seomonitor' && (
            <Step n={++n} total={steps} title={`Grupurile de keywords ale ${space.name}`} done={false}>
              <div className="flex flex-col items-start gap-2">
                {keySaved ? (
                  <SeomonitorCampaigns tenantId={client.id} tenantConnectionId={tenantConnection.id} site={space} spaces={client.spaces} />
                ) : (
                  <p className="text-[12.5px] leading-snug text-text-2">După ce salvezi tokenul la pasul 1, alegi aici campania lui {space.name} și grupurile ei de keywords.</p>
                )}
                <Button variant="ghost" onClick={() => navigate(adminPath('config'))}>Toate mapările, în Configurare</Button>
              </div>
            </Step>
          )}

          {provider === 'csv_import' && (
            <p className="text-[12.5px] leading-snug text-text-2">
              Importul din fișier nu are conexiune: fișierele (Google Ads, Meta Ads, TikTok Ads, Planable) se importă pe site și scriu în aceleași tabele ca API-ul. Ecranul de încărcare nu e încă gata; ghidul e în docs/connectors/csv.md.
            </p>
          )}
        </div>
      )}
    </article>
  )
}

function Step({ n, total, title, done, children }: { n: number; total: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h4 className="flex items-center gap-2 text-[13px] font-semibold">
        {total > 1 && (
          <span aria-hidden="true" className={done ? 'grid size-5 place-items-center rounded-full bg-accent-btn text-[11px] text-on-accent' : 'grid size-5 place-items-center rounded-full border border-border-strong text-[11px] text-text-2'}>
            {n}
          </span>
        )}
        {title}
      </h4>
      {children}
    </section>
  )
}

function SiteDetails({ space, onChanged }: { space: ClientSpace; onChanged: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const { reloadBrands } = useLayout()
  const ids = [useId(), useId()] as const
  const [name, setName] = useState(space.name)
  const [domain, setDomain] = useState(space.domain ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const domainValue = normalizeDomain(domain)
  const changed = name.trim() !== space.name || (domainValue ?? null) !== space.domain
  const ok = name.trim().length >= 2 && domainValue !== undefined && changed
  const archived = space.status === 'archived'

  async function save(patch: Parameters<typeof providers.clients.updateSpace>[1], message: string) {
    setBusy(true)
    setError(null)
    const r = await providers.clients.updateSpace(space.id, patch)
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    toast(message)
    reloadBrands()
    onChanged()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (ok && !busy) void save({ name, domain: domainValue ?? null }, 'Modificările au fost salvate.')
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(0,22rem)]">
      <form onSubmit={submit} aria-label="Detaliile site-ului" className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">Numele site-ului</label>
            <input id={ids[0]} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">Domeniu</label>
            <input id={ids[1]} value={domain} onChange={(e) => setDomain(e.target.value)} className={`${field} font-mono`} aria-invalid={domainValue === undefined} />
            {domainValue === undefined && <span className="text-[12px] text-neg-text">Domeniul nu pare valid. Exemplu: exemplu.ro</span>}
          </div>
        </div>
        <p className="text-[12px] text-text-3">Identificator: <span className="font-mono">{space.slug}</span> (nu se schimbă).</p>
        <span>
          <Button type="submit" variant="primary" loading={busy} disabled={!ok}>Salvează</Button>
        </span>
        <div aria-live="polite">{error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}</div>
      </form>
      <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <span className="text-[13px] font-semibold">{archived ? 'Site arhivat' : 'Arhivează site-ul'}</span>
        <span className="text-[12.5px] leading-snug text-text-2">
          {archived
            ? 'Nu apare în selectorul de brand. Datele și istoricul sunt păstrate; îl poți restaura oricând.'
            : 'Dispare din selectorul de brand pentru toată lumea. Datele, conexiunile și istoricul rămân; îl poți restaura oricând.'}
        </span>
        <span>
          <Button disabled={busy} onClick={() => void save({ status: archived ? 'active' : 'archived' }, archived ? `${space.name} a fost restaurat.` : `${space.name} a fost arhivat.`)}>
            {archived ? 'Restaurează' : 'Arhivează'}
          </Button>
        </span>
      </div>
    </div>
  )
}
