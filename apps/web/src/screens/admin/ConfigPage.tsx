import { useId, useState, type FormEvent } from 'react'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import type { Brand, CompetitorSetVersion, NewCompetitorMember, SeomonitorMapping } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { Dialog } from '../../components/ui/Dialog'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useToast } from '../../components/ui/Toast'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { todayBucharest } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const KIND_LABELS = { brand: 'Brand', multi_brand: 'Multi-brand', excluded: 'Exclus' } as const

const versionColumns: Column<CompetitorSetVersion>[] = [
  {
    key: 'version',
    header: 'Versiune',
    sortValue: (v) => v.version,
    render: (v) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-[12.5px] font-semibold">v{v.version}</span>
        {v.current && <StatusChip tone="pos">În vigoare</StatusChip>}
      </span>
    ),
  },
  { key: 'from', header: 'Efectivă din', sortValue: (v) => v.effective_from, render: (v) => <span className="font-mono text-[12px]">{formatDate(v.effective_from)}</span> },
  {
    key: 'members',
    header: 'Competitori',
    render: (v) => (
      <ul className="flex flex-col gap-0.5">
        {v.members.map((m) => (
          <li key={m.id}>
            <span className="font-mono text-[11px] text-text-3">{m.label}</span> {m.name}
            {m.domain && <span className="text-text-2"> · {m.domain}</span>}
            <span className="block pl-6 text-[12px] text-text-2">
              Planable Listening: {m.listening_keywords.length ? m.listening_keywords.join(', ') : <span className="text-text-3">numele competitorului</span>}
              {' · '}Planable Competitors: {m.social_handles.length ? m.social_handles.map((h) => `@${h}`).join(', ') : <span className="text-text-3">numele competitorului</span>}
              {' · '}Ads Transparency: {m.ads_advertiser_ids.length ? <span className="font-mono text-[11.5px]">{m.ads_advertiser_ids.join(', ')}</span> : <span className="text-text-3">fără advertiser</span>}
            </span>
          </li>
        ))}
        {v.members.length === 0 && <li className="text-text-3">Fără competitori</li>}
      </ul>
    ),
  },
  { key: 'note', header: 'Notă', render: (v) => v.note ?? <span className="text-text-3">—</span> },
]

/** Administrare → Configurare (doar `agency_admin`): competitori cu versiune, aliasuri, grupuri SEOmonitor → brand. */
export function ConfigPage() {
  const { activeBrand, brands } = useLayout()
  return (
    <div className="flex flex-col gap-5">
      {activeBrand ? <BrandConfig key={activeBrand.id} brand={activeBrand} /> : <EmptyState title="Niciun spațiu de brand" text="Nu există niciun spațiu de brand la care să ai acces; nu avem ce configurare să afișăm." />}
      <Mappings brands={brands} />
    </div>
  )
}

function BrandConfig({ brand }: { brand: Brand }) {
  const providers = useProviders()
  const versions = useAsync(() => providers.config.competitorVersions(brand.id), [providers, brand.id])
  const aliases = useAsync(() => providers.config.aliases(brand.id), [providers, brand.id])
  const [editing, setEditing] = useState(false)
  const list = versions.state.status === 'done' && versions.state.value.kind === 'ready' ? versions.state.value.data : null
  // Formularul pornește de la versiunea în vigoare (sau de la cea mai recentă), ca o schimbare să nu ceară rescrierea setului.
  const base = list ? (list.find((v) => v.current) ?? [...list].sort((a, b) => b.version - a.version)[0] ?? null) : null
  return (
    <>
      <Section
        id="competitors"
        title="Competitori"
        description={`Setul pentru ${brand.name}. Versiunile sunt imutabile: o schimbare creează o versiune nouă, cu dată efectivă, iar istoricul rămâne. Pe fiecare competitor: cuvintele Planable Listening de tip „competitor”, profilurile din Planable Competitors și ID-urile de advertiser din Google Ads Transparency.`}
        action={
          <Button variant="primary" icon={<PlusIcon size={14} />} disabled={list === null} onClick={() => setEditing(true)}>
            Versiune nouă
          </Button>
        }
      >
        {editing && <CompetitorVersionDialog brand={brand} base={base} onClose={() => setEditing(false)} onCreated={versions.reload} />}
        <Resolved state={versions.state} onRetry={versions.reload} loadingLabel="Se încarcă competitorii" skeletonClass="h-40">
          {(list) =>
            list.length === 0 ? (
              <EmptyState compact title="Niciun set de competitori" text={`${brand.name} nu are încă un set de competitori. Până la configurare, comparațiile cu competitorii apar ca N/A.`} />
            ) : (
              <SortableTable caption="Versiunile setului de competitori" columns={versionColumns} rows={list} rowKey={(v) => String(v.version)} pageSize={6} emptyText="Nicio versiune." />
            )
          }
        </Resolved>
      </Section>
      <Section id="aliases" title="Aliasuri" description="Denumirile sub care brandul e căutat în răspunsurile AI și în mențiuni.">
        <Resolved state={aliases.state} onRetry={aliases.reload} loadingLabel="Se încarcă aliasurile" skeletonClass="h-24">
          {(list) =>
            list.length === 0 ? (
              <EmptyState compact title="Niciun alias" text={`${brand.name} nu are aliasuri configurate; se folosește doar numele brandului.`} />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {list.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-medium">{a.alias}</span>
                    <span className="text-text-2">· {a.used_in}</span>
                  </li>
                ))}
              </ul>
            )
          }
        </Resolved>
      </Section>
    </>
  )
}

