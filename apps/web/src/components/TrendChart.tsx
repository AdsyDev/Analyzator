import { ChartLineIcon, TableIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ChartFormat, ChartSeries } from '../lib/chartData'
import { cn } from '../lib/cn'
import { formatCompact } from '../lib/format'
import { Button } from './ui/Button'

const RO = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const RO0 = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 })

/** Valoare în tooltip și tabel. `null` e „Fără date", niciodată 0. */
function fmtValue(v: number | null, f: ChartFormat): string {
  if (v === null) return 'Fără date'
  if (f === 'pct') return `${RO.format(v)} %`
  if (f === 'idx') return RO.format(v)
  return RO0.format(Math.round(v))
}
function fmtAxis(v: number, f: ChartFormat): string {
  if (f === 'pct') return `${RO0.format(v)}%`
  if (f === 'idx') return RO0.format(v)
  return formatCompact(v)
}

export interface TrendChartProps {
  /** Titlul graficului; folosit ca nume accesibil și ca titlu al tabelului alternativ. */
  title: string
  series: ChartSeries[]
  labels: string[]
  height?: number
  format?: ChartFormat
  note?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  /** Motivul când sursa lipsește (status not_connected/unavailable al seriilor). */
  unavailableReason?: string | null
}

export function TrendChart({ title, series, labels, height = 240, format = 'int', note, loading = false, error = null, onRetry, unavailableReason = null }: TrendChartProps) {
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const uid = useId()
  const n = labels.length

  const visible = useMemo(() => series.filter((s) => !hidden[s.key]), [series, hidden])
  const allValues = useMemo(() => visible.flatMap((s) => s.values).filter((v): v is number => v !== null), [visible])
  const hasAnyData = series.some((s) => s.values.some((v) => v !== null))

  if (loading) {
    return <div role="status" aria-label="Se încarcă graficul" className="rounded-xl bg-skeleton" style={{ height }} />
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-10 text-center" style={{ minHeight: height }}>
        <WarningCircleIcon size={22} className="text-neg-text" aria-hidden="true" />
        <p className="font-display text-[15px] font-semibold">Nu am putut încărca graficul</p>
        <p className="text-[13px] text-text-2">{error}</p>
        {onRetry && <Button onClick={onRetry}>Reîncearcă</Button>}
      </div>
    )
  }
  if (!hasAnyData || n === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center" style={{ minHeight: height }}>
        <ChartLineIcon size={22} className="text-text-3" aria-hidden="true" />
        <p className="font-display text-[15px] font-semibold">{unavailableReason ? 'Sursă neconectată' : 'Fără date pentru interval'}</p>
        <p className="max-w-[46ch] text-[13px] text-text-2">{unavailableReason ?? 'Nu există observații în perioada selectată.'}</p>
      </div>
    )
  }

  let min = allValues.length ? Math.min(...allValues) : 0
  let max = allValues.length ? Math.max(...allValues) : 1
  const pad = (max - min) * 0.15 || 1
  min -= pad
  max += pad
  if (format !== 'idx' && min < 0) min = 0
  const span = max - min || 1
  const X = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500)
  const xp = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50)
  const Y = (v: number) => height - ((v - min) / span) * height

  const pathFor = (values: Array<number | null>) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `
      pen = true
    })
    return d.trim()
  }

  // Goluri: zilele în care nicio serie vizibilă nu are date. Hașurate, cu textul „Fără date".
  const gaps: Array<{ left: number; width: number }> = []
  const half = n > 1 ? 50 / (n - 1) : 50
  let start = -1
  for (let i = 0; i < n; i++) {
    const empty = visible.every((s) => s.values[i] === null || s.values[i] === undefined)
    if (empty && start < 0) start = i
    if (start >= 0 && (!empty || i === n - 1)) {
      const end = empty ? i : i - 1
      const left = Math.max(0, xp(start) - half)
      const right = Math.min(100, xp(end) + half)
      gaps.push({ left, width: right - left })
      start = -1
    }
  }

  const grid = [0, 1, 2, 3].map((k) => {
    const v = min + (span * k) / 3
    return { top: Y(v), label: fmtAxis(v, format) }
  })
  const tickIdx = [...new Set([0, Math.round((n - 1) * 0.25), Math.round((n - 1) * 0.5), Math.round((n - 1) * 0.75), n - 1])]

  const hi = hover !== null && hover < n ? hover : null

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width === 0) return
    const ratio = (e.clientX - r.left) / r.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1)))))
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const cur = hover ?? -1
    if (e.key === 'ArrowRight') setHover(Math.min(n - 1, cur + 1))
    else if (e.key === 'ArrowLeft') setHover(Math.max(0, (cur < 0 ? n : cur) - 1))
    else if (e.key === 'Home') setHover(0)
    else if (e.key === 'End') setHover(n - 1)
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  return (
    <figure className="flex w-full flex-col gap-3.5" aria-label={title}>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Serii afișate" className="flex flex-wrap items-center gap-1.5">
          {series.map((s) => {
            const on = !hidden[s.key]
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => ({ ...h, [s.key]: !h[s.key] }))}
                className={cn(
                  'inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-[10px] border border-border px-2.5 text-[12.5px] font-medium transition-colors',
                  on ? 'bg-surface text-text' : 'bg-transparent text-text-3',
                )}
              >
                <span aria-hidden="true" className="w-3.5 border-t-2" style={{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid', opacity: on ? 1 : 0.4 }} />
                {s.name}
              </button>
            )
          })}
        </div>
        <span className="flex-1" />
        <Button variant="ghost" aria-pressed={asTable} icon={asTable ? <ChartLineIcon size={14} aria-hidden="true" /> : <TableIcon size={14} aria-hidden="true" />} onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Vezi graficul' : 'Vezi ca tabel'}
        </Button>
        {note && <span className="basis-full text-[12px] leading-snug text-text-2">{note}</span>}
      </div>

      {asTable ? (
        <div className="max-h-[360px] overflow-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="sticky top-0 bg-surface-2 text-left text-[12px] text-text-2">
                <th scope="col" className="px-4 py-2 font-semibold">Dată</th>
                {visible.map((s) => (
                  <th key={s.key} scope="col" className="px-4 py-2 text-right font-semibold">{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={`${l}-${i}`} className="border-t border-border">
                  <th scope="row" className="px-4 py-1.5 text-left font-mono text-[12px] font-normal text-text-2">{l}</th>
                  {visible.map((s) => {
                    const v = s.values[i] ?? null
                    return (
                      <td key={s.key} className={cn('px-4 py-1.5 text-right tabular-nums', v === null && 'text-text-3')}>
                        {fmtValue(v, format)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative pl-11">
          <div
            role="group"
            tabIndex={0}
            aria-label={`${title}. Folosește săgețile pentru a parcurge zilele.`}
            aria-describedby={`${uid}-hint`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="relative cursor-crosshair rounded-md"
            style={{ height }}
          >
            <span id={`${uid}-hint`} className="sr-only">Tabelul alternativ e disponibil din butonul „Vezi ca tabel".</span>
            {grid.map((g, i) => (
              <div key={i}>
                <div className="absolute inset-x-0 border-t border-grid" style={{ top: g.top }} />
                <span className="absolute -left-11 w-9 -translate-y-1/2 text-right font-mono text-[11px] leading-none text-text-3" style={{ top: g.top }}>
                  {g.label}
                </span>
              </div>
            ))}
            {gaps.map((g, i) => (
              <div
                key={i}
                data-testid="chart-gap"
                className="absolute inset-y-0 rounded"
                style={{ left: `${g.left}%`, width: `${g.width}%`, background: 'repeating-linear-gradient(135deg, var(--gap-a) 0 6px, transparent 6px 12px)' }}
              >
                {g.width > 9 && <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-text-3">Fără date</span>}
              </div>
            ))}
            <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
              {[...visible].reverse().map((s, j, arr) => (
                <path
                  key={s.key}
                  d={pathFor(s.values)}
                  vectorEffect="non-scaling-stroke"
                  fill="none"
                  strokeWidth={j === arr.length - 1 ? 2 : 1.5}
                  strokeDasharray={s.dashed ? '5 5' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ stroke: s.color }}
                />
              ))}
            </svg>
            {hi !== null && (
              <>
                <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-border-strong" style={{ left: `${xp(hi)}%` }} />
                {visible.map((s) => {
                  const v = s.values[hi] ?? null
                  return v === null ? null : (
                    <span
                      key={s.key}
                      className="pointer-events-none absolute -ml-1 -mt-1 size-2 rounded-full border-2 bg-surface"
                      style={{ left: `${xp(hi)}%`, top: Y(v), borderColor: s.color }}
                    />
                  )
                })}
                <div
                  role="tooltip"
                  className="glass-strong pointer-events-none absolute top-2 flex min-w-48 flex-col gap-1.5 rounded-xl px-3 py-2.5"
                  style={{ left: `${xp(hi)}%`, transform: xp(hi) > 60 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
                >
                  <span className="font-mono text-[11.5px] text-text-2">{labels[hi]}</span>
                  {visible.map((s) => {
                    const v = s.values[hi] ?? null
                    return (
                      <div key={s.key} className="flex items-center gap-2 text-[12.5px]">
                        <span aria-hidden="true" className="w-2.5 border-t-2" style={{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }} />
                        <span className="flex-1 whitespace-nowrap">{s.name}</span>
                        <span className={cn('font-semibold tabular-nums', v === null && 'font-normal text-text-3')}>{fmtValue(v, format)}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
          <div className="relative mt-1.5 h-[22px]">
            {tickIdx.map((i, j) => (
              <span
                key={i}
                className="absolute top-1 whitespace-nowrap font-mono text-[11px] leading-none text-text-3"
                style={{ left: `${xp(i)}%`, transform: j === 0 ? 'none' : j === tickIdx.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
              >
                {labels[i]}
              </span>
            ))}
          </div>
        </div>
      )}
    </figure>
  )
}
