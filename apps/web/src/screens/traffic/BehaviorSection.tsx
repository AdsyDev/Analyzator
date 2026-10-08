import { WarningIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import type { ClarityDevices, Device, MetricDefinition, MetricItem, ProviderResult, SourceStatusInfo } from '../../contracts'
import { DEVICES } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { InfoTip } from '../../components/ui/InfoTip'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatMetricValue } from '../../lib/format'
import { adminPath } from '../../lib/navigation'
import { metricView } from '../../lib/metricView'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { MISSING_DEFINITION } from '../shared/slots'
import { CLARITY_KEYS } from './slots'

const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', mobile: 'Mobil', tablet: 'Tabletă' }
const FALLBACK_LABELS: Record<string, string> = {
  clarity_rage_click_sessions: 'Sesiuni cu rage clicks',
  clarity_dead_click_sessions: 'Sesiuni cu dead clicks',
  clarity_quickback_sessions: 'Sesiuni cu quick backs',
  clarity_scroll_depth: 'Scroll depth mediu',
}

interface Props {
  devices: AsyncState<ProviderResult<ClarityDevices>>
  /** Valorile pe toate device-urile, din registru. */
  items: MetricItem[]
  definitions: Map<string, MetricDefinition>
  /** Starea sursei Clarity, pentru banner când sincronizarea are probleme. */
  source: SourceStatusInfo | null
  canManageSources: boolean
  onRetry: () => void
}

/**
 * „Comportament (Clarity)": cele patru metrici din registru, pe toate device-urile (din registru) și defalcate
 * pe device (din provider). O metrică absentă rămâne „Fără date", nu zero. Definițiile `draft` sunt marcate.
 */
export function BehaviorSection({ devices, items, definitions, source, canManageSources, onRetry }: Props) {
  const navigate = useNavigate()
  const problem = source && (source.state === 'error' || source.state === 'stale')

  return (
    <Section id="behavior" title="Comportament" description="Microsoft Clarity, pe device. Valorile din registru sunt pe toate device-urile; defalcarea pe device vine din sursă.">
      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-warn-soft px-4 py-3 text-[13px] text-warn-text">
          <WarningIcon size={16} className="flex-none" aria-hidden="true" />
          <p className="flex-1 leading-snug">
            Sincronizarea Clarity are probleme{source?.note ? `: ${source.note}` : ''}
            {source?.data_as_of ? ` Date până la ${formatDate(source.data_as_of)}.` : ''} Afișăm ultimele date importate.
          </p>
          {canManageSources && (
            <Button onClick={() => navigate(adminPath('sources'))}>Reconectează în Surse</Button>
          )}
        </div>
      )}
      <Resolved state={devices} onRetry={onRetry} loadingLabel="Se încarcă comportamentul" skeletonClass="h-48">
        {(d) => (
          <div className="flex flex-col gap-2">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">Comportament pe device (Microsoft Clarity)</caption>
                <thead>
                  <tr className="bg-surface-2 text-left text-text-2">
                    <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">Indicator</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Toate</th>
                    {DEVICES.map((dv) => (
                      <th key={dv} scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">{DEVICE_LABELS[dv]}</th>
                    ))}
                    <th scope="col" className="px-3 py-2.5 text-[12px] font-semibold">Stare</th>
                  </tr>
                </thead>
                <tbody>
                  {CLARITY_KEYS.map((key) => {
                    const item = items.find((i) => i.metric_key === key) ?? null
                    const def = definitions.get(key) ?? null
                    const row = d.rows.find((r) => r.metric_key === key)
                    const view = item ? metricView(item) : null
                    const unitOf = item?.unit ?? def?.unit ?? 'count'
                    return (
                      <tr key={key} className="border-t border-border">
                        <th scope="row" className="px-4 py-2.5 text-left font-medium">
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            {def?.label ?? FALLBACK_LABELS[key]}
                            <InfoTip>{def?.formula ?? MISSING_DEFINITION}</InfoTip>
                            {def?.lifecycle === 'draft' && (
                              <span title={def.lifecycle_note ?? undefined}>
                                <StatusChip tone="warn">Provizoriu</StatusChip>
                              </span>
                            )}
                          </span>
                        </th>
                        <td className="px-3 py-2.5 text-right tabular-nums">{view?.valueText ?? <span className="text-text-3">Fără date</span>}</td>
                        {DEVICES.map((dv) => {
                          const cell = row?.cells[dv]
                          const text = cell ? formatMetricValue(cell.value, unitOf) : null
                          return (
                            <td key={dv} className="px-3 py-2.5 text-right tabular-nums">
                              {text ?? <span className="text-text-3">Fără date</span>}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2.5">{view && <CoverageBadge state={view.coverage} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {d.data_as_of && (
              <p className="text-[12px] text-text-2">
                Date până la <span className="font-mono text-[11.5px] text-text">{formatDate(d.data_as_of)}</span>. Definițiile marcate „Provizoriu” se confirmă pe date reale.
              </p>
            )}
          </div>
        )}
      </Resolved>
    </Section>
  )
}
