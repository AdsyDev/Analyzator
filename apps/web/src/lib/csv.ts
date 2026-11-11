/**
 * Export CSV pentru tabelele din interfață. Formatul e cel pe care îl deschide Excel în limba română fără pași în plus:
 * separator „;”, zecimale cu virgulă, UTF-8 cu BOM, rânduri CRLF. Datele rămân ISO (YYYY-MM-DD).
 * O valoare lipsă e o celulă goală, niciodată 0 (regula 8).
 */
export type CsvCell = string | number | null | undefined

const SEPARATOR = ';'
/** Un text care începe așa ar fi executat ca formulă de Excel: primește un apostrof în față. */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
  const safe = FORMULA_START.test(v) ? `'${v}` : v
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  return [headers, ...rows].map((r) => r.map(cell).join(SEPARATOR)).join('\r\n') + '\r\n'
}

/** „keywords-urmarite_urinal_2026-10-01_2026-10-31.csv”: doar litere mici fără diacritice, cifre și cratime. */
export function csvFileName(...parts: Array<string | null | undefined>): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const name = parts.filter((p): p is string => !!p).map(slug).filter(Boolean).join('_')
  return `${name || 'export'}.csv`
}

/** Descarcă fișierul din browser. Datele sunt cele deja afișate utilizatorului: nu se face nicio cerere nouă. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
