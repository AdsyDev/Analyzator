import { StarIcon } from '@phosphor-icons/react'
import type { IsoDate, MetricDirection, MetricItem } from '../contracts'
import { cn } from '../lib/cn'
import { formatDate, formatMetricValue } from '../lib/format'
import { CoverageBadge } from './CoverageBadge'
import { coveragePercent, coverageStateFor } from '../lib/metricView'
import { reasonFor } from '../lib/warnings'

export interface ComparisonColumn {
  key: string
  /** Eticheta scurtă (C1, C2, C3 sau numele brandului). */
  short: string
  /** Numele întreg, în `title` și pentru cititoarele de ecran. */
  full: string
  kind: 'brand' | 'competitor'
}

/**
 * O celulă: o metrică din provider sau un motiv explicit pentru care nu există date (de ex. competitorii nu au
 * sursă). Motivul nu e o stare de metrică: nu se fabrică un `MetricItem` pentru ce nu a venit de la server.
 */
export type ComparisonCell = MetricItem | { unavailable: string }

const isMetric = (c: ComparisonCell | undefined): c is MetricItem => !!c && 'status' in c

export interface ComparisonRow {
  key: string
  label: string
  /** Din registru. `neutral` = fără direcție bună: nu se marchează cea mai bună valoare. */
  direction?: MetricDirection
  cells: Record<string, ComparisonCell>
}

export interface ComparisonGroup {
  name: string
  /** Sursa grupului, de ex. „SEOmonitor". */
  source?: string
  rows: ComparisonRow[]
}

interface ComparisonTableProps {
  caption: string
  columns: ComparisonColumn[]
  groups: ComparisonGroup[]
  /** Versiunea setului de competitori și data efectivă (spec 2.4). */
  setVersion?: number
  effectiveFrom?: IsoDate
  dataAsOf?: IsoDate | null
  /** Notă de subsol suplimentară; motivele pentru N/A se adaugă automat. */
  note?: string
  /** Numărul de rânduri de schelet cât timp se încarcă. */
  loading?: boolean
}

/**
 * „Cea mai bună valoare" se marchează doar când toate celulele rândului sunt complete (`ok`).
 * O diferență de acoperire împiedică formularea automată a unui clasament (spec 2.4).
 */
function bestKey(row: ComparisonRow, columns: ComparisonColumn[]): string | null {
  const cells = columns.map((c) => [c.key, row.cells[c.key]] as const)
  if (cells.length < 2 || cells.some(([, m]) => !isMetric(m) || m.status !== 'ok' || m.value === null)) return null
  const direction = row.direction ?? 'higher_is_better'
  if (direction === 'neutral') return null
  const higher = direction === 'higher_is_better'
  let best: string | null = null
  let bestVal = 0
  let tie = false
  for (const [key, m] of cells) {
    const v = isMetric(m) ? m.value : null
    if (v == null) continue
    if (best === null || (higher ? v > bestVal : v < bestVal)) {
      best = key
      bestVal = v
      tie = false
    } else if (v === bestVal) tie = true
  }
  return tie ? null : best
}

export function ComparisonTable({ caption, columns, groups, setVersion, effectiveFrom, dataAsOf, note, loading = false }: ComparisonTableProps) {
  if (loading) {
    return <div role="status" aria-label="Se încarcă comparația" className="h-64 rounded-xl bg-skeleton" />
  }

  const reasons: string[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      for (const c of columns) {
        const m = r.cells[c.key]
        const reason = m === undefined ? null : isMetric(m) ? (m.value === null ? reasonFor(m) : null) : m.unavailable
        if (reason && !reasons.includes(reason)) reasons.push(reason)
      }
    }
  }
  const anyBest = groups.some((g) => g.rows.some((r) => bestKey(r, columns) !== null))

  return (
    <div className="flex flex-col gap-3">
      {(setVersion !== undefined || effectiveFrom || dataAsOf) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-text-2">
          {setVersion !== undefined && (
            <span>
              Set de competitori <strong className="font-semibold text-text">v{setVersion}</strong>
            </span>
          )}
          {effectiveFrom && (
            <span>
              Efectiv din <span className="font-mono text-[12px] text-text">{formatDate(effectiveFrom)}</span>
            </span>
          )}
          {dataAsOf && (
            <span>
              Date până la <span className="font-mono text-[12px] text-text">{formatDate(dataAsOf)}</span>
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-1">
        <table className="w-full border-collapse text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-surface-2 text-text-2">
              <th scope="col" className="px-4 py-2.5 text-left text-[12px] font-semibold">Metrică</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" title={c.full} className={cn('px-4 py-2.5 text-right text-[12px] font-semibold', c.kind === 'brand' && 'text-lav-text')}>
                  <span aria-hidden="true">{c.short}</span>
                  <span className="sr-only">{c.full}</span>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.name}>
              <tr className="bg-surface-2/60">
                <th scope="colgroup" colSpan={columns.length + 1} className="px-4 py-2 text-left text-[12px] font-semibold text-text">
                  {g.name}
                  {g.source && <span className="ml-2 font-normal text-text-2">Sursă: {g.source}</span>}
                </th>
              </tr>
              {g.rows.map((r) => {
                const best = bestKey(r, columns)
                return (
                  <tr key={r.key} className="border-t border-border">
                    <th scope="row" className="px-4 py-2.5 text-left font-medium text-text">{r.label}</th>
                    {columns.map((c) => {
                      const m = r.cells[c.key]
                      const metric = isMetric(m) ? m : null
                      const shown = metric && metric.value !== null ? { item: metric, value: metric.value } : null
                      const reason = m === undefined ? null : 'unavailable' in m ? m.unavailable : shown ? null : reasonFor(m)
                      const isBest = best === c.key
                      return (
                        <td key={c.key} className={cn('px-4 py-2.5 text-right tabular-nums', isBest && 'font-semibold text-accent-text')}>
                          {shown ? (
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {isBest && (
                                <>
                                  <StarIcon size={12} weight="fill" aria-hidden="true" />
                                  <span className="sr-only">Cea mai bună valoare:</span>
                                </>
                              )}
                              {formatMetricValue(shown.value, shown.item.unit)}
                              {shown.item.status !== 'ok' && <CoverageBadge state={coverageStateFor(shown.item.status)} pct={coveragePercent(shown.item.coverage)} />}
                            </span>
                          ) : (
                            <span title={reason ?? undefined} className="text-text-3">
                              N/A
                              {reason && <span className="sr-only">: {reason}</span>}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
      </div>
      <div className="flex flex-col gap-1 text-[12px] leading-snug text-text-2">
        {anyBest && <p>Cea mai bună valoare pe rând e marcată doar când toate celulele rândului au date complete.</p>}
        {reasons.map((r) => (
          <p key={r}>N/A: {r}</p>
        ))}
        {note && <p>{note}</p>}
      </div>
    </div>
  )
}
