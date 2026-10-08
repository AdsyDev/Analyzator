import type { AiCitedSource, ProviderResult } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

interface Props {
  state: AsyncState<ProviderResult<AiCitedSource[]>>
  onRetry: () => void
}

export function CitedSources({ state, onRetry }: Props) {
  return (
    <Section id="cited" title="Surse citate" description="Domeniile pe care se sprijină răspunsurile AI, cu numărul de răspunsuri valide în care apar.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă sursele citate">
        {(sources) => {
          if (sources.length === 0) return <EmptyState compact title="Nicio sursă citată" text="Răspunsurile valide din filtrele alese nu citează surse." />
          const max = Math.max(...sources.map((s) => s.count))
          return (
            <ul className="flex flex-col gap-3">
              {sources.map((s) => (
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
          )
        }}
      </Resolved>
    </Section>
  )
}
