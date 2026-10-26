import { useId, useMemo, useState, type FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '../../auth/types'
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

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!#%+?'

/** Parolă temporară generată în browser (crypto), fără caractere ușor de confundat. Nu se păstrează nicăieri. */
export function generatePassword(length = 16, random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  return Array.from(random(length), (x) => PASSWORD_ALPHABET[x % PASSWORD_ALPHABET.length]).join('')
}

/** Administrare → Utilizatori (doar `agency_admin`): roluri, acces la organizație și la branduri, invitații și conturi noi. */
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
      <Section id="invite" title="Adaugă o persoană" description="Prin invitație pe email sau direct, cu o parolă temporară pe care persoana o schimbă la prima intrare.">
        <Resolved state={people.state} onRetry={people.reload} loadingLabel="Se încarcă formularul" skeletonClass="h-40">
          {(list) => <AddPersonForm list={list} brands={brands} selfId={user.id} onAdded={people.reload} />}
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

type AddMode = 'invite' | 'account'

function AddPersonForm({ list, brands, selfId, onAdded }: { list: AccessPerson[]; brands: Brand[]; selfId: string; onAdded: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const ids = [useId(), useId(), useId(), useId(), useId()] as const
  const tenants = useMemo(() => inviteTenants(list, selfId), [list, selfId])
  const [tenantId, setTenantId] = useState(() => tenants.find((t) => brands.some((b) => b.tenant_id === t.id))?.id ?? tenants[0]?.id ?? '')
  const [mode, setMode] = useState<AddMode>('invite')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('client_viewer')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Doar până la închiderea ferestrei de confirmare: administratorul transmite parola, apoi ea dispare din pagină.
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  if (tenants.length === 0) return <EmptyState compact title="Niciun client de administrat" text="Persoanele se adaugă în clienții în care ai rolul de administrator al agenției." />

  const tenantBrands = brands.filter((b) => b.tenant_id === tenantId)
  const needsBrand = role !== 'agency_admin'
  const brandIds = needsBrand ? chosen.filter((id) => tenantBrands.some((b) => b.id === id)) : []
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
  const passwordOk = mode === 'invite' || password.length >= MIN_PASSWORD_LENGTH
  const ok = emailOk && passwordOk && tenantId !== '' && (!needsBrand || brandIds.length > 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    const address = email.trim().toLowerCase()
    const input = { tenant_id: tenantId, email: address, full_name: fullName.trim() || null, role, brand_ids: brandIds }
    const r = mode === 'invite' ? await providers.users.invite(input) : await providers.users.createAccount({ ...input, password })
    setBusy(false)
    if (r.kind !== 'ready') {
      toast(r.kind === 'error' ? r.message : r.reason)
      return
    }
    if (r.data.status === 'created') setCreated({ email: address, password })
    else toast(inviteMessage(r.data, address))
    setEmail('')
    setFullName('')
    setPassword('')
    setChosen([])
    onAdded()
  }

  async function copyPassword() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.password)
      toast('Parola a fost copiată.')
    } catch {
      toast('Parola nu a putut fi copiată. Selecteaz-o și copiaz-o manual.')
    }
  }

  return (
    <form onSubmit={submit} aria-label="Adaugă o persoană" className="flex max-w-[640px] flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-1.5 text-[12.5px] font-semibold">Cum adaugi persoana</legend>
        {(
          [
            ['invite', 'Trimite invitație pe email', 'Persoana primește un link și își alege singură parola.'],
            ['account', 'Creează contul cu parolă temporară', 'Fără email. Îi transmiți tu parola, iar la prima intrare o schimbă obligatoriu.'],
          ] as const
        ).map(([value, label, hint]) => (
          <label key={value} className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="radio" name={`${ids[4]}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-0.5" />
            <span className="leading-snug">
              <span className="block font-medium">{label}</span>
              <span className="block text-[12px] text-text-2">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      {mode === 'account' && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids[4]} className="text-[12.5px] font-semibold">Parolă temporară</label>
          <span className="flex flex-wrap items-center gap-2">
            <input
              id={ids[4]}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`Cel puțin ${MIN_PASSWORD_LENGTH} caractere`}
              className={`${field} font-mono sm:max-w-[300px]`}
              autoComplete="off"
              spellCheck={false}
              required
            />
            <Button variant="ghost" type="button" onClick={() => setPassword(generatePassword())}>Generează</Button>
          </span>
          {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && <p className="text-[12px] text-text-2">Parola temporară trebuie să aibă cel puțin {MIN_PASSWORD_LENGTH} caractere.</p>}
        </div>
      )}
      <p className="text-[12px] leading-snug text-text-2">
        {mode === 'invite'
          ? 'Dacă persoana are deja cont în Analyzator, primește doar accesul, fără email nou. Linkul din invitație expiră; dacă persoana nu l-a folosit la timp, apasă „Retrimite invitația” în tabel.'
          : 'Doar pentru adrese fără cont în Analyzator: pentru un cont existent folosește invitația, care acordă doar accesul. Transmite parola pe un canal sigur; după prima intrare, persoana își alege alta, pe care n-o mai știe nimeni.'}
      </p>
      <div>
        <Button variant="primary" type="submit" loading={busy} disabled={!ok}>{mode === 'invite' ? 'Trimite invitația' : 'Creează contul'}</Button>
      </div>
      <Dialog
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Contul a fost creat"
        footer={
          <>
            <Button variant="ghost" onClick={() => void copyPassword()}>Copiază parola</Button>
            <Button variant="primary" onClick={() => setCreated(null)}>Am transmis parola</Button>
          </>
        }
      >
        {created && (
          <div className="flex flex-col gap-3 text-[13.5px] leading-relaxed">
            <p>Transmite-i persoanei adresa și parola temporară pe un canal sigur. La prima intrare va trebui să-și aleagă o parolă nouă.</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-text-2">Email</dt>
              <dd className="font-mono">{created.email}</dd>
              <dt className="text-text-2">Parolă temporară</dt>
              <dd className="select-all font-mono" aria-label="Parola temporară">{created.password}</dd>
            </dl>
            <p className="text-[12.5px] text-text-2">După ce închizi fereastra, parola nu mai poate fi afișată. Dacă se pierde, persoana folosește „Am uitat parola” la autentificare.</p>
          </div>
        )}
      </Dialog>
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
        <span className="flex flex-wrap gap-1.5 max-sm:justify-end sm:min-w-60" role="group" aria-label={`Branduri pentru ${personLabel(p)}`}>
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
            {p.temporary_password ? (
              <span title="Contul a fost creat cu o parolă temporară. Persoana o schimbă obligatoriu la prima intrare.">
                <StatusChip tone="warn">Parolă temporară</StatusChip>
              </span>
            ) : p.last_sign_in_at === null ? (
              <StatusChip tone="warn">Invitație neacceptată</StatusChip>
            ) : (
              <StatusChip tone="pos">Activ</StatusChip>
            )}
            {!p.temporary_password && p.last_sign_in_at === null && p.email !== null && p.user_id !== selfId && (
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
