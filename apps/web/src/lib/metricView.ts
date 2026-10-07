import type { MetricDirection, MetricItem, MetricStatus } from '../contracts'
import { formatAbsoluteChange, formatMetricValue, formatRelativeChange } from './format'
import { notesFor, reasonFor } from './warnings'

/** Starea badge-ului de acoperire (design: Complet, Parțial, Învechit, Indisponibil). */
export type CoverageState = 'complete' | 'partial' | 'stale' | 'unavailable'

export function coverageStateFor(status: MetricStatus): CoverageState {
  switch (status) {
    case 'ok':
    case 'base_zero':
      return 'complete'
    case 'partial':
    case 'insufficient_sample':
      return 'partial'
    case 'stale':
      return 'stale'
    case 'cannot_compute':
    case 'unavailable':
    case 'not_connected':
      return 'unavailable'
  }
}

/** `coverage` vine ca fracție 0-1; badge-ul și textele afișează procente întregi. */
export function coveragePercent(coverage: number | null): number | null {
  return coverage === null ? null : Math.round(coverage * 100)
}

/** `neutral` = fără direcție bună: variația nu primește culoare pozitiv/negativ. */
export function isGoodChange(direction: MetricDirection, dir: DeltaDirection): boolean | null {
  if (dir === 'flat' || direction === 'neutral') return null
  return (dir === 'up') === (direction === 'higher_is_better')
}

export type DeltaDirection = 'up' | 'down' | 'flat'

export interface MetricView {
  /** `false` când nu există valoare: se afișează un conținut gol explicat, nu o cifră. */
  hasValue: boolean
  valueText: string | null
  deltaText: string | null
  deltaDirection: DeltaDirection | null
  /** Motivul stării (partial, stale, insufficient_sample, base_zero). */
  caveat: string | null
  /** Note secundare din avertismente (perioadă incompletă, comparație parțială etc.). */
  notes: string[]
  /** Titlul și motivul stării fără valoare. */
  emptyTitle: string | null
  emptyReason: string | null
  coverage: CoverageState
}

const EMPTY_TITLES: Partial<Record<MetricStatus, string>> = {
  not_connected: 'Sursă neconectată',
  unavailable: 'Fără date pentru interval',
  cannot_compute: 'Nu se poate calcula',
  // `partial` cu valoare nulă: zero neconfirmat (spec 2.2).
  partial: 'Valoare neconfirmată',
}

const dirOf = (n: number): DeltaDirection => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat')

/**
 * Transformă un `MetricItem` în text pentru afișare. Doar formatare: nu calculează și nu
 * deduce câmpuri lipsă (regula 4 și 8). Absența valorii se decide după `value`, nu după status:
 * `partial` poate avea `value: null`.
 */
export function metricView(m: MetricItem): MetricView {
  const notes = notesFor(m)
  if (m.value === null) {
    return {
      hasValue: false,
      valueText: null,
      deltaText: null,
      deltaDirection: null,
      caveat: null,
      notes,
      emptyTitle: EMPTY_TITLES[m.status] ?? 'Fără date pentru interval',
      emptyReason: reasonFor(m),
      coverage: m.status === 'partial' || m.status === 'insufficient_sample' || m.status === 'stale' ? coverageStateFor(m.status) : 'unavailable',
    }
  }

  let deltaText: string | null = null
  let deltaDirection: DeltaDirection | null = null
  if (m.unit === 'percent' || m.relative_change === null || m.status === 'base_zero') {
    // La rate, variația principală e în puncte procentuale; la `base_zero` nu există variație relativă.
    if (m.absolute_change !== null) {
      deltaText = formatAbsoluteChange(m.absolute_change, m.unit)
      deltaDirection = dirOf(m.absolute_change)
    }
  } else {
    deltaText = formatRelativeChange(m.relative_change)
    deltaDirection = dirOf(m.relative_change)
  }

  const caveatStatuses: MetricStatus[] = ['partial', 'stale', 'insufficient_sample', 'base_zero']
  return {
    hasValue: true,
    valueText: formatMetricValue(m.value, m.unit),
    deltaText,
    deltaDirection,
    caveat: caveatStatuses.includes(m.status) ? reasonFor(m) : null,
    notes,
    emptyTitle: null,
    emptyReason: null,
    coverage: coverageStateFor(m.status),
  }
}
