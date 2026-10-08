import type { AiReferralSource, AiReferrals, ProviderResult } from '../../contracts'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatInteger, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const num = (v: number | null) => (v === null ? <span className="text-text-3">Fără date</span> : formatInteger(v))

const columns: Column<AiReferralSource>[] = [
  { key: 'domain', header: 'Sursă', sortValue: (s) => s.domain, render: (s) => <span className="font-mono text-[12.5px]">{s.domain}</span> },
  { key: 'sessions', header: 'Sesiuni', align: 'right', sortValue: (s) => s.sessions, render: (s) => num(s.sessions) },
  { key: 'key_events', header: 'Key events', align: 'right', sortValue: (s) => s.key_events, render: (s) => num(s.key_events) },
  { key: 'rate', header: 'Rată', align: 'right', sortValue: (s) => s.conversion_rate, render: (s) => formatMetricValue(s.conversion_rate, 'percent') ?? <span className="text-text-3">Fără date</span> },
]

export function AiReferralsSection({ state, onRetry }: { state: AsyncState<ProviderResult<AiReferrals>>; onRetry: () => void }) {
  return (
    <Section id="ai-referrals" title="AI referrals" description="Vizite care vin din linkurile asistenților AI, identificate după domenii și reguli UTM cunoscute.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă AI referrals" skeletonClass="h-40">
        {(d) => (
          <div className="flex flex-col gap-2">
            <SortableTable caption="AI referrals" columns={columns} rows={d.sources} rowKey={(s) => s.domain} pageSize={10} emptyText="Nicio vizită identificată din surse AI în perioada aleasă." />
            <p className="text-[12px] leading-snug text-text-2">
              Reguli de clasificare <strong className="font-semibold text-text">{d.rules_version}</strong>, în vigoare din <span className="font-mono text-[11.5px]">{formatDate(d.rules_effective_from)}</span>. Traficul fără referrer poate ajunge în Direct: arătăm doar partea identificabilă.
            </p>
          </div>
        )}
      </Resolved>
    </Section>
  )
}
