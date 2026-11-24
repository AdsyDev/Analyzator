import { PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import type { Brand, CompetitorSetVersion, SeomonitorMapping } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { useLayout } from '../../routing/AppLayout'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { CompetitorSetDialog } from './CompetitorSetDialog'

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
  const open = () => setEditing(true)
  return (
    <>
      <Section
        id="competitors"
        title="Competitori"
        description={`Setul pentru ${brand.name}. Versiunile sunt imutabile: o schimbare creează o versiune nouă, cu dată efectivă, iar istoricul rămâne. Prima versiune poate începe în trecut; următoarele, de azi înainte. Pe fiecare competitor: cuvintele Planable Listening de tip „competitor”, profilurile din Planable Competitors și ID-urile de advertiser din Google Ads Transparency.`}
        action={list && list.length > 0 ? <Button icon={<PlusIcon size={14} weight="bold" />} onClick={open}>Versiune nouă</Button> : undefined}
      >
        <Resolved state={versions.state} onRetry={versions.reload} loadingLabel="Se încarcă competitorii" skeletonClass="h-40">
          {(list) =>
            list.length === 0 ? (
              <EmptyState
                compact
                title="Niciun set de competitori"
                text={`${brand.name} nu are încă un set de competitori, așa că paginile Overview și Competiție arată „Sursă neconectată”. Configurează-l: poți porni de la propunerile din Planable și SEOmonitor.`}
                action={{ label: 'Configurează competitorii', onClick: open, icon: <PlusIcon size={14} weight="bold" /> }}
              />
            ) : (
              <SortableTable caption="Versiunile setului de competitori" columns={versionColumns} rows={list} rowKey={(v) => String(v.version)} pageSize={6} emptyText="Nicio versiune." />
            )
          }
        </Resolved>
      </Section>
      {editing && list && <CompetitorSetDialog brand={brand} versions={list} onClose={() => setEditing(false)} onCreated={versions.reload} />}
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
