import { useState } from 'react'
import type { ComparisonMode, ModuleFilters, PeriodPreset, PeriodSelection, QueryContext } from '../contracts'
import { formatRange } from '../lib/format'
import { comparisonRange, isValidIsoDate, lastCompleteDay, resolvePeriod, type FilterDef } from '../lib/period'
import { Button } from './ui/Button'
import { FilterChip } from './ui/Chip'
import { Menu, type MenuOption } from './ui/Menu'

export interface FilterBarChange {
  period?: PeriodSelection
  comparison?: ComparisonMode
  filters?: ModuleFilters
}

interface FilterBarProps {
  /** Contextul vine din URL. FilterBar nu ține stare proprie de perioadă sau filtre. */
  value: QueryContext
  onChange: (change: FilterBarChange) => void
  onReset: () => void
  filterDefs?: readonly FilterDef[]
  /**
   * Comparația cu anul trecut cere istoric comparabil (spec 2.3) și un mod de calcul pe server;
   * `metrics.comparison_period` nu are încă unul pentru intervale arbitrare, deci implicit e dezactivată.
   */
  yearAgoAvailable?: boolean
  now?: Date
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  '7d': 'Ultimele 7 zile',
  '28d': 'Ultimele 28 de zile',
  month: 'Luna curentă',
  custom: 'Interval personalizat',
}
const COMPARISON_LABELS: Record<ComparisonMode, string> = { previous: 'perioada anterioară', year_ago: 'anul trecut' }

function CustomRange({ now, initial, onApply }: { now?: Date; initial: { from: string; to: string }; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const max = lastCompleteDay(now)
  const valid = isValidIsoDate(from) && isValidIsoDate(to) && from <= to && to <= max
  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-border px-2 pb-1 pt-2.5">
      <label className="flex items-center justify-between gap-2 text-[12px] text-text-2">
        De la
        <input type="date" value={from} max={max} onChange={(e) => setFrom(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-text" />
      </label>
      <label className="flex items-center justify-between gap-2 text-[12px] text-text-2">
        Până la
        <input type="date" value={to} max={max} onChange={(e) => setTo(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-[12.5px] text-text" />
      </label>
      {!valid && <p className="text-[11.5px] text-warn-text">Alege un interval încheiat, cu data de început înaintea celei de sfârșit.</p>}
      <Button variant="primary" disabled={!valid} onClick={() => onApply(from, to)}>
        Aplică intervalul
      </Button>
    </div>
  )
}

export function FilterBar({ value, onChange, onReset, filterDefs = [], yearAgoAvailable = false, now }: FilterBarProps) {
  const { period, comparison, filters } = value
  const compare = comparisonRange(period, comparison)

  const periodOptions: MenuOption[] = (['7d', '28d', 'month'] as const).map((p) => {
    const r = resolvePeriod(p, now)
    return { value: p, label: PRESET_LABELS[p], hint: formatRange(r.from, r.to) }
  })
  periodOptions.push({ value: 'custom', label: PRESET_LABELS.custom, hint: period.preset === 'custom' ? formatRange(period.from, period.to) : undefined })

  const comparisonOptions: MenuOption[] = [
    { value: 'previous', label: 'Perioada anterioară' },
    { value: 'year_ago', label: 'Anul trecut', disabled: !yearAgoAvailable, disabledReason: 'Comparația cu anul trecut nu e disponibilă încă pentru acest interval.' },
  ]

  const chips: Array<{ label: string; clear: () => void }> = []
  if (period.preset !== '28d') chips.push({ label: PRESET_LABELS[period.preset], clear: () => onChange({ period: resolvePeriod('28d', now) }) })
  if (comparison !== 'previous') chips.push({ label: 'vs anul trecut', clear: () => onChange({ comparison: 'previous' }) })
  for (const def of filterDefs) {
    const v = filters[def.key] ?? def.defaultValue
    if (v !== def.defaultValue) {
      const opt = def.options.find((o) => o.value === v)
      chips.push({ label: `${def.label}: ${opt?.label ?? v}`, clear: () => onChange({ filters: { ...filters, [def.key]: def.defaultValue } }) })
    }
  }

  const triggerCls = 'h-9 rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium text-text hover:border-border-strong'

  return (
    <section aria-label="Filtre" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Menu
          label="Perioadă"
          value={period.preset}
          options={periodOptions}
          onSelect={(v) => {
            if (v === 'custom') onChange({ period: { preset: 'custom', from: period.from, to: period.to } })
            else onChange({ period: resolvePeriod(v as PeriodPreset, now) })
          }}
          triggerClassName={triggerCls}
          trigger={
            <>
              <span>{PRESET_LABELS[period.preset]}</span>
              <span className="font-mono text-[11.5px] text-text-2">{formatRange(period.from, period.to)}</span>
            </>
          }
          footer={
            period.preset === 'custom' ? (
              <CustomRange key={`${period.from}-${period.to}`} now={now} initial={period} onApply={(from, to) => onChange({ period: resolvePeriod('custom', now, { from, to }) })} />
            ) : undefined
          }
        />
        <span className="text-[12.5px] text-text-2">vs</span>
        <Menu
          label="Comparație"
          value={comparison}
          options={comparisonOptions}
          onSelect={(v) => onChange({ comparison: v as ComparisonMode })}
          triggerClassName={triggerCls}
          trigger={
            <>
              <span>{COMPARISON_LABELS[comparison]}</span>
              <span className="font-mono text-[11.5px] text-text-2">{formatRange(compare.from, compare.to)}</span>
            </>
          }
        />
        {filterDefs.map((def) => {
          const v = filters[def.key] ?? def.defaultValue
          const current = def.options.find((o) => o.value === v)
          return (
            <Menu
              key={def.key}
              label={def.label}
              value={v}
              options={def.options}
              onSelect={(next) => onChange({ filters: { ...filters, [def.key]: next } })}
              triggerClassName={triggerCls}
              trigger={
                <>
                  <span className="text-text-2">{def.label}:</span>
                  <span>{current?.label ?? v}</span>
                </>
              }
            />
          )
        })}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Filtre active" role="group">
          {chips.map((c) => (
            <FilterChip key={c.label} active onRemove={c.clear}>
              {c.label}
            </FilterChip>
          ))}
          <Button variant="ghost" onClick={onReset}>
            Resetează filtrele
          </Button>
        </div>
      )}
    </section>
  )
}
