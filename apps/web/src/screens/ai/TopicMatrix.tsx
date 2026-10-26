import type { AiMatrixCell, AiMatrixEntity, AiTopicMatrix, ProviderResult } from '../../contracts'
import { CoverageBadge } from '../../components/CoverageBadge'
import { DataCard, DataCardList } from '../../components/ui/DataCard'
import { useIsPhone } from '../../components/ui/useIsPhone'
import type { AsyncState } from '../../data/useAsync'
import { cn } from '../../lib/cn'
import { formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

interface Props {
  state: AsyncState<ProviderResult<AiTopicMatrix>>
  onRetry: () => void
}

function cellText(c: AiMatrixCell | undefined): string {
  return c && c.value !== null ? (formatMetricValue(c.value, 'percent') ?? 'Fără date') : 'Fără date'
}

/** Intensitatea culorii urmărește rata, dar valoarea e mereu scrisă în celulă (sensul nu stă doar în culoare). */
function heat(c: AiMatrixCell | undefined): React.CSSProperties | undefined {
  if (!c || c.value === null) return undefined
  const alpha = Math.min(0.5, Math.max(0.06, c.value / 140))
  return { background: `rgba(var(--heat), ${alpha})` }
}

function detailOf(e: AiMatrixEntity, topic: string, c: AiMatrixCell | undefined): string {
  return c && c.denominator !== null ? `${e.name}, ${topic}: ${c.numerator} din ${c.denominator} răspunsuri valide` : `${e.name}, ${topic}: fără răspunsuri valide`
}

export function TopicMatrix({ state, onRetry }: Props) {
  const phone = useIsPhone()
  return (
    <Section id="matrix" title="Subiecte și competitori" description="Rata de menționare pe fiecare subiect din panel, pentru brand și competitori. Numărul de răspunsuri valide și acoperirea sunt sub fiecare subiect.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă matricea" skeletonClass="h-56">
        {(m) => (
          <div className="flex flex-col gap-2">
            {phone ? (
              // Telefon: un card pe subiect, cu brandul și competitorii unul sub altul; culoarea rămâne pe valoare.
              <DataCardList label="Rata de menționare pe subiect, pentru brand și competitori">
                {m.topics.map((t) => (
                  <DataCard
                    key={t.topic}
                    title={t.topic}
                    aside={t.coverage !== null ? <CoverageBadge state={t.coverage >= 1 ? 'complete' : 'partial'} pct={Math.round(t.coverage * 100)} /> : undefined}
                    fields={[
                      { key: 'n', label: 'Răspunsuri valide (n)', value: <span className="font-mono">{t.n}</span> },
                      ...m.entities.map((e) => {
                        const c = m.cells[t.topic]?.[e.id]
                        return {
                          key: e.id,
                          label: (
                            <span className={cn(e.kind === 'brand' && 'font-semibold text-lav-text')}>
                              {e.name}
                              {e.kind === 'competitor' && <span className="ml-1 font-mono text-[10.5px] text-text-3">{e.label}</span>}
                            </span>
                          ),
                          value: (
                            <span style={heat(c)} className={cn('rounded-md px-1.5 py-0.5', (!c || c.value === null) && 'text-text-3')}>
                              {cellText(c)}
                              <span className="sr-only">. {detailOf(e, t.topic, c)}</span>
                            </span>
                          ),
                        }
                      }),
                    ]}
                  />
                ))}
              </DataCardList>
            ) : (
              <div className="scroll-x relative rounded-xl border border-border">
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">Rata de menționare pe subiect, pentru brand și competitori</caption>
                  <thead>
                    <tr className="bg-surface-2 text-left text-text-2">
                      <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">Subiect</th>
                      {m.entities.map((e: AiMatrixEntity) => (
                        <th key={e.id} scope="col" className={cn('px-3 py-2.5 text-right text-[12px] font-semibold', e.kind === 'brand' && 'text-lav-text')}>
                          {e.name}
                          {e.kind === 'competitor' && <span className="ml-1 font-mono text-[10.5px] font-normal text-text-3">{e.label}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {m.topics.map((t) => (
                      <tr key={t.topic} className="border-t border-border">
                        <th scope="row" className="px-4 py-2.5 text-left align-top font-medium text-text">
                          {t.topic}
                          <span className="mt-0.5 flex items-center gap-2 text-[11.5px] font-normal text-text-2">
                            n = <span className="font-mono">{t.n}</span>
                            {t.coverage !== null && <CoverageBadge state={t.coverage >= 1 ? 'complete' : 'partial'} pct={Math.round(t.coverage * 100)} />}
                          </span>
                        </th>
                        {m.entities.map((e) => {
                          const c = m.cells[t.topic]?.[e.id]
                          const detail = detailOf(e, t.topic, c)
                          return (
                            <td key={e.id} title={detail} style={heat(c)} className={cn('px-3 py-2.5 text-right tabular-nums', (!c || c.value === null) && 'text-text-3')}>
                              {cellText(c)}
                              <span className="sr-only">. {detail}</span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[12px] leading-snug text-text-2">Culoarea mai intensă înseamnă o rată mai mare. „Fără date” înseamnă că subiectul nu are răspunsuri valide; nu e zero.</p>
          </div>
        )}
      </Resolved>
    </Section>
  )
}
