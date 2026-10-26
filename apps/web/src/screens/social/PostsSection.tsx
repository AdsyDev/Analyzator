import { HeartIcon, EyeIcon, UsersThreeIcon } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import type { ProviderResult, SocialPost } from '../../contracts'
import { SocialPostCard } from '../../components/SocialPostCard'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import { StatusChip } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatInteger } from '../../lib/format'
import { safeUrl } from '../../lib/safeUrl'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { FORMAT_LABELS, PLATFORM_LABELS } from './labels'

const NO_PERF = <span className="text-text-3" title="Date de performanță indisponibile pentru această postare">Indisponibil</span>

const columns: Column<SocialPost>[] = [
  { key: 'date', header: 'Data', sortValue: (p) => p.published_at, render: (p) => <span className="font-mono text-[12px]">{formatDate(p.published_at.slice(0, 10))}</span> },
  {
    key: 'post',
    header: 'Postare',
    sortValue: (p) => p.excerpt,
    render: (p) => {
      const href = safeUrl(p.permalink)
      return (
        <span className="flex flex-col gap-0.5">
          <span className="max-w-[44ch] text-[13px] leading-snug text-text">{p.excerpt}</span>
          <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-text-2">
            {PLATFORM_LABELS[p.platform]}{p.format && ` · ${FORMAT_LABELS[p.format]}`}{p.topic && ` · ${p.topic}`}
            {p.label && <StatusChip tone="lav">{p.label}</StatusChip>}
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
                Deschide postarea
              </a>
            ) : (
              <span className="text-text-3">Link indisponibil</span>
            )}
          </span>
        </span>
      )
    },
  },
  { key: 'age', header: 'Vârstă', align: 'right', sortValue: (p) => p.age_days, render: (p) => (p.mature ? <span>{p.age_days} zile</span> : <span title="Sub fereastra comună de maturizare (7 zile): metricile pot fi incomplete"><StatusChip tone="warn">{p.age_days} {p.age_days === 1 ? 'zi' : 'zile'}, date incomplete</StatusChip></span>) },
  { key: 'impressions', header: 'Afișări', align: 'right', sortValue: (p) => p.impressions, render: (p) => (p.impressions === null ? NO_PERF : formatInteger(p.impressions)) },
  { key: 'reach', header: 'Reach', align: 'right', sortValue: (p) => p.reach, render: (p) => (p.reach === null ? NO_PERF : formatInteger(p.reach)) },
  { key: 'interactions', header: 'Interacțiuni', align: 'right', sortValue: (p) => p.interactions, render: (p) => (p.interactions === null ? NO_PERF : formatInteger(p.interactions)) },
]

const CARDS_STEP = 8
type View = 'cards' | 'table'

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-2" title={label}>
      {icon}
      <span className="sr-only">{label}: </span>
      {value === null ? <span className="text-text-3">Indisponibil</span> : <span className="font-medium text-text">{formatInteger(value)}</span>}
    </span>
  )
}

/** O postare a brandului ca pe rețea (E-3): textul, etichetele și interacțiunile; lipsa performanței e „Indisponibil”. */
function PostCard({ p, brandName }: { p: SocialPost; brandName: string }) {
  return (
    <SocialPostCard
      platform={p.platform}
      author={brandName}
      own
      publishedAt={p.published_at}
      text={p.excerpt}
      href={safeUrl(p.permalink)}
      tags={
        p.format || p.topic || p.label || !p.mature ? (
          <>
            {p.format && <StatusChip tone="neutral">{FORMAT_LABELS[p.format]}</StatusChip>}
            {p.topic && <StatusChip tone="neutral">{p.topic}</StatusChip>}
            {p.label && <StatusChip tone="lav">{p.label}</StatusChip>}
            {!p.mature && (
              <span title="Sub fereastra comună de maturizare (7 zile): metricile pot fi incomplete">
                <StatusChip tone="warn">{p.age_days} {p.age_days === 1 ? 'zi' : 'zile'}, date incomplete</StatusChip>
              </span>
            )}
          </>
        ) : undefined
      }
      footer={
        <>
          <Stat icon={<EyeIcon size={15} aria-hidden="true" />} label="Afișări" value={p.impressions} />
          <Stat icon={<UsersThreeIcon size={15} aria-hidden="true" />} label="Reach" value={p.reach} />
          <Stat icon={<HeartIcon size={15} aria-hidden="true" />} label="Interacțiuni" value={p.interactions} />
        </>
      }
    />
  )
}

function PostCards({ rows, brandName }: { rows: SocialPost[]; brandName: string }) {
  const [shown, setShown] = useState(CARDS_STEP)
  if (rows.length === 0) return <p className="text-[13px] text-text-2">Nicio postare pentru filtrele și perioada alese.</p>
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Postări" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.slice(0, shown).map((p) => (
          <li key={p.id} data-testid="post">
            <PostCard p={p} brandName={brandName} />
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 text-[12px] text-text-2">
        <span>{Math.min(shown, rows.length)} din {rows.length}</span>
        <span className="flex-1" />
        {shown < rows.length && <Button variant="ghost" onClick={() => setShown((n) => n + CARDS_STEP)}>Mai multe postări</Button>}
      </div>
    </div>
  )
}

/**
 * Content performance. Implicit, postările apar ca pe rețea (carduri, E-3); tabelul rămâne pentru sortare după metrici.
 * Postările sub fereastra de maturizare sunt marcate; nu se clasează fără avertizare (spec cap. 17). Lipsa datelor de
 * performanță e „Indisponibil", nu zero.
 */
export function PostsSection({ state, onRetry, brandName }: { state: AsyncState<ProviderResult<SocialPost[]>>; onRetry: () => void; brandName: string }) {
  const [view, setView] = useState<View>('cards')
  return (
    <Section
      id="posts"
      title="Performanța conținutului"
      description="Postările publicate în perioadă, cu metricile disponibile. Postările mai noi de 7 zile sunt marcate: nu au avut încă timp să acumuleze reacții. Imaginile și video-urile nu se importă; „Vezi pe …” deschide postarea originală."
      action={<Tabs label="Afișarea postărilor" items={[{ id: 'cards', label: 'Carduri' }, { id: 'table', label: 'Tabel' }]} value={view} onChange={setView} />}
    >
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă postările" skeletonClass="h-64">
        {(rows) =>
          view === 'cards' ? (
            <PostCards rows={rows} brandName={brandName} />
          ) : (
            <SortableTable caption="Performanța conținutului" columns={columns} rows={rows} rowKey={(p) => p.id} pageSize={8} emptyText="Nicio postare pentru filtrele și perioada alese." phoneCards={false} />
          )
        }
      </Resolved>
    </Section>
  )
}
