import type { AiEngine, AiEngineStat, ProviderResult } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import type { AsyncState } from '../../data/useAsync'
import { cn } from '../../lib/cn'
import { formatAbsoluteChange, formatMetricValue } from '../../lib/format'
import { AI_ENGINE_LABELS } from '../../lib/ai'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

interface Props {
  state: AsyncState<ProviderResult<AiEngineStat[]>>
  onRetry: () => void
  selected: AiEngine | null
  onSelect: (engine: AiEngine | null) => void
}

const coverageOf = (s: AiEngineStat) => (s.status === 'unavailable' || s.status === 'not_connected' ? 'unavailable' : s.status === 'partial' ? 'partial' : 'complete')

/** „Mention Rate pe engine": ratele vin calculate de provider din răspunsurile valide; cardul filtrează restul paginii. */
export function EngineCards({ state, onRetry, selected, onSelect }: Props) {
  return (
    <Section id="engines" title="Mention Rate pe engine" description="Procentul de răspunsuri valide în care apare brandul. Apasă pe un engine ca să filtrezi restul paginii.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă engine-urile">
        {(stats) => (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((s) => {
              const on = selected === s.engine
              const pct = s.total_answers > 0 ? (100 * s.valid_answers) / s.total_answers : null
              return (
                <li key={s.engine}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(on ? null : s.engine)}
                    className={cn('flex h-full w-full flex-col gap-2 rounded-xl border bg-surface-2 p-4 text-left transition-colors hover:border-border-strong', on ? 'border-accent ring-2 ring-[var(--ring)]' : 'border-border')}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-text-2">
                      <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-accent-soft font-mono text-[10px] font-semibold text-accent-text">{AI_ENGINE_LABELS[s.engine].slice(0, 2).toUpperCase()}</span>
                      {AI_ENGINE_LABELS[s.engine]}
                    </span>
                    <span className="flex items-baseline gap-2.5">
                      <span className="font-display text-[28px] font-semibold leading-none tabular-nums">{formatMetricValue(s.mention_rate, 'percent') ?? 'Fără date'}</span>
                      {s.delta_pp !== null && (
                        <span className={cn('text-[12.5px] font-semibold tabular-nums', s.delta_pp > 0 ? 'text-pos-text' : s.delta_pp < 0 ? 'text-neg-text' : 'text-text-2')}>{formatAbsoluteChange(s.delta_pp, 'percent')}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2 text-[12px] text-text-2">
                      Valide <span className="font-mono text-text">{s.valid_answers} / {s.total_answers}</span>
                      <span className="flex-1" />
                      <CoverageBadge state={coverageOf(s)} pct={pct} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Resolved>
    </Section>
  )
}
