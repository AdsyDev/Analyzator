import { useId, useMemo, useState, type FormEvent } from 'react'
import { ROLES, type AccessPerson, type Brand, type InviteResult, type Role } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Avatar } from '../../components/ui/Avatar'
import { Button } from '../../components/ui/Button'
import { FilterChip, StatusChip } from '../../components/ui/Chip'
import { Dialog } from '../../components/ui/Dialog'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

export const ROLE_LABELS: Record<Role, string> = {
  agency_admin: 'Administrator agenție',
  strategist: 'Strateg',
  account: 'Account manager',
  client_viewer: 'Client (doar citire)',
}

/** Numele din cont, apoi emailul; fără niciunul, un id scurt, nu un nume presupus. */
export const personLabel = (p: AccessPerson) => p.name ?? p.email ?? `Utilizator ${p.user_id.slice(0, 8)}`

/** Mesajul după invitație, după ce a făcut serverul (email nou, doar acces, sau retrimitere). */
export function inviteMessage(r: InviteResult, email: string): string {
  if (r.status === 'access_granted') return `${email} avea deja cont: a primit accesul, fără email nou.`
  if (r.status === 'resent') return `Invitația a fost retrimisă la ${email}.`
  return `Invitația a fost trimisă la ${email}.`
}

/** Administrare → Utilizatori (doar `agency_admin`): roluri, acces la organizație și la branduri, invitații. */
export function UsersPage() {
  const { brands, user } = useLayout()
  const providers = useProviders()
  const people = useAsync(() => providers.users.people(), [providers])

  return (
    <div className="flex flex-col gap-5">
      <Section id="people" title="Persoane cu acces" description="Cititorii văd doar analizele publicate. Accesul la un brand cere rol în organizație; revocarea păstrează istoricul.">
        <Resolved state={people.state} onRetry={people.reload} loadingLabel="Se încarcă persoanele" skeletonClass="h-56">
          {(list) => <PeopleTable list={list} brands={brands} selfId={user.id} onChanged={people.reload} />}
        </Resolved>
      </Section>
      <Section id="invite" title="Trimite invitație" description="Persoana primește pe email un link prin care își alege parola și intră în Analyzator.">
        <Resolved state={people.state} onRetry={people.reload} loadingLabel="Se încarcă formularul" skeletonClass="h-40">
          {(list) => <InviteForm list={list} brands={brands} selfId={user.id} onInvited={people.reload} />}
        </Resolved>
      </Section>
    </div>
  )
}

const field = 'h-9 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'

/**
 * Clienții în care se poate invita: cei vizibili în listă, fără cei în care apelantul apare doar cu propriul rând
 * de alt rol (RLS îi arată propriul membership, dar nu îi dă drept de administrare acolo).
 */
function inviteTenants(list: AccessPerson[], selfId: string): Array<{ id: string; name: string }> {
  const byTenant = new Map<string, AccessPerson[]>()
  for (const p of list) byTenant.set(p.tenant_id, [...(byTenant.get(p.tenant_id) ?? []), p])
  return [...byTenant.entries()]
    .filter(([, rows]) => rows.some((p) => p.user_id !== selfId || (p.role === 'agency_admin' && p.membership_active)))
    .map(([id, rows]) => ({ id, name: rows[0]?.organization || id }))
}

