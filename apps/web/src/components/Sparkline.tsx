import { useId } from 'react'
import { continuousRuns, linePath } from '../lib/chartPath'

interface SparklineProps {
  /** Numele accesibil: ce serie arată și pe ce interval. */
  label: string
  /** `null` = zi fără date: linia se întrerupe, nu coboară la zero. */
  values: Array<number | null>
  color?: string
  height?: number
}

/**
 * Linie mică, netedă, cu arie în degrade și punct pe ultima valoare. E o ilustrare a formei seriei: nu are axe și nu
 * calculează nimic. Valorile exacte stau în graficul complet al modulului, spre care duce cardul.
 */
export function Sparkline({ label, values, color = 'var(--accent)', height = 72 }: SparklineProps) {
  const uid = useId()
  const present = values.filter((v): v is number => v !== null && v !== undefined)
  if (present.length === 0) return null
  const n = values.length
  const min = Math.min(...present)
  const max = Math.max(...present)
  const span = max - min || 1
  const pad = 6
  const X = (i: number) => (n > 1 ? (i / (n - 1)) * 1000 : 500)
  const Y = (v: number) => pad + (1 - (v - min) / span) * (height - 2 * pad)

  // Porțiunile continue: fiecare are linia ei și aria ei, ca un gol să rămână gol.
  const runs = continuousRuns(values)
  const line = (idx: number[]) => linePath(idx.map((i) => ({ x: X(i), y: Y(values[i] as number) })), true)
  const lastRun = runs[runs.length - 1]!
  const last = lastRun[lastRun.length - 1]!

  return (
    <div role="img" aria-label={label} className="relative w-full" style={{ height }}>
      <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.3 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {runs.map((idx) => (
          <g key={idx[0]}>
            {idx.length > 1 && <path d={`${line(idx)} L${X(idx[idx.length - 1]!).toFixed(1)} ${height} L${X(idx[0]!).toFixed(1)} ${height} Z`} stroke="none" fill={`url(#${uid}-fill)`} />}
            <path d={line(idx)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ stroke: color }} />
          </g>
        ))}
      </svg>
      <span aria-hidden="true" className="pointer-events-none absolute -ml-[5px] -mt-[5px] size-2.5 rounded-full ring-2 ring-surface" style={{ left: `${n > 1 ? (last / (n - 1)) * 100 : 50}%`, top: Y(values[last] as number), background: color }} />
    </div>
  )
}
