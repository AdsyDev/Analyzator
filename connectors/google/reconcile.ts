// Reconcilierea totalului nostru cu totalul raportat de sursă, pe același interval, fus orar și proprietate.
// Funcție pură: nu compară mere cu pere. Dacă intervalul, fusul sau proprietatea diferă, rezultatul e
// `incomparable`, nu `mismatch`.

export type ReconcileInput = {
  metric: string
  ours: { total: number | null; start: string; end: string; timezone: string; property: string }
  source: { total: number | null; start: string; end: string; timezone: string; property: string }
  tolerancePct: number
}

export type ReconcileStatus = 'match' | 'within_tolerance' | 'mismatch' | 'incomparable'

export type ReconcileResult = {
  status: ReconcileStatus
  difference: number | null
  difference_pct: number | null
  reason: string | null
}

export function reconcileTotals(input: ReconcileInput): ReconcileResult {
  const { ours, source, tolerancePct } = input
  const incomparable = (reason: string): ReconcileResult => ({ status: 'incomparable', difference: null, difference_pct: null, reason })

  if (ours.start !== source.start || ours.end !== source.end) return incomparable('interval_differs')
  if (ours.timezone !== source.timezone) return incomparable('timezone_differs')
  if (ours.property !== source.property) return incomparable('property_differs')
  if (ours.total === null) return incomparable('our_total_missing')
  if (source.total === null) return incomparable('source_total_missing')

  const difference = ours.total - source.total
  if (Math.abs(difference) < 1e-9) return { status: 'match', difference: 0, difference_pct: source.total === 0 ? null : 0, reason: null }
  if (source.total === 0) return { status: 'mismatch', difference, difference_pct: null, reason: 'source_total_zero' }

  const pct = (difference / source.total) * 100
  const status: ReconcileStatus = Math.abs(pct) <= tolerancePct ? 'within_tolerance' : 'mismatch'
  return { status, difference, difference_pct: Math.round(pct * 10_000) / 10_000, reason: null }
}