function InviteForm({ list, brands, selfId, onInvited }: { list: AccessPerson[]; brands: Brand[]; selfId: string; onInvited: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const ids = [useId(), useId(), useId(), useId()] as const
  const tenants = useMemo(() => inviteTenants(list, selfId), [list, selfId])
  const [tenantId, setTenantId] = useState(() => tenants.find((t) => brands.some((b) => b.tenant_id === t.id))?.id ?? tenants[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('client_viewer')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  if (tenants.length === 0) return <EmptyState compact title="Niciun client de administrat" text="Invitațiile se trimit în clienții în care ai rolul de administrator al agenției." />

  const tenantBrands = brands.filter((b) => b.tenant_id === tenantId)
  const needsBrand = role !== 'agency_admin'
  const brandIds = needsBrand ? chosen.filter((id) => tenantBrands.some((b) => b.id === id)) : []
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const ok = emailOk && tenantId !== '' && (!needsBrand || brandIds.length > 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    const address = email.trim().toLowerCase()
    const r = await providers.users.invite({ tenant_id: tenantId, email: address, full_name: fullName.trim() || null, role, brand_ids: brandIds })
    setBusy(false)
    if (r.kind !== 'ready') {
      toast(r.kind === 'error' ? r.message : r.reason)
      return
    }
    toast(inviteMessage(r.data, address))
    setEmail('')
    setFullName('')
    setChosen([])
    onInvited()
  }

  return (
    <form onSubmit={submit} aria-label="Trimite invitație" className="flex max-w-[640px] flex-col gap-4">
      {tenants.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids[0]} className="text-[12.5px] font-semibold">Client</label>
          <select id={ids[0]} value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={field}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids[1]} className="text-[12.5px] font-semibold">Email</label>
          <input id={ids[1]} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nume@companie.ro" className={field} autoComplete="off" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids[2]} className="text-[12.5px] font-semibold">Nume (opțional)</label>
          <input id={ids[2]} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Prenume Nume" maxLength={120} className={field} autoComplete="off" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={ids[3]} className="text-[12.5px] font-semibold">Rol</label>
        <select id={ids[3]} value={role} onChange={(e) => setRole(e.target.value as Role)} className={`${field} sm:max-w-[300px]`}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>
      {needsBrand ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1.5 text-[12.5px] font-semibold">Acces la branduri</legend>
          {tenantBrands.length === 0 ? (
            <p className="text-[12.5px] text-text-2">Clientul ales nu are branduri active. Adaugă întâi un site în Clienți și site-uri.</p>
          ) : (
            <span className="flex flex-wrap gap-1.5" role="group" aria-label="Branduri pentru invitație">
              {tenantBrands.map((b) => {
                const on = chosen.includes(b.id)
                return (
                  <FilterChip key={b.id} active={on} onClick={() => setChosen((c) => (on ? c.filter((x) => x !== b.id) : [...c, b.id]))}>
                    {b.name}
                  </FilterChip>
                )
              })}
            </span>
          )}
          {tenantBrands.length > 0 && brandIds.length === 0 && <p className="text-[12px] text-text-2">Alege cel puțin un brand: fără acces la un brand, persoana nu vede nimic.</p>}
        </fieldset>
      ) : (
        <p className="text-[12.5px] text-text-2">Administratorul agenției vede toate brandurile clientului și poate gestiona accesul celorlalți.</p>
      )}
      <p className="text-[12px] leading-snug text-text-2">
        Dacă persoana are deja cont în Analyzator, primește doar accesul, fără email nou. Linkul din invitație expiră; dacă persoana nu l-a folosit la timp, apasă „Retrimite invitația” în tabel.
      </p>
      <div>
        <Button variant="primary" type="submit" loading={busy} disabled={!ok}>Trimite invitația</Button>
      </div>
    </form>
  )
}

function PeopleTable({ list, brands, selfId, onChanged }: { list: AccessPerson[]; brands: Brand[]; selfId: string; onChanged: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<AccessPerson | null>(null)
  const anonymous = list.some((p) => p.name === null && p.email === null)
  const resend = (p: AccessPerson) =>
    run(
      p,
      async () => {
        const r = await providers.users.invite({ tenant_id: p.tenant_id, email: p.email ?? '', full_name: p.name, role: p.role, brand_ids: p.brands.filter((b) => b.active).map((b) => b.brand_id) })
        return r.kind === 'ready' ? { kind: 'ready' } : r
      },
      `Invitația a fost retrimisă la ${p.email ?? ''}.`,
    )
  const key = (p: AccessPerson) => `${p.tenant_id}:${p.user_id}`

  async function run(p: AccessPerson, work: () => Promise<{ kind: string; message?: string; reason?: string }>, ok: string) {
    setBusy(key(p))
    const r = await work()
    setBusy(null)
    if (r.kind === 'ready') {
      toast(ok)
      onChanged()
    } else toast(r.message ?? r.reason ?? 'Modificarea nu a reușit.')
  }

  const columns: Column<AccessPerson>[] = [
    {
      key: 'person',
      header: 'Persoană',
      sortValue: (p) => personLabel(p),
      render: (p) => (
        <span className="inline-flex items-center gap-2.5">
          <Avatar name={personLabel(p)} size="md" tone={p.organization === 'AdSymphony' ? 'accent' : 'lav'} />
          <span className="leading-tight">
            <span className="block text-[13px] font-medium">
              {personLabel(p)}
              {p.user_id === selfId && <span className="ml-1.5 text-[11.5px] font-normal text-text-3">(tu)</span>}
            </span>
            {(p.name !== null || p.email === null) && <span className="block text-[12px] text-text-2">{p.email ?? 'Email indisponibil'}</span>}
          </span>
        </span>
      ),
    },
    { key: 'org', header: 'Organizație', sortValue: (p) => p.organization, render: (p) => p.organization || '—' },
    {
      key: 'role',
      header: 'Rol',
      sortValue: (p) => p.role,
      render: (p) => (
        <select
          aria-label={`Rol pentru ${personLabel(p)}`}
          value={p.role}
          disabled={p.user_id === selfId || busy === key(p)}
          onChange={(e) => void run(p, () => providers.users.setRole(p.tenant_id, p.user_id, e.target.value as Role), 'Rolul a fost schimbat.')}
          className="h-8 rounded-[10px] border border-border-strong bg-surface px-2 text-[12.5px] disabled:opacity-60"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'brands',
      header: 'Acces la branduri',
      render: (p) => (
        <span className="flex flex-wrap gap-1.5" role="group" aria-label={`Branduri pentru ${personLabel(p)}`}>
          {brands.map((b) => {
            const on = p.brands.some((x) => x.brand_id === b.id && x.active)
            return (
              <FilterChip
                key={b.id}
                active={on}
                onClick={() => {
                  if (p.user_id === selfId || busy === key(p) || !p.membership_active) return
                  void run(p, () => providers.users.setBrandAccess(p.tenant_id, p.user_id, b.id, !on), on ? `Accesul la ${b.name} a fost revocat.` : `Accesul la ${b.name} a fost acordat.`)
                }}
              >
                {b.name}
              </FilterChip>
            )
          })}
        </span>
      ),
    },
    { key: 'since', header: 'Din', sortValue: (p) => p.since, render: (p) => <span className="font-mono text-[12px]">{formatDate(p.since.slice(0, 10))}</span> },
    {
      key: 'status',
      header: 'Status',
      sortValue: (p) => (p.membership_active ? 1 : 0),
      render: (p) =>
        p.membership_active ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {p.last_sign_in_at === null ? <StatusChip tone="warn">Invitație neacceptată</StatusChip> : <StatusChip tone="pos">Activ</StatusChip>}
            {p.last_sign_in_at === null && p.email !== null && p.user_id !== selfId && (
              <Button variant="ghost" disabled={busy === key(p)} onClick={() => void resend(p)} aria-label={`Retrimite invitația pentru ${personLabel(p)}`}>
                Retrimite invitația
              </Button>
            )}
            {p.user_id !== selfId && (
              <Button variant="ghost" onClick={() => setConfirm(p)} aria-label={`Revocă accesul pentru ${personLabel(p)}`}>
                Revocă
              </Button>
            )}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <StatusChip tone="neutral">Revocat</StatusChip>
            <Button variant="ghost" disabled={busy === key(p)} onClick={() => void run(p, () => providers.users.setMembershipActive(p.tenant_id, p.user_id, true), 'Accesul a fost restabilit.')} aria-label={`Restabilește accesul pentru ${personLabel(p)}`}>
              Restabilește
            </Button>
          </span>
        ),
    },
  ]

  if (list.length === 0) return <EmptyState compact title="Nicio persoană" text="Nu există încă persoane cu rol în organizațiile la care ai acces." />

  return (
    <div className="flex flex-col gap-3">
      {anonymous && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn-text">Pentru unele persoane contul nu are nici nume, nici email. Identifică persoana după id înainte de a schimba un rol.</p>}
      <SortableTable caption="Persoane cu acces" columns={columns} rows={list} rowKey={key} pageSize={10} emptyText="Nicio persoană." />
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Revoci accesul?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Anulează</Button>
            <Button
              variant="primary"
              onClick={() => {
                const p = confirm
                setConfirm(null)
                if (p) void run(p, () => providers.users.setMembershipActive(p.tenant_id, p.user_id, false), 'Accesul a fost revocat.')
              }}
            >
              Revocă accesul
            </Button>
          </>
        }
      >
        {confirm && (
          <p className="text-[13.5px] leading-relaxed">
            {personLabel(confirm)} ({ROLE_LABELS[confirm.role]}, {confirm.organization}) nu va mai putea intra în Analyzator. Accesul se poate restabili oricând; istoricul rămâne.
          </p>
        )}
      </Dialog>
    </div>
  )
}
