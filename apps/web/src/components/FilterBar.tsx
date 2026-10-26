import { FunnelSimpleIcon } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import type { ComparisonMode, ModuleFilters, PeriodPreset, PeriodSelection, QueryContext } from '../contracts'
import { cn } from '../lib/cn'
import { formatRange } from '../lib/format'
import { comparisonRange, isValidIsoDate, lastCompleteDay, resolvePeriod, type FilterDef } from '../lib/period'
import { Button } from './ui/Button'
import { FilterChip } from './ui/Chip'
import { Dialog } from './ui/Dialog'
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
const YEAR_AGO_UNAVAILABLE = 'Comparația cu anul trecut nu e disponibilă încă pentru acest interval.'
const RANGE_PROBLEM = 'Alege un interval încheiat, cu data de început înaintea celei de sfârșit.'

/** Un interval personalizat e valid dacă e încheiat (până ieri, în Europe/Bucharest) și nu e inversat. */
const isValidRange = (from: string, to: string, max: string) => isValidIsoDate(from) && isValidIsoDate(to) && from <= to && to <= max

const activeFiltersLabel = (n: number) => (n === 1 ? '1 filtru activ' : `${n} filtre active`)

function CustomRange({ now, initial, onApply }: { now?: Date; initial: { from: string; to: string }; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const max = lastCompleteDay(now)
  const valid = isValidRange(from, to, max)
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
      {!valid && <p className="text-[11.5px] text-warn-text">{RANGE_PROBLEM}</p>}
      <Button variant="primary" disabled={!valid} onClick={() => onApply(from, to)}>
        Aplică intervalul
      </Button>
    </div>
  )
}

