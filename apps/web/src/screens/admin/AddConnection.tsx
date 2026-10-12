import { useId, useState, type FormEvent } from 'react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { AccountList, DiscoverKind, DiscoveredAccount, SourceProviderId } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { PROVIDER_LABELS } from '../../lib/sources'

/** Sursele cu token propriu pe conexiune; restul folosesc cheia clientului. */
const NEEDS_OWN_TOKEN: readonly SourceProviderId[] = ['clarity']

/** Eticheta câmpului de cont, per sursă. */
const ACCOUNT_LABEL: Partial<Record<SourceProviderId, string>> = {
  ga4: 'Property ID GA4',
  gsc: 'Proprietatea Search Console',
  clarity: 'Project ID Clarity',
  planable: 'Workspace Planable',
  meta_ads: 'Contul de ads Meta',
  google_ads: 'Customer ID Google Ads',
  tiktok_ads: 'Advertiser ID TikTok',
}

/** Eticheta selectorului, per sursă. */
const PICK_LABEL: Partial<Record<SourceProviderId, string>> = {
  ga4: 'Proprietatea GA4',
  gsc: 'Proprietatea Search Console',
  planable: 'Workspace-ul Planable',
  meta_ads: 'Contul de ads Meta',
}

/** Ce se completează la „Cont sau proiect”, per sursă (docs/connectors). */
const ACCOUNT_HINT: Partial<Record<SourceProviderId, string>> = {
  ga4: 'Property ID GA4 (doar cifre)',
  gsc: 'sc-domain:exemplu.ro sau https://www.exemplu.ro/',
  clarity: 'Project ID Clarity',
  planable: 'ID-ul workspace-ului Planable',
  meta_ads: 'Contul de ads: act_1234567890',
  google_ads: 'Customer ID Google Ads: 123-456-7890',
  tiktok_ads: 'Advertiser ID TikTok (cifre)',
}

/** Ce faci când lista e goală: cheia funcționează, dar nu vede niciun cont. */
const EMPTY_HINT: Partial<Record<DiscoverKind, string>> = {
  ga4: 'Service account-ul nu vede nicio proprietate GA4. Adaugă-l ca Viewer în GA4 (Admin → Property access management), apoi reîncarcă lista.',
  gsc: 'Service account-ul nu vede niciun site în Search Console. Adaugă-l ca utilizator Restricted (Settings → Users and permissions), apoi reîncarcă lista.',
  planable: 'Tokenul Planable nu vede niciun workspace. Verifică workspace-urile alese la crearea tokenului.',
  meta_ads: 'System user-ul nu are niciun cont de ads atribuit. Atribuie-l în Business Settings → System users → Assign assets.',
}

/** Selectorul: cheia clientului de folosit și ce fel de conturi se listează. */
export interface Discovery {
  tenantConnectionId: string
  kind: DiscoverKind
  /** Pentru propunerea contului potrivit: domeniul și numele site-ului. */
  siteDomain: string | null
  siteName: string
}

interface Props {
  brandId: string
  /** Sursa conexiunii: formularul e în cardul sursei din pagina site-ului, deci sursa nu se alege. */
  provider: SourceProviderId
  /** Când cheia clientului e salvată, contul se alege din lista văzută de cheie. */
  discovery?: Discovery
  onCreated: () => void
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Contul propus pentru site: domeniul la Search Console, numele site-ului la celelalte. Doar o propunere. */
export function suggestAccount(accounts: DiscoveredAccount[], kind: DiscoverKind, siteName: string, siteDomain: string | null): DiscoveredAccount | null {
  if (kind === 'gsc' && siteDomain) {
    const d = norm(siteDomain)
    return accounts.find((a) => norm(a.id) === `sc-domain:${d}`) ?? accounts.find((a) => norm(a.id).includes(d)) ?? null
  }
  const n = norm(siteName)
  return accounts.find((a) => norm(a.name).includes(n)) ?? null
}

export function AddConnection({ brandId, provider, discovery, onCreated }: Props) {
  const providers = useProviders()
  const ids = [useId(), useId()] as const
  const [manual, setManual] = useState(!discovery)
  const [picked, setPicked] = useState<string | null>(null)
  const [account, setAccount] = useState('')
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const list = useAsync(
    () => (discovery ? providers.sources.listAccounts(discovery.tenantConnectionId, discovery.kind) : Promise.resolve(null)),
    [providers, discovery?.tenantConnectionId, discovery?.kind],
  )

  const result: AccountList | null = list.state.status === 'done' && list.state.value?.kind === 'ready' ? list.state.value.data : null
  const listError =
    list.state.status === 'failed' ? list.state.message : list.state.status === 'done' && list.state.value && list.state.value.kind !== 'ready' ? (list.state.value.kind === 'error' ? list.state.value.message : list.state.value.reason) : null
  const accounts = result?.outcome === 'ok' ? result.accounts : []
  const suggestion = discovery && accounts.length > 0 ? suggestAccount(accounts, discovery.kind, discovery.siteName, discovery.siteDomain) : null
  const selectedId = picked ?? suggestion?.id ?? ''
  const selected = accounts.find((a) => a.id === selectedId) ?? null
  const usingList = !!discovery && !manual && accounts.length > 0
  const value = usingList ? selectedId : account.trim()
  // Numele afișat: cel din cont, până când utilizatorul îl schimbă.
  const displayName = name ?? (usingList ? (selected?.name ?? '') : '')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    setDone(false)
    const r = await providers.sources.createConnection(brandId, { provider, external_account_id: value, display_name: displayName.trim() || null })
    setBusy(false)
    if (r.kind === 'ready') {
      setAccount('')
      setName(null)
      setPicked(null)
      setDone(true)
      onCreated()
    } else setError(r.kind === 'error' ? r.message : r.reason)
  }

