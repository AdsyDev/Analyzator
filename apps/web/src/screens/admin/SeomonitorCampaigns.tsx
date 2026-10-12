import { useEffect, useId, useState } from 'react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import type { ClientSpace, DiscoveredAccount, NewSeomonitorMapping, SeomonitorMapping, TenantId } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'

const host = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
const field = 'h-8 rounded-[10px] border border-border-strong bg-surface px-2 text-[12.5px]'

interface Props {
  tenantId: TenantId
  /** Conexiunea SEOmonitor a clientului (cheia), sursa mapării. */
  tenantConnectionId: string
  site: ClientSpace
  /** Spațiile clientului, ca un grup mapat pe alt site să-și arate site-ul. */
  spaces: ClientSpace[]
}

/** `mixed` = `brand_type` null: grupul are și keywords branded, și nonbranded (de ex. „All keywords”). */
type Row = { on: boolean; type: 'branded' | 'nonbranded' | 'mixed' }
const toDb = (t: Row['type']) => (t === 'mixed' ? null : t)

/**
 * Maparea grupurilor SEOmonitor pe site, din cardul sursei: campania (propusă după domeniu) și grupurile ei, citite
 * live cu tokenul clientului. Fiecare schimbare e o versiune nouă (nimic nu se modifică); un grup scos de pe site
 * devine `excluded`. Colectarea SEOmonitor folosește doar grupurile mapate.
 */
export function SeomonitorCampaigns({ tenantId, tenantConnectionId, site, spaces }: Props) {
  const providers = useProviders()
  const selectId = useId()
  const campaigns = useAsync(() => providers.sources.listAccounts(tenantConnectionId, 'seomonitor'), [providers, tenantConnectionId])
  const [picked, setPicked] = useState<string | null>(null)

  const list = campaigns.state.status === 'done' && campaigns.state.value.kind === 'ready' ? campaigns.state.value.data : null
  const problem =
    campaigns.state.status === 'failed'
      ? campaigns.state.message
      : campaigns.state.status === 'done' && campaigns.state.value.kind !== 'ready'
        ? campaigns.state.value.kind === 'error'
          ? campaigns.state.value.message
          : campaigns.state.value.reason
        : list && list.outcome !== 'ok'
          ? list.message
          : null

  if (campaigns.state.status === 'loading') return <div role="status" aria-label="Se încarcă campaniile SEOmonitor" className="h-16 w-full rounded-lg bg-skeleton" />
  if (problem || !list) return <Problem text={problem ?? 'Campaniile nu au putut fi citite.'} onRetry={campaigns.reload} />
  if (list.accounts.length === 0) return <p className="text-[12.5px] text-text-2">Tokenul funcționează, dar nu vede nicio campanie urmărită în SEOmonitor.</p>

  const domain = site.domain ? host(site.domain) : null
  const suggested = list.accounts.find((c) => domain !== null && c.detail !== null && host(c.detail) === domain) ?? null
  const campaignId = picked ?? suggested?.id ?? ''

  return (
    <section aria-label="Maparea SEOmonitor a site-ului" className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={selectId} className="text-[12.5px] font-semibold">Campania SEOmonitor</label>
        <select id={selectId} value={campaignId} onChange={(e) => setPicked(e.target.value)} className="h-9 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]">
          {!suggested && <option value="">Alege…</option>}
          {list.accounts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}{c.detail && c.detail !== c.name ? ` · ${c.detail}` : ''}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-text-3">
          {suggested && campaignId === suggested.id ? 'Propusă după domeniul site-ului. ' : ''}Tokenul funcționează și vede {list.accounts.length === 1 ? 'o campanie' : `${list.accounts.length} campanii`}.
        </span>
      </div>
      {campaignId && <GroupMapping key={campaignId} tenantId={tenantId} tenantConnectionId={tenantConnectionId} campaignId={campaignId} site={site} spaces={spaces} />}
    </section>
  )
}

