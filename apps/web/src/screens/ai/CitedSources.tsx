import { useState } from 'react'
import type { AiCitedSource, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/ui/Chip'
import { paginate, Pager } from '../../components/ui/Pager'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

interface Props {
  state: AsyncState<ProviderResult<AiCitedSource[]>>
  onRetry: () => void
}

/** Câte domenii pe pagină: lista (cel mult 200 de la server) nu mai întinde coloana mult sub matricea de subiecte. */
export const CITED_PAGE_SIZE = 10

export function CitedSources({ state, onRetry }: Props) {
  return (
    <Section id="cited" title="Surse citate" description="Domeniile pe care se sprijină răspunsurile AI, cu numărul de răspunsuri valide în care apar.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă sursele citate">
        {(sources) =>
          sources.length === 0 ? <EmptyState compact title="Nicio sursă citată" text="Răspunsurile valide din filtrele alese nu citează surse." /> : <SourceList sources={sources} />
        }
      </Resolved>
    </Section>
  )
}

/** Lista e încărcată o dată; paginile se schimbă pe loc. Barele se raportează la domeniul cel mai citat din toată lista. */
function SourceList({ sources }: { sources: AiCitedSource[] }) {
  const [page, setPage] = useState(1)
  const max = Math.max(...sources.map((s) => s.count))
  const { visible, current, pages } = paginate(sources, page, CITED_PAGE_SIZE)
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {visible.map((s) => (
          <li key={s.domain} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-mono text-[12.5px] font-medium">{s.domain}</span>
              <StatusChip tone={s.kind === 'owned' ? 'accent' : 'neutral'}>{s.kind === 'owned' ? 'Owned' : 'Terță parte'}</StatusChip>
              <span className="flex-1" />
              <span className="font-semibold tabular-nums">{formatInteger(s.count)}</span>
            </div>
            <div aria-hidden="true" className="h-1 rounded-sm bg-neutral-soft">
              <div className={s.kind === 'owned' ? 'h-full rounded-sm bg-accent' : 'h-full rounded-sm bg-c1'} style={{ width: `${Math.max(4, (100 * s.count) / max)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <Pager current={current} pages={pages} pageSize={CITED_PAGE_SIZE} total={sources.length} onPage={setPage} className="border-t border-border pt-2" />
    </div>
  )
}