function Mappings({ brands }: { brands: Brand[] }) {
  const providers = useProviders()
  const mappings = useAsync(() => providers.config.seomonitorMappings(), [providers])
  const brandName = (id: string | null) => (id === null ? '—' : (brands.find((b) => b.id === id)?.name ?? 'Alt spațiu'))

  const columns: Column<SeomonitorMapping>[] = [
    { key: 'campaign', header: 'Campanie', sortValue: (m) => m.campaign_id, render: (m) => <span className="font-mono text-[12px]">{m.campaign_id}</span> },
    { key: 'group', header: 'Grup', sortValue: (m) => m.group_id, render: (m) => <span className="font-mono text-[12px]">{m.group_id}</span> },
    { key: 'kind', header: 'Tip', sortValue: (m) => m.kind, render: (m) => <StatusChip tone={m.kind === 'brand' ? 'accent' : m.kind === 'multi_brand' ? 'warn' : 'neutral'}>{KIND_LABELS[m.kind]}</StatusChip> },
    { key: 'brand', header: 'Brand', sortValue: (m) => brandName(m.brand_id), render: (m) => brandName(m.brand_id) },
    {
      key: 'brand_type',
      header: 'Branded / nonbranded',
      render: (m) => (m.brand_type === null ? <span className="text-text-3">—</span> : m.brand_type === 'branded' ? 'Branded' : 'Nonbranded'),
    },
    { key: 'primary', header: 'Vizibilitate principală', render: (m) => (m.is_primary_visibility ? 'Da' : 'Nu') },
    { key: 'version', header: 'Versiune', sortValue: (m) => m.version, render: (m) => <span className="font-mono text-[12px]">v{m.version} · {formatDate(m.effective_from)}</span> },
    { key: 'note', header: 'Notă', render: (m) => m.note ?? <span className="text-text-3">—</span> },
  ]

  return (
    <Section
      id="seomonitor-mappings"
      title="Grupuri SEOmonitor → brand"
      description="Un grup nemapat nu se atribuie niciunui brand, iar unul multi-brand nu se atribuie automat. Versiunea în vigoare pentru fiecare grup."
    >
      <Resolved state={mappings.state} onRetry={mappings.reload} loadingLabel="Se încarcă maparea" skeletonClass="h-40">
        {(list) =>
          list.length === 0 ? (
            <EmptyState compact title="Nicio mapare" text="Niciun grup SEOmonitor nu este mapat încă la un brand; datele de SEOmonitor nu se atribuie până la mapare." />
          ) : (
            <SortableTable caption="Maparea grupurilor SEOmonitor" columns={columns} rows={list} rowKey={(m) => `${m.campaign_id}:${m.group_id}`} pageSize={10} emptyText="Nicio mapare." />
          )
        }
      </Resolved>
    </Section>
  )
}

const field = 'h-9 w-full rounded-[10px] border border-border-strong bg-surface px-3 text-[13px]'
const MAX_MEMBERS = 10

type Draft = { key: number; name: string; domain: string; keywords: string; handles: string; advertisers: string }

/** „a, b ,, c” → ['a', 'b', 'c']: listele se scriu separate prin virgulă; normalizarea (majuscule, @) o face serverul. */
const csv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

function draftsFrom(base: CompetitorSetVersion | null): Draft[] {
  if (!base || base.members.length === 0) return [1, 2, 3].map((key) => ({ key, name: '', domain: '', keywords: '', handles: '', advertisers: '' }))
  return base.members.map((m, i) => ({
    key: i + 1,
    name: m.name,
    domain: m.domain ?? '',
    keywords: m.listening_keywords.join(', '),
    handles: m.social_handles.join(', '),
    advertisers: m.ads_advertiser_ids.join(', '),
  }))
}

/**
 * Versiune nouă a setului de competitori (`create_competitor_set_version`, E4). Pornește de la versiunea de bază; serverul
 * validează tot (data, nume unice, formatul ID-urilor, un cuvânt sau profil la un singur competitor) și răspunde în română.
 */