  const field = 'h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'
  const listProblem = discovery && !manual ? (listError ?? (result && result.outcome !== 'ok' ? result.message : null) ?? (result?.outcome === 'ok' && accounts.length === 0 ? (EMPTY_HINT[discovery.kind] ?? 'Cheia nu vede niciun cont.') : null)) : null

  return (
    <form onSubmit={submit} aria-label={`Adaugă conexiunea ${PROVIDER_LABELS[provider].name}`} className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-4">
      {discovery && !manual && list.state.status === 'loading' && <div role="status" aria-label="Se încarcă conturile din cheia clientului" className="h-9 rounded-[10px] bg-skeleton" />}

      {listProblem && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-text">
          <span role="alert" className="flex-1 leading-snug">{listProblem}</span>
          <Button variant="ghost" icon={<ArrowClockwiseIcon size={12} aria-hidden="true" />} onClick={list.reload}>Reîncarcă lista</Button>
        </div>
      )}

      {(usingList || manual || (discovery && list.state.status !== 'loading')) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            {usingList ? (
              <>
                <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">{PICK_LABEL[provider] ?? 'Contul'}</label>
                <select id={ids[0]} value={selectedId} onChange={(e) => setPicked(e.target.value)} className={field}>
                  {!suggestion && <option value="">Alege…</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name === a.id ? a.id : `${a.name} · ${a.id}`}{a.detail && a.detail !== 'Domain property' && a.detail !== 'URL prefix' ? ` (${a.detail})` : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-text-3">
                  {suggestion && selectedId === suggestion.id ? 'Propus după numele sau domeniul site-ului. ' : ''}
                  {accounts.length === 1 ? 'Un cont văzut de cheia clientului.' : `${accounts.length} conturi văzute de cheia clientului.`}
                  {result?.truncated ? ' Lista e tăiată; dacă nu găsești contul, introdu-l manual.' : ''}
                </span>
              </>
            ) : (
              <>
                <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">{ACCOUNT_LABEL[provider] ?? 'Cont sau proiect'}</label>
                <input id={ids[0]} value={account} onChange={(e) => setAccount(e.target.value)} placeholder={ACCOUNT_HINT[provider] ?? 'de ex. ID-ul proiectului'} className={`${field} font-mono`} />
              </>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">Nume afișat (opțional)</label>
            <input id={ids[1]} value={displayName} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={busy} disabled={!value}>Adaugă conexiunea</Button>
        {discovery && (
          <Button variant="ghost" onClick={() => setManual(!manual)}>
            {manual ? 'Alege din lista cheii' : 'Nu e în listă? Introdu manual'}
          </Button>
        )}
        {NEEDS_OWN_TOKEN.includes(provider) && <span className="text-[12px] text-text-3">Tokenul se setează după ce conexiunea există.</span>}
      </div>
      <div aria-live="polite">
        {done && <p className="text-[12.5px] text-pos-text">{NEEDS_OWN_TOKEN.includes(provider) ? 'Conexiune adăugată. Setează acum tokenul.' : 'Conexiune adăugată.'}</p>}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </form>
  )
}
