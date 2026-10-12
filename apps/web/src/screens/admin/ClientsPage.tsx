import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightIcon, BuildingsIcon, GlobeIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon } from '@phosphor-icons/react'
import type { Client, ClientSpace, TenantId } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { Dialog } from '../../components/ui/Dialog'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { adminPath, brandPath, sitePath } from '../../lib/navigation'
import { todayBucharest } from '../../lib/period'
import { normalizeDomain, slugify, SLUG_PATTERN } from '../../lib/slug'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const HOW_TO: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <BuildingsIcon size={17} />, title: 'Creezi clientul', text: 'Numele companiei. Tu devii administratorul lui și poți invita restul echipei.' },
  { icon: <GlobeIcon size={17} />, title: 'Adaugi site-ul', text: 'Fiecare site devine un spațiu de brand, cu domeniul lui. Competitorii se configurează separat, cu versiune.' },
  { icon: <PlugsConnectedIcon size={17} />, title: 'Conectezi sursele și inviți echipa', text: 'Sursele, din pagina fiecărui site („Surse”); echipa, din Utilizatori. Ghidurile pe surse sunt în docs/connectors.' },
]

const field = 'h-9 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'
const createdOn = (iso: string) => formatDate(todayBucharest(new Date(iso)))

/** Administrare → Clienți și site-uri (doar `agency_admin`): clienții, spațiile lor, creare și editare. */
export function ClientsPage() {
  const providers = useProviders()
  const { reloadBrands } = useLayout()
  const list = useAsync(() => providers.clients.list(), [providers])
  const [setup, setSetup] = useState<SetupTarget | null>(null)
  const [renaming, setRenaming] = useState<Client | null>(null)

  function changed() {
    list.reload()
    reloadBrands()
  }

  return (
    <div className="flex flex-col gap-5">
      <Section id="how-to" title="Cum adaugi un client nou" action={<Button variant="primary" icon={<PlusIcon size={14} weight="bold" />} onClick={() => setSetup({ mode: 'client' })}>Adaugă client</Button>}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {HOW_TO.map((h) => (
            <div key={h.title} className="flex gap-3 rounded-[10px] bg-surface-2 p-3.5">
              <span className="grid size-[34px] flex-none place-items-center rounded-[10px] border border-border bg-surface text-accent-text" aria-hidden="true">{h.icon}</span>
              <div className="flex flex-col gap-1">
                <span className="text-[13.5px] font-semibold">{h.title}</span>
                <span className="text-[12.5px] leading-snug text-text-2">{h.text}</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Resolved state={list.state} onRetry={list.reload} loadingLabel="Se încarcă clienții" skeletonClass="h-64">
        {(clients) =>
          clients.length === 0 ? (
            <EmptyState title="Niciun client" text="Nu ai încă niciun client în Analyzator. Începe cu „Adaugă client”." />
          ) : (
            <div className="flex flex-col gap-5">
              {clients.map((c) => (
                <ClientCard key={c.id} client={c} onAddSite={() => setSetup({ mode: 'site', tenantId: c.id, clientName: c.name })} onRename={() => setRenaming(c)} />
              ))}
            </div>
          )
        }
      </Resolved>

      {setup && <SetupPanel key={setup.mode + (setup.tenantId ?? '')} target={setup} onClose={() => setSetup(null)} onChanged={changed} />}
      {renaming && <RenameClientDialog key={renaming.id} client={renaming} onClose={() => setRenaming(null)} onChanged={changed} />}
    </div>
  )
}

function ClientCard({ client, onAddSite, onRename }: { client: Client; onAddSite: () => void; onRename: () => void }) {
  const navigate = useNavigate()
  const active = client.spaces.filter((s) => s.status === 'active').length
  const columns: Column<ClientSpace>[] = [
    {
      key: 'name',
      header: 'Spațiu de brand',
      sortValue: (s) => s.name,
      render: (s) => (
        <span className="inline-flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="grid size-[30px] flex-none place-items-center rounded-lg bg-accent-soft font-display text-[13px] font-bold text-accent-text">{s.name[0]?.toUpperCase()}</span>
          <span className="truncate font-semibold">{s.name}</span>
        </span>
      ),
    },
    { key: 'domain', header: 'Domeniu', sortValue: (s) => s.domain ?? '', render: (s) => <span className="whitespace-nowrap font-mono text-[12.5px]">{s.domain ?? '—'}</span> },
    {
      key: 'sources',
      header: 'Conexiuni',
      align: 'right',
      sortValue: (s) => s.connections,
      render: (s) => <span className={s.connections === 0 ? 'font-mono text-[12.5px] text-text-3' : 'font-mono text-[12.5px]'}>{s.connections}</span>,
    },
    { key: 'created', header: 'Creat', sortValue: (s) => s.created_at, render: (s) => <span className="whitespace-nowrap font-mono text-[12px] text-text-2">{createdOn(s.created_at)}</span> },
    { key: 'status', header: 'Status', sortValue: (s) => s.status, render: (s) => (s.status === 'active' ? <StatusChip tone="pos">Activ</StatusChip> : <StatusChip tone="neutral">Arhivat</StatusChip>) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <span className="flex justify-end gap-1.5">
          <Button variant="ghost" icon={<PlugsConnectedIcon size={14} />} onClick={() => navigate(sitePath(s.id))} aria-label={`Editează ${s.name} și sursele lui`}>Editează și surse</Button>
          {s.status === 'active' && (
            <Button onClick={() => navigate(brandPath(s.id, 'overview'))} aria-label={`Deschide ${s.name}`}>
              Deschide <ArrowRightIcon size={12} aria-hidden="true" />
            </Button>
          )}
        </span>
      ),
    },
  ]

  return (
    <section aria-label={client.name} className="overflow-hidden rounded-xl border border-border bg-surface shadow-1">
      <div className="flex flex-wrap items-center gap-3.5 px-5 py-4">
        <span aria-hidden="true" className="grid size-[42px] flex-none place-items-center rounded-xl border border-border bg-surface-2 font-display text-[17px] font-bold text-text-2">{client.name[0]?.toUpperCase()}</span>
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-[16px] font-semibold">{client.name}</h2>
            {client.status === 'active' ? <StatusChip tone="pos">Activ</StatusChip> : <StatusChip tone="neutral">Arhivat</StatusChip>}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-text-2">
            <span>{active === 1 ? '1 spațiu activ' : `${active} spații active`}</span>
            <span>
              Client din <span className="font-mono text-[12px] text-text">{createdOn(client.created_at)}</span>
            </span>
          </div>
        </div>
        <Button variant="ghost" icon={<PencilSimpleIcon size={14} />} onClick={onRename}>Redenumește</Button>
        <Button icon={<PlusIcon size={14} weight="bold" />} onClick={onAddSite}>Adaugă site</Button>
      </div>
      {client.spaces.length === 0 ? (
        <div className="border-t border-border">
          <EmptyState compact title="Niciun site" text={`${client.name} nu are încă niciun spațiu de brand. Adaugă primul site.`} />
        </div>
      ) : (
        <div className="border-t border-border">
          <SortableTable caption={`Spațiile de brand ale clientului ${client.name}`} columns={columns} rows={client.spaces} rowKey={(s) => s.id} pageSize={10} emptyText="Niciun site." />
        </div>
      )}
    </section>
  )
}

interface SetupTarget {
  mode: 'client' | 'site'
  tenantId?: TenantId
  clientName?: string
}

/** Formularul de identificator: se completează din nume până când utilizatorul îl schimbă. */
function useSlug() {
  const [custom, setCustom] = useState<string | null>(null)
  return {
    value: (name: string) => custom ?? slugify(name),
    set: (v: string) => setCustom(v),
  }
}

/** Panoul lateral „Adaugă client” / „Adaugă site”: pașii Client → Site, apoi ce urmează (Surse, Utilizatori). */
function SetupPanel({ target, onClose, onChanged }: { target: SetupTarget; onClose: () => void; onChanged: () => void }) {
  const providers = useProviders()
  const navigate = useNavigate()
  const ids = [useId(), useId(), useId(), useId(), useId()] as const
  // După crearea clientului, panoul continuă în modul „site” pentru clientul nou (o eroare la site nu recreează clientul).
  const [tenant, setTenant] = useState<{ id: TenantId; name: string } | null>(target.tenantId ? { id: target.tenantId, name: target.clientName ?? '' } : null)
  const steps = target.mode === 'client' ? ['Client', 'Site', 'Gata'] : ['Site', 'Gata']
  const [step, setStep] = useState(0)
  const [clientName, setClientName] = useState('')
  const clientSlug = useSlug()
  const [siteName, setSiteName] = useState('')
  const [domain, setDomain] = useState('')
  const siteSlug = useSlug()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdSpace, setCreatedSpace] = useState<string | null>(null)

  const current = steps[step]
  const cSlug = clientSlug.value(clientName)
  const sSlug = siteSlug.value(siteName)
  const domainValue = normalizeDomain(domain)
  const clientOk = clientName.trim().length >= 2 && SLUG_PATTERN.test(cSlug)
  const siteOk = siteName.trim().length >= 2 && SLUG_PATTERN.test(sSlug) && domainValue !== undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (current === 'Client') {
      if (clientOk) setStep(step + 1)
      return
    }
    if (current !== 'Site' || !siteOk) return
    setBusy(true)
    let t = tenant
    if (!t) {
      const r = await providers.clients.createClient({ name: clientName, slug: cSlug })
      if (r.kind !== 'ready') {
        setBusy(false)
        setError(r.kind === 'error' ? r.message : r.reason)
        return
      }
      t = { id: r.data.id, name: clientName.trim() }
      setTenant(t)
      onChanged()
    }
    const s = await providers.clients.createSpace(t.id, { name: siteName, slug: sSlug, domain: domainValue ?? null })
    setBusy(false)
    if (s.kind !== 'ready') {
      setError(`${s.kind === 'error' ? s.message : s.reason}${tenant ? '' : ` Clientul ${t.name} a fost creat; poți reîncerca doar site-ul.`}`)
      return
    }
    setCreatedSpace(s.data.id)
    onChanged()
    setStep(step + 1)
  }

  const title = target.mode === 'client' ? 'Adaugă un client' : 'Adaugă un site'
  const footer =
    current === 'Gata' ? (
      <Button variant="primary" onClick={onClose}>Închide</Button>
    ) : (
      <>
        {step > 0 && !tenant && <Button variant="ghost" onClick={() => setStep(step - 1)}>Înapoi</Button>}
        <Button variant="primary" type="submit" form="setup-form" loading={busy} disabled={current === 'Client' ? !clientOk : !siteOk}>
          {current === 'Client' ? 'Continuă' : target.mode === 'client' && !tenant ? 'Creează clientul' : 'Creează site-ul'}
        </Button>
      </>
    )

  return (
    <Dialog open onClose={onClose} title={title} placement="right" footer={footer}>
      <div className="flex flex-col gap-5">
        <p className="text-[13px] leading-snug text-text-2">
          {target.mode === 'client' ? 'Clientul și primul lui site. Sursele le conectezi apoi din pagina site-ului, iar persoanele cu acces din Utilizatori.' : `Un spațiu de brand nou pentru ${target.clientName}.`}
        </p>
        <ol className="flex items-center gap-2" aria-label="Pași">
          {steps.map((s, i) => (
            <li key={s} aria-current={i === step ? 'step' : undefined} className="flex flex-1 items-center gap-2 last:flex-none">
              <span className={i < step ? 'grid size-6 place-items-center rounded-full bg-accent-btn text-[11.5px] font-semibold text-on-accent' : i === step ? 'grid size-6 place-items-center rounded-full border border-accent text-[11.5px] font-semibold text-accent-text' : 'grid size-6 place-items-center rounded-full border border-border-strong text-[11.5px] text-text-3'}>{i + 1}</span>
              <span className={i === step ? 'text-[12.5px] font-semibold' : 'text-[12.5px] text-text-2'}>{s}</span>
              {i < steps.length - 1 && <span aria-hidden="true" className={i < step ? 'h-px flex-1 bg-accent' : 'h-px flex-1 bg-border-strong'} />}
            </li>
          ))}
        </ol>

        <form id="setup-form" onSubmit={submit} className="flex flex-col gap-4">
          {current === 'Client' && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">Numele clientului</label>
                <input id={ids[0]} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="de ex. STADA România" className={field} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">Identificator</label>
                <input id={ids[1]} value={cSlug} onChange={(e) => clientSlug.set(e.target.value)} className={`${field} font-mono`} aria-describedby={`${ids[1]}-hint`} />
                <span id={`${ids[1]}-hint`} className="text-[12px] text-text-3">Litere mici, cifre și cratime. Unic; nu se mai schimbă după creare.</span>
              </div>
            </>
          )}
          {current === 'Site' && (
            <>
              {tenant && target.mode === 'client' && <p className="rounded-lg bg-pos-soft px-3 py-2 text-[12.5px] text-pos-text">Clientul {tenant.name} a fost creat.</p>}
              <div className="flex flex-col gap-1">
                <label htmlFor={ids[2]} className="text-[12.5px] font-semibold">Numele site-ului (brandul)</label>
                <input id={ids[2]} value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="de ex. Urinal" className={field} autoComplete="off" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids[3]} className="text-[12.5px] font-semibold">Domeniu</label>
                <input id={ids[3]} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="exemplu.ro" className={`${field} font-mono`} aria-invalid={domainValue === undefined} aria-describedby={`${ids[3]}-hint`} />
                <span id={`${ids[3]}-hint`} className={domainValue === undefined ? 'text-[12px] text-neg-text' : 'text-[12px] text-text-3'}>
                  {domainValue === undefined ? 'Domeniul nu pare valid. Exemplu: exemplu.ro' : domainValue ? `Se salvează ca ${domainValue}.` : 'Opțional; fără https:// sau www.'}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={ids[4]} className="text-[12.5px] font-semibold">Identificator</label>
                <input id={ids[4]} value={sSlug} onChange={(e) => siteSlug.set(e.target.value)} className={`${field} font-mono`} />
              </div>
            </>
          )}
        </form>

        {current === 'Gata' && (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-pos-soft px-3 py-2 text-[13px] text-pos-text">{siteName.trim()} a fost adăugat{target.mode === 'client' && tenant ? ` pentru ${tenant.name}` : ''}.</p>
            <p className="text-[13px] leading-snug text-text-2">Ce urmează: conectează sursele spațiului și invită persoanele care trebuie să-l vadă. Până la conectare, modulele arată „Sursă neconectată”.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                icon={<PlugsConnectedIcon size={14} />}
                disabled={!createdSpace}
                onClick={() => {
                  if (createdSpace) navigate(sitePath(createdSpace))
                }}
              >
                Conectează sursele
              </Button>
              <Button onClick={() => navigate(adminPath('users'))}>Utilizatori</Button>
              {createdSpace && <Button variant="ghost" onClick={() => navigate(brandPath(createdSpace, 'overview'))}>Deschide spațiul</Button>}
            </div>
          </div>
        )}
        <div aria-live="polite">{error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}</div>
      </div>
    </Dialog>
  )
}

function RenameClientDialog({ client, onClose, onChanged }: { client: Client; onClose: () => void; onChanged: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const id = useId()
  const [name, setName] = useState(client.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = name.trim().length >= 2 && name.trim() !== client.name

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    const r = await providers.clients.renameClient(client.id, name)
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    toast('Clientul a fost redenumit.')
    onChanged()
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Redenumește clientul"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Anulează</Button>
          <Button variant="primary" type="submit" form="rename-client" loading={busy} disabled={!ok}>Salvează</Button>
        </>
      }
    >
      <form id="rename-client" onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-[12.5px] font-semibold">Numele clientului</label>
          <input id={id} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        </div>
        <p className="text-[12px] leading-snug text-text-3">Arhivarea unui client nu se face din aplicație: după arhivare nimeni nu l-ar mai putea vedea sau restaura. Cere-o echipei tehnice.</p>
        <div aria-live="polite">{error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}</div>
      </form>
    </Dialog>
  )
}
