import { useState } from 'react'
import { ROLES, type AccessPerson, type Brand, type Role } from '../../contracts'
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

/** Fără nume în sursă, afișăm un id scurt, nu un nume presupus. */
export const personLabel = (p: AccessPerson) => p.name ?? `Utilizator ${p.user_id.slice(0, 8)}`

const INVITE_UNAVAILABLE =
  'Invitarea nu este disponibilă din aplicație: crearea contului și a rolului cere o funcție server care nu există încă. Până atunci, invitația se trimite din panoul Supabase (valabilă 7 zile), iar rolul și accesul la brand se acordă la nivel de bază de date; apoi persoana apare în lista de mai sus.'

/** Administrare → Utilizatori (doar `agency_admin`): roluri, acces la organizație și la branduri. */
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
      <Section id="invite" title="Trimite invitație" description="Invitațiile sunt valabile 7 zile.">
        <EmptyState compact title="Invitarea nu este disponibilă încă" text={INVITE_UNAVAILABLE} />
      </Section>
    </div>
  )
}

function PeopleTable({ list, brands, selfId, onChanged }: { list: AccessPerson[]; brands: Brand[]; selfId: string; onChanged: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<AccessPerson | null>(null)
  const anonymous = list.some((p) => p.name === null)
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
            <span className="block text-[12px] text-text-2">{p.email ?? 'Email indisponibil'}</span>
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
          <span className="inline-flex items-center gap-2">
            <StatusChip tone="pos">Activ</StatusChip>
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
      {anonymous && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn-text">Numele și emailurile nu sunt încă disponibile pentru toate persoanele: ele nu pot fi citite din aplicație. Identifică persoana după id înainte de a schimba un rol.</p>}
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
