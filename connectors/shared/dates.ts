// Date calendaristice în Europe/Bucharest (regula proiectului: toate datele în acest fus).

export const PROJECT_TIMEZONE = 'Europe/Bucharest'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROJECT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Ziua calendaristică (YYYY-MM-DD) în Europe/Bucharest pentru un moment dat. */
export function calendarDateInBucharest(instant: Date): string {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Ziua calendaristică anterioară celei din Europe/Bucharest la momentul dat. */
export function previousCalendarDayInBucharest(instant: Date): string {
  const [year, month, day] = calendarDateInBucharest(instant).split('-').map(Number) as [number, number, number]
  // Aritmetică pe date calendaristice (fără ore), deci neafectată de schimbarea orei.
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}
