import { WarningIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import type { ClarityDevices, Device, MetricDefinition, MetricItem, ProviderResult, SourceStatusInfo } from '../../contracts'
import { DEVICES } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { DataCard, DataCardList } from '../../components/ui/DataCard'
import { InfoTip } from '../../components/ui/InfoTip'
import { useIsPhone } from '../../components/ui/useIsPhone'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatMetricValue } from '../../lib/format'
import { sitePath } from '../../lib/navigation'
import { useLayout } from '../../routing/AppLayout'
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
  const { brand } = useLayout()
  const phone = useIsPhone()
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
          {canManageSources && brand && (
            <Button onClick={() => navigate(`${sitePath(brand.id)}?source=clarity`)}>Reconectează în Surse</Button>
          )}
        </div>
      )}
      <Resolved state={devices} onRetry={onRetry} loadingLabel="Se încarcă comportamentul" skeletonClass="h-48">
        {(d) => {
          const noData = <span className="text-text-3">Fără date</span>
          const rows = CLARITY_KEYS.map((key) => {
            const item = items.find((i) => i.metric_key === key) ?? null
            const def = definitions.get(key) ?? null
            const row = d.rows.find((r) => r.metric_key === key)
            const view = item ? metricView(item) : null
            const unitOf = item?.unit ?? def?.unit ?? 'count'
            return {
              key,
              label: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {def?.label ?? FALLBACK_LABELS[key]}
                  <InfoTip>{def?.formula ?? MISSING_DEFINITION}</InfoTip>
                  {def?.lifecycle === 'draft' && (
                    <span title={def.lifecycle_note ?? undefined}>
                      <StatusChip tone="warn">Provizoriu</StatusChip>
                    </span>
                  )}
                </span>
              ),
              all: view?.valueText ?? noData,
              devices: DEVICES.map((dv) => {
                const cell = row?.cells[dv]
                return { device: dv, text: (cell ? formatMetricValue(cell.value, unitOf) : null) ?? noData }
              }),
              badge: view ? <CoverageBadge state={view.coverage} /> : null,
            }
          })
          return (
            <div className="flex flex-col gap-2">
              {phone ? (
                // Telefon: un card pe indicator, cu toate device-urile și apoi fiecare device.
                <DataCardList label="Comportament pe device (Microsoft Clarity)">
                  {rows.map((r) => (
                    <DataCard
                      key={r.key}
                      title={r.label}
                      aside={r.badge}
                      fields={[{ key: 'all', label: 'Toate', value: r.all }, ...r.devices.map((c) => ({ key: c.device, label: DEVICE_LABELS[c.device], value: c.text }))]}
                    />
                  ))}
                </DataCardList>
              ) : (
                <div className="scroll-x relative rounded-xl border border-border">
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
                      {rows.map((r) => (
                        <tr key={r.key} className="border-t border-border">
                          <th scope="row" className="px-4 py-2.5 text-left font-medium">{r.label}</th>
                          <td className="px-3 py-2.5 text-right tabular-nums">{r.all}</td>
                          {r.devices.map((c) => (
                            <td key={c.device} className="px-3 py-2.5 text-right tabular-nums">{c.text}</td>
                          ))}
                          <td className="px-3 py-2.5">{r.badge}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.data_as_of && (
                <p className="text-[12px] text-text-2">
                  Date până la <span className="font-mono text-[11.5px] text-text">{formatDate(d.data_as_of)}</span>. Definițiile marcate „Provizoriu” se confirmă pe date reale.
                </p>
              )}
            </div>
          )
        }}
      </Resolved>
    </Section>
  )
}