function GroupMapping({ tenantId, tenantConnectionId, campaignId, site, spaces }: Omit<Props, 'site'> & { site: ClientSpace; campaignId: string }) {
  const providers = useProviders()
  const groups = useAsync(() => providers.sources.listAccounts(tenantConnectionId, 'seomonitor_groups', campaignId), [providers, tenantConnectionId, campaignId])
  const mappings = useAsync(() => providers.config.seomonitorMappings(), [providers])
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [primary, setPrimary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const groupList = groups.state.status === 'done' && groups.state.value.kind === 'ready' && groups.state.value.data.outcome === 'ok' ? groups.state.value.data.accounts : null
  const mapList = mappings.state.status === 'done' && mappings.state.value.kind === 'ready' ? mappings.state.value.data : null
  const current = (g: DiscoveredAccount): SeomonitorMapping | null => mapList?.find((m) => m.campaign_id === campaignId && m.group_id === g.id) ?? null

  // Starea inițială: grupurile mapate deja pe site, cu tipul și grupul principal salvate.
  useEffect(() => {
    if (!groupList || !mapList) return
    const init: Record<string, Row> = {}
    let p: string | null = null
    for (const g of groupList) {
      const m = mapList.find((x) => x.campaign_id === campaignId && x.group_id === g.id)
      const mine = m?.kind === 'brand' && m.brand_id === site.id
      init[g.id] = { on: mine, type: mine ? (m.brand_type ?? 'mixed') : /^all keywords$/i.test(g.name) ? 'mixed' : /brand/i.test(g.name) ? 'branded' : 'nonbranded' }
      if (mine && m.is_primary_visibility) p = g.id
    }
    setRows(init)
    setPrimary(p)
  }, [groupList, mapList, campaignId, site.id])

  if (groups.state.status === 'loading' || mappings.state.status === 'loading') return <div role="status" aria-label="Se încarcă grupurile SEOmonitor" className="h-24 w-full rounded-lg bg-skeleton" />
  const groupProblem =
    groups.state.status === 'failed'
      ? groups.state.message
      : groups.state.status === 'done' && groups.state.value.kind !== 'ready'
        ? groups.state.value.kind === 'error'
          ? groups.state.value.message
          : groups.state.value.reason
        : groups.state.status === 'done' && groups.state.value.kind === 'ready' && groups.state.value.data.outcome !== 'ok'
          ? groups.state.value.data.message
          : null
  if (groupProblem || !groupList) return <Problem text={groupProblem ?? 'Grupurile nu au putut fi citite.'} onRetry={groups.reload} />
  if (!mapList) return <Problem text="Maparea existentă nu a putut fi citită." onRetry={mappings.reload} />
  if (groupList.length === 0) return <p className="text-[12.5px] text-text-2">Campania nu are grupuri de keywords.</p>

  const otherSite = (m: SeomonitorMapping | null) => (m?.kind === 'brand' && m.brand_id !== site.id ? (spaces.find((s) => s.id === m.brand_id)?.name ?? 'alt site') : null)
  const selected = groupList.filter((g) => rows[g.id]?.on)
  const effectivePrimary = primary && rows[primary]?.on ? primary : null

  // Diferența față de maparea curentă: doar grupurile schimbate primesc o versiune nouă.
  const changes: NewSeomonitorMapping[] = []
  for (const g of groupList) {
    const m = current(g)
    const r = rows[g.id]
    if (!r || otherSite(m)) continue
    const mine = m?.kind === 'brand' && m.brand_id === site.id
    if (r.on) {
      const isPrimary = effectivePrimary === g.id
      if (!mine || m.brand_type !== toDb(r.type) || m.is_primary_visibility !== isPrimary) {
        changes.push({ campaign_id: campaignId, group_id: g.id, kind: 'brand', brand_id: site.id, brand_type: toDb(r.type), is_primary_visibility: isPrimary })
      }
    } else if (mine) {
      changes.push({ campaign_id: campaignId, group_id: g.id, kind: 'excluded', brand_id: null, brand_type: null, is_primary_visibility: false })
    }
  }
  const needsPrimary = selected.length > 0 && !effectivePrimary

  async function save() {
    if (busy || changes.length === 0 || needsPrimary) return
    setBusy(true)
    setError(null)
    setSaved(null)
    const r = await providers.config.saveSeomonitorMappings(tenantId, tenantConnectionId, changes)
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    setSaved(`Maparea a fost salvată, în vigoare din ${formatDate(r.data.effective_from)}. Următoarea colectare SEOmonitor aduce datele grupurilor bifate.`)
    mappings.reload()
  }

  const set = (id: string, patch: Partial<Row>) => setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { on: false, type: 'nonbranded' }), ...patch } }))

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12.5px] leading-snug text-text-2">
        Bifează grupurile de keywords ale lui {site.name}. Alege grupul principal: din el vine indicatorul „Visibility SEOmonitor”. La prima colectare, un site fără mapare primește automat grupul „All keywords” al campaniei cu domeniul lui; orice schimbare salvată aici are prioritate.
      </p>
      <ul aria-label="Grupurile campaniei" className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {groupList.map((g) => {
          const other = otherSite(current(g))
          const r = rows[g.id] ?? { on: false, type: 'nonbranded' as const }
          const m = current(g)
          const auto = m?.kind === 'brand' && m.brand_id === site.id && (m.note ?? '').startsWith('Automat')
          const sub = g.detail?.includes(' în ') ?? false
          return (
            <li key={g.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[12.5px] ${sub ? 'pl-8' : ''}`}>
              <label className="flex min-w-[12rem] flex-1 items-center gap-2">
                <input type="checkbox" checked={r.on} disabled={other !== null} onChange={(e) => set(g.id, { on: e.target.checked })} aria-label={`${g.name} pe ${site.name}`} />
                <span className="font-medium">{g.name}</span>
                <span className="text-[11.5px] text-text-3">{g.detail}</span>
                {auto && <StatusChip tone="accent">Automat</StatusChip>}
              </label>
              {other !== null ? (
                <StatusChip tone="neutral">Mapat pe {other}</StatusChip>
              ) : (
                r.on && (
                  <>
                    <select value={r.type} onChange={(e) => set(g.id, { type: e.target.value as Row['type'] })} aria-label={`Tipul grupului ${g.name}`} className={field}>
                      <option value="branded">Branded</option>
                      <option value="nonbranded">Nonbranded</option>
                      <option value="mixed">Mixt (branded și nonbranded)</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input type="radio" name={`primary-${campaignId}`} checked={effectivePrimary === g.id} onChange={() => setPrimary(g.id)} aria-label={`${g.name} e grupul principal`} />
                      Principal
                    </label>
                  </>
                )
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} disabled={changes.length === 0 || needsPrimary} onClick={() => void save()}>Salvează maparea</Button>
        {needsPrimary && <span className="text-[12px] text-warn-text">Alege grupul principal dintre cele bifate.</span>}
        {!needsPrimary && changes.length === 0 && <span className="text-[12px] text-text-3">Nicio schimbare față de maparea salvată.</span>}
      </div>
      <div aria-live="polite">
        {saved && <p className="text-[12.5px] text-pos-text">{saved}</p>}
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
      </div>
    </div>
  )
}

function Problem({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-text">
      <span role="alert" className="flex-1">{text}</span>
      <Button variant="ghost" icon={<ArrowClockwiseIcon size={12} aria-hidden="true" />} onClick={onRetry}>Reîncarcă</Button>
    </div>
  )
}
