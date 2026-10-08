import type { ContentGap, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

export function ContentGaps({ brandName, state, onRetry }: { brandName: string; state: AsyncState<ProviderResult<ContentGap[]>>; onRetry: () => void }) {
  return (
    <Section id="gaps" title="Content gaps" description={`Căutări unde un competitor e în top 10, iar ${brandName} nu are pagină.`}>
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă content gaps">
        {(gaps) =>
          gaps.length === 0 ? (
            <EmptyState compact title="Niciun content gap" text="Nu am găsit căutări în care un competitor apare și brandul lipsește." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {gaps.map((g) => (
                <li key={g.id} className="flex flex-col gap-1 rounded-xl border border-border bg-surface-2 p-4">
                  <span className="text-[14px] font-semibold text-text">{g.keyword}</span>
                  <span className="text-[12.5px] text-text-2">
                    <span className="font-mono text-text">{g.volume === null ? 'Fără date' : formatInteger(g.volume)}</span> căutări pe lună
                  </span>
                  <span className="text-[12.5px] text-text-2">
                    {g.competitor.name} <span className="font-mono text-[11.5px]">{g.competitor.label}</span> · pe poziția {g.position}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Resolved>
    </Section>
  )
}
