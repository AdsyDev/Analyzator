import type { ProviderResult, SocialPost } from '../../contracts'
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
            {PLATFORM_LABELS[p.platform]} · {FORMAT_LABELS[p.format]} · {p.topic ?? 'Fără topic'}
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
  { key: 'reach', header: 'Reach', align: 'right', sortValue: (p) => p.reach, render: (p) => (p.reach === null ? NO_PERF : formatInteger(p.reach)) },
  { key: 'interactions', header: 'Interacțiuni', align: 'right', sortValue: (p) => p.interactions, render: (p) => (p.interactions === null ? NO_PERF : formatInteger(p.interactions)) },
]

/**
 * Content performance. Postările sub fereastra de maturizare sunt marcate; nu se clasează fără avertizare
 * (spec cap. 17). Lipsa datelor de performanță e „Indisponibil", nu zero.
 */
export function PostsSection({ state, onRetry }: { state: AsyncState<ProviderResult<SocialPost[]>>; onRetry: () => void }) {
  return (
    <Section id="posts" title="Performanța conținutului" description="Postările publicate în perioadă, cu metricile disponibile. Postările mai noi de 7 zile sunt marcate: nu au avut încă timp să acumuleze reacții.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă postările" skeletonClass="h-64">
        {(rows) => <SortableTable caption="Performanța conținutului" columns={columns} rows={rows} rowKey={(p) => p.id} pageSize={8} emptyText="Nicio postare pentru filtrele și perioada alese." />}
      </Resolved>
    </Section>
  )
}
