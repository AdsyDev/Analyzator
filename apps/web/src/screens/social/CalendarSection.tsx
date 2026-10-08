import type { ProviderResult, SocialCalendarItem } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import { StatusChip } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDate } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { PLATFORM_LABELS } from './labels'

/** Calendar: publicări observate, cu data efectivă și etichetele din Planable. Postările fără analytics rămân în calendar. */
export function CalendarSection({ state, onRetry }: { state: AsyncState<ProviderResult<SocialCalendarItem[]>>; onRetry: () => void }) {
  return (
    <Section id="calendar" title="Calendar" description="Publicările observate, cu data efectivă a publicării și etichetele din Planable.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă calendarul" skeletonClass="h-40">
        {(items) => {
          if (items.length === 0) return <EmptyState compact title="Nicio publicare" text="Nu există publicări observate pentru filtrele și perioada alese." />
          const days = [...new Set(items.map((i) => i.date))].sort().reverse()
          return (
            <ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {days.map((d) => (
                <li key={d} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-28 flex-none font-mono text-[12px] text-text-2">{formatDate(d)}</span>
                  <ul className="flex flex-1 flex-wrap items-center gap-2">
                    {items.filter((i) => i.date === d).map((i) => (
                      <li key={i.post_id} className="flex items-center gap-2 text-[12.5px]">
                        <span className="font-medium">{PLATFORM_LABELS[i.platform]}</span>
                        {i.label && <StatusChip tone="lav">{i.label}</StatusChip>}
                        {!i.has_performance && <StatusChip tone="neutral">Date de performanță indisponibile</StatusChip>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )
        }}
      </Resolved>
    </Section>
  )
}