function CompetitorVersionDialog({ brand, base, onClose, onCreated }: { brand: Brand; base: CompetitorSetVersion | null; onClose: () => void; onCreated: () => void }) {
  const providers = useProviders()
  const toast = useToast()
  const id = useId()
  const today = todayBucharest()
  const [effectiveFrom, setEffectiveFrom] = useState(today)
  const [note, setNote] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFrom(base))
  const [nextKey, setNextKey] = useState(() => drafts.length + 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filled = drafts.filter((d) => d.name.trim() !== '' || d.domain.trim() !== '' || d.keywords.trim() !== '' || d.handles.trim() !== '' || d.advertisers.trim() !== '')
  const ok = filled.length >= 1 && filled.every((d) => d.name.trim() !== '') && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) && effectiveFrom >= today

  const update = (key: number, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    const members: NewCompetitorMember[] = filled.map((d) => ({
      name: d.name.trim(),
      domain: d.domain.trim() || null,
      listening_keywords: csv(d.keywords),
      social_handles: csv(d.handles),
      ads_advertiser_ids: csv(d.advertisers),
    }))
    const r = await providers.config.createCompetitorVersion(brand.id, { effective_from: effectiveFrom, note: note.trim() || null, members })
    setBusy(false)
    if (r.kind !== 'ready') return setError(r.kind === 'error' ? r.message : r.reason)
    toast(`Versiunea v${r.data.version} a setului de competitori a fost creată, în vigoare din ${formatDate(r.data.effective_from)}.`)
    onCreated()
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Versiune nouă: competitorii ${brand.name}`}
      placement="right"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Anulează</Button>
          <Button variant="primary" type="submit" form="competitor-version" loading={busy} disabled={!ok}>Creează versiunea</Button>
        </>
      }
    >
      <form id="competitor-version" onSubmit={submit} className="flex flex-col gap-4" aria-describedby={`${id}-intro`}>
        <p id={`${id}-intro`} className="text-[13px] leading-snug text-text-2">
          {base ? `Pornește de la v${base.version}. ` : ''}Versiunile anterioare rămân neschimbate; perioadele de dinainte de data aplicării folosesc setul vechi. Datele deja colectate apar imediat ce cuvintele și profilurile se potrivesc.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-from`} className="text-[12.5px] font-semibold">Se aplică din</label>
            <input id={`${id}-from`} type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={field} required />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-[12.5px] font-semibold">Notă (opțional)</label>
            <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="de ex. Intră Competitor X" className={field} />
          </div>
        </div>

        <ol className="flex flex-col gap-3" aria-label="Competitorii versiunii">
          {drafts.map((d, i) => {
            const fid = `${id}-m${d.key}`
            return (
              <li key={d.key} className="flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12px] font-semibold text-text-2">C{i + 1}</span>
                  {drafts.length > 1 && (
                    <Button variant="ghost" icon={<TrashIcon size={14} />} onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))} aria-label={`Scoate competitorul C${i + 1}`}>
                      Scoate
                    </Button>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${fid}-name`} className="text-[12px] font-semibold">Nume</label>
                    <input id={`${fid}-name`} value={d.name} onChange={(e) => update(d.key, { name: e.target.value })} maxLength={120} className={field} autoComplete="off" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${fid}-domain`} className="text-[12px] font-semibold">Domeniu</label>
                    <input id={`${fid}-domain`} value={d.domain} onChange={(e) => update(d.key, { domain: e.target.value })} placeholder="exemplu.ro" className={`${field} font-mono`} autoComplete="off" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${fid}-kw`} className="text-[12px] font-semibold">Cuvinte Planable Listening (tip „competitor”)</label>
                  <input id={`${fid}-kw`} value={d.keywords} onChange={(e) => update(d.key, { keywords: e.target.value })} placeholder="separate prin virgulă; gol = numele" className={field} aria-describedby={`${id}-lists`} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${fid}-handles`} className="text-[12px] font-semibold">Profiluri Planable Competitors</label>
                    <input id={`${fid}-handles`} value={d.handles} onChange={(e) => update(d.key, { handles: e.target.value })} placeholder="handle, fără @; gol = numele" className={`${field} font-mono`} aria-describedby={`${id}-lists`} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${fid}-ads`} className="text-[12px] font-semibold">ID-uri advertiser Google</label>
                    <input id={`${fid}-ads`} value={d.advertisers} onChange={(e) => update(d.key, { advertisers: e.target.value })} placeholder="AR…, separate prin virgulă" className={`${field} font-mono`} aria-describedby={`${id}-lists`} />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
        {drafts.length < MAX_MEMBERS && (
          <div>
            <Button
              icon={<PlusIcon size={14} />}
              onClick={() => {
                setDrafts((list) => [...list, { key: nextKey, name: '', domain: '', keywords: '', handles: '', advertisers: '' }])
                setNextKey((k) => k + 1)
              }}
            >
              Adaugă competitor
            </Button>
          </div>
        )}
        <p id={`${id}-lists`} className="text-[12px] leading-snug text-text-3">
          Listele se scriu separate prin virgulă. Fără cuvinte, mențiunile se caută după numele competitorului; fără profiluri, profilurile Planable al căror nume corespunde numelui lui. ID-ul de advertiser e în adresa paginii advertiserului din Ads Transparency Center (/advertiser/AR…). Un cuvânt, un profil sau un advertiser aparține unui singur competitor. Rândurile goale nu se trimit.
        </p>
        <div aria-live="polite">{error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}</div>
      </form>
    </Dialog>
  )
}