/** O opțiune radio pe toată lățimea panoului, cu țintă tactilă mare și rândul secundar vizibil (fără tooltip pe telefon). */
function SheetOption({ name, checked, disabled = false, onSelect, label, hint }: { name: string; checked: boolean; disabled?: boolean; onSelect: () => void; label: string; hint?: string }) {
  return (
    <label className={cn('flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2', checked ? 'border-accent bg-accent-soft' : 'border-border', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="size-4 flex-none accent-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-text">{label}</span>
        {hint && <span className="block text-[12px] leading-snug text-text-2">{hint}</span>}
      </span>
    </label>
  )
}

interface FilterSheetProps {
  value: QueryContext
  filterDefs: readonly FilterDef[]
  yearAgoAvailable: boolean
  now?: Date
  onApply: (change: FilterBarChange) => void
  onClose: () => void
}

/**
 * Filtrele pe telefon: un panou de jos cu perioada, comparația și filtrele modulului. Alegerile sunt o ciornă;
 * „Aplică" trimite o singură schimbare (un singur pas în URL), iar închiderea fără „Aplică" nu schimbă nimic.
 */
function FilterSheet({ value, filterDefs, yearAgoAvailable, now, onApply, onClose }: FilterSheetProps) {
  const name = useId()
  const defaults = Object.fromEntries(filterDefs.map((d) => [d.key, d.defaultValue]))
  const [preset, setPreset] = useState<PeriodPreset>(value.period.preset)
  const [from, setFrom] = useState(value.period.from)
  const [to, setTo] = useState(value.period.to)
  const [comparison, setComparison] = useState<ComparisonMode>(value.comparison)
  const [filters, setFilters] = useState<Record<string, string>>(() => ({ ...defaults, ...value.filters }))
  const max = lastCompleteDay(now)
  const customValid = preset !== 'custom' || isValidRange(from, to, max)
  const draftPeriod = customValid ? (preset === 'custom' ? resolvePeriod('custom', now, { from, to }) : resolvePeriod(preset, now)) : null

  function reset() {
    setPreset('28d')
    setComparison('previous')
    setFilters({ ...value.filters, ...defaults })
  }

  function apply() {
    if (!draftPeriod) return
    const change: FilterBarChange = {}
    if (draftPeriod.preset !== value.period.preset || draftPeriod.from !== value.period.from || draftPeriod.to !== value.period.to) change.period = draftPeriod
    if (comparison !== value.comparison) change.comparison = comparison
    if (filterDefs.some((d) => (filters[d.key] ?? d.defaultValue) !== (value.filters[d.key] ?? d.defaultValue))) change.filters = { ...value.filters, ...filters }
    if (Object.keys(change).length > 0) onApply(change)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Filtre"
      placement="bottom"
      footer={
        <>
          <Button variant="ghost" onClick={reset} className="!h-11">
            Resetează
          </Button>
          <Button variant="primary" disabled={!customValid} onClick={apply} className="!h-11 flex-1">
            Aplică
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[12.5px] font-semibold text-text-2">Perioadă</legend>
          {(['7d', '28d', 'month', 'custom'] as const).map((p) => {
            const r = p === 'custom' ? null : resolvePeriod(p, now)
            return <SheetOption key={p} name={`${name}-period`} checked={preset === p} onSelect={() => setPreset(p)} label={PRESET_LABELS[p]} hint={r ? formatRange(r.from, r.to) : undefined} />
          })}
          {preset === 'custom' && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[12px] text-text-2">
                  De la
                  <input type="date" value={from} max={max} onChange={(e) => setFrom(e.target.value)} className="h-11 rounded-lg border border-border bg-surface px-2 text-[13px] text-text" />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-text-2">
                  Până la
                  <input type="date" value={to} max={max} onChange={(e) => setTo(e.target.value)} className="h-11 rounded-lg border border-border bg-surface px-2 text-[13px] text-text" />
                </label>
              </div>
              {!customValid && <p className="text-[12px] text-warn-text">{RANGE_PROBLEM}</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[12.5px] font-semibold text-text-2">Comparație</legend>
          <SheetOption
            name={`${name}-comparison`}
            checked={comparison === 'previous'}
            onSelect={() => setComparison('previous')}
            label="Perioada anterioară"
            hint={draftPeriod ? formatRange(comparisonRange(draftPeriod, 'previous').from, comparisonRange(draftPeriod, 'previous').to) : undefined}
          />
          <SheetOption
            name={`${name}-comparison`}
            checked={comparison === 'year_ago'}
            disabled={!yearAgoAvailable}
            onSelect={() => setComparison('year_ago')}
            label="Anul trecut"
            hint={!yearAgoAvailable ? YEAR_AGO_UNAVAILABLE : draftPeriod ? formatRange(comparisonRange(draftPeriod, 'year_ago').from, comparisonRange(draftPeriod, 'year_ago').to) : undefined}
          />
        </fieldset>

        {filterDefs.map((def) => (
          <fieldset key={def.key} className="flex flex-col gap-2">
            <legend className="mb-2 text-[12.5px] font-semibold text-text-2">{def.label}</legend>
            <div className="flex flex-wrap gap-2">
              {def.options.map((o) => {
                const checked = (filters[def.key] ?? def.defaultValue) === o.value
                return (
                  <label
                    key={o.value}
                    className={cn(
                      'relative inline-flex min-h-10 cursor-pointer items-center rounded-full border px-3.5 text-[13.5px] font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                      checked ? 'border-accent bg-accent-soft text-accent-text' : 'border-border text-text',
                    )}
                  >
                    <input type="radio" name={`${name}-${def.key}`} checked={checked} onChange={() => setFilters((f) => ({ ...f, [def.key]: o.value }))} className="sr-only" />
                    {o.label}
                  </label>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
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
    { value: 'year_ago', label: 'Anul trecut', disabled: !yearAgoAvailable, disabledReason: YEAR_AGO_UNAVAILABLE },
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

  const [sheetOpen, setSheetOpen] = useState(false)
  // Același număr ca al chipurilor de sub buton: perioada, comparația și filtrele modulului diferite de implicit.
  const activeCount = chips.length
  const triggerCls = 'h-9 rounded-[10px] border border-border bg-surface px-3 text-[13px] font-medium text-text hover:border-border-strong'

  return (
    <section aria-label="Filtre" className="flex flex-col gap-2.5">
      {/* Telefon: un singur buton cu rezumatul; panoul de jos are toate filtrele. De la `sm` în sus, bara cu meniuri. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Filtre: ${PRESET_LABELS[period.preset]}, ${formatRange(period.from, period.to)}, vs ${COMPARISON_LABELS[comparison]}${activeCount ? `, ${activeFiltersLabel(activeCount)}` : ''}`}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2 text-left shadow-1 sm:hidden"
      >
        <FunnelSimpleIcon size={18} className="flex-none text-text-2" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-[13.5px] font-semibold text-text">{PRESET_LABELS[period.preset]}</span>
          <span className="block text-[12px] text-text-2">
            <span className="font-mono text-[11.5px]">{formatRange(period.from, period.to)}</span> · vs {COMPARISON_LABELS[comparison]}
          </span>
        </span>
        <span className="flex flex-none items-center gap-1.5 text-[13px] font-semibold text-accent-text">
          Filtre
          {activeCount > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent-btn px-1.5 text-[11.5px] text-on-accent">{activeCount}</span>}
        </span>
      </button>
      {sheetOpen && <FilterSheet value={value} filterDefs={filterDefs} yearAgoAvailable={yearAgoAvailable} now={now} onApply={onChange} onClose={() => setSheetOpen(false)} />}
      <div className="flex flex-wrap items-center gap-2 max-sm:hidden">
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
        {/* „vs" rămâne lipit de comparație: pe ecrane înguste coboară împreună pe rândul următor. */}
        <div className="flex items-center gap-2">
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
        </div>
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
