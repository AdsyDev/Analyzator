import type { BrandId, IsoDate } from './common'

/** `90d` și `365d` sunt „trimestru” și „an” din propunerea din 10 nov. 2026: intervale mobile, încheiate ieri. */
export const PERIOD_PRESETS = ['7d', '28d', 'month', '90d', '365d', 'custom'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]

/** Intervalul rezolvat, inclusiv capetele, în Europe/Bucharest. */
export interface DateRange {
  from: IsoDate
  to: IsoDate
}

export interface PeriodSelection extends DateRange {
  preset: PeriodPreset
}

/** `kind` din `metrics.compute`: `mtd` compară cu aceeași porțiune din luna anterioară, `custom` cu perioada anterioară de aceeași lungime. */
export type ServerPeriodKind = 'custom' | 'mtd'

/**
 * `previous`: comparația implicită (spec 2.3), calculată de server după `kind`.
 * `year_ago`: același interval cu un an înainte. Serverul nu o calculează încă pentru intervale
 * arbitrare (`metrics.comparison_period` are doar `custom`, `mtd`, `ytd`); până atunci rămâne dezactivată.
 */
export type ComparisonMode = 'previous' | 'year_ago'

/** Filtre specifice modulelor; cheile sunt allowlist-ul fiecărui modul. Valorile vin din URL. */
export type ModuleFilters = Readonly<Record<string, string>>

/** Contextul unei interogări. Vine integral din URL: componentele nu țin stare proprie de perioadă. */
export interface QueryContext {
  brandId: BrandId
  period: PeriodSelection
  comparison: ComparisonMode
  filters: ModuleFilters
}
