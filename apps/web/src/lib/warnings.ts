import type { MetricItem, MetricStatus, MetricWarning } from '../contracts'
import { formatDate } from './format'
import { count } from './runReason'
import { sourceName } from './sources'

const has = (m: MetricItem, code: string) => m.warnings.some((w) => w.code === code)

const dayOfWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay()
const lengthInDays = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
const isLastDayOfMonth = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).getUTCDate() === 1

/**
 * Intervalele pentru care conectorul GA4 cere raport de utilizatori activi (`connectors/google/intervals.ts`):
 * 1, 4 sau 13 săptămâni luni–duminică, sau o lună calendaristică întreagă. Doar forma; dacă raportul există
 * decide serverul.
 */
function isReportedShape(p: { start: string; end: string }): boolean {
  const weeks = dayOfWeek(p.start) === 1 && dayOfWeek(p.end) === 0 && [7, 28, 91].includes(lengthInDays(p.start, p.end))
  const month = p.start.endsWith('-01') && p.start.slice(0, 7) === p.end.slice(0, 7) && isLastDayOfMonth(p.end)
  return weeks || month
}

/** `interval_report_only`: valoarea există doar ca raport pe exact intervalul cerut (zilele nu se însumează). */
function intervalReportText(m: MetricItem): string {
  return isReportedShape(m.evidence_query.period)
    ? 'Raportul pe aceste săptămâni nu a fost adus încă. Se aduce la colectarea de marți, doar pentru ultimele săptămâni complete; zilele nu se însumează.'
    : 'Se raportează doar pe săptămâni complete. Alege „Ultima săptămână”, „Ultimele 4 săptămâni” sau „Ultimele 13 săptămâni”; zilele nu se însumează.'
}
const pct = (c: number | null) => (c === null ? null : Math.round(c * 100))

/** AB: comparația pe aceeași porțiune din perioada de referință, când perioada curentă nu are date până la final. */
function matchedText(w: MetricWarning | undefined): string | null {
  const days = w && w.detail && typeof w.detail === 'object' ? (w.detail as { days?: unknown }).days : null
  return typeof days === 'number' && Number.isInteger(days) && days > 0
    ? `Variația compară ${days === 1 ? 'prima zi' : `primele ${count(days, 'zile')}`} din fiecare perioadă.`
    : null
}

/**
 * Motivul principal al stării unei metrici, în română. Serverul trimite doar coduri (`warnings`);
 * textul se produce aici, din status, acoperire și coduri. Nu inventează cauze: fără cod cunoscut,
 * spune doar ce se știe.
 */
export function reasonFor(m: MetricItem): string | null {
  switch (m.status) {
    case 'ok':
      return null
    case 'not_connected':
      return `${m.source ? `Sursa ${sourceName(m.source)}` : 'Sursa'} nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.`
    case 'unavailable':
      if (has(m, 'query_failed')) return 'Sursa nu a răspuns la interogare. Nu o tratăm ca zero; reîncearcă mai târziu.'
      if (has(m, 'duplicate_observations')) return 'Există observații duplicate pentru aceeași zi, deci valoarea nu se calculează.'
      if (has(m, 'interval_report_missing')) return intervalReportText(m)
      if (has(m, 'no_observation')) return 'Nu există nicio observație până la sfârșitul intervalului.'
      if (has(m, 'no_confirmed_data')) return 'Nicio zi din interval nu are date confirmate.'
      return 'Nu există date confirmate pentru interval.'
    case 'cannot_compute':
      return 'Numitorul este zero, deci indicatorul nu se poate calcula.'
    case 'partial': {
      const c = pct(m.coverage)
      if (m.value === null && has(m, 'zero_not_confirmed')) {
        return `Valoarea 0 nu e confirmată: datele acoperă ${c ?? 0}% din zilele intervalului.`
      }
      const base = c === null ? 'Date parțiale pentru interval.' : `Date disponibile pentru ${c}% din zilele intervalului.`
      const matched = matchedText(m.warnings.find((w) => w.code === 'comparison_matched'))
      return [base, has(m, 'excluded_rows') ? 'Unele rânduri au fost excluse din calcul.' : null, matched].filter(Boolean).join(' ')
    }
    case 'stale':
      return m.data_as_of ? `Ultimele date sunt din ${formatDate(m.data_as_of)}; sursa nu s-a actualizat la timp.` : 'Sursa nu s-a actualizat la timp.'
    case 'insufficient_sample':
      return 'Eșantion mic: sub pragul minim din definiția indicatorului. Interpretează cu prudență.'
    case 'base_zero':
      return 'Variația relativă nu e definită: baza de comparație e 0.'
  }
}

const NOTE_TEXT: Record<string, (w: MetricWarning) => string | null> = {
  incomplete_period: () => 'Perioadă incompletă.',
  comparison_unavailable: () => 'Comparația nu e disponibilă pentru perioada de referință.',
  comparison_partial: () => 'Perioada de comparație are date parțiale.',
  comparison_matched: (w) => matchedText(w),
  excluded_rows: () => 'Unele rânduri au fost excluse din calcul.',
  definition_draft: (w) => `Definiție provizorie${typeof w.detail === 'string' && w.detail ? `: ${w.detail}` : '.'}`,
  // Condiții secundare: statusul principal e altul, dar condiția rămâne vizibilă.
  stale: () => 'Datele sunt întârziate.',
  partial: () => 'Date parțiale.',
  insufficient_sample: () => 'Eșantion mic.',
  base_zero: () => 'Baza de comparație e 0.',
}

/**
 * Note secundare (avertismente care nu sunt motivul principal). Coduri necunoscute se ignoră. Fără valoare, cardul
 * are un singur motiv (`reasonFor`): notele despre comparație, întârziere sau acoperire nu explică o cifră care nu
 * există, deci rămâne doar statutul definiției.
 */
export function notesFor(m: MetricItem): string[] {
  const out: string[] = []
  for (const w of m.warnings) {
    if (m.value === null && w.code !== 'definition_draft') continue
    // Condiția care a devenit status e deja în motivul principal.
    if (w.code === m.status) continue
    // Codurile cu rol de motiv principal nu se repetă ca note.
    if (['query_failed', 'duplicate_observations', 'interval_report_missing', 'no_observation', 'no_confirmed_data', 'zero_denominator', 'zero_not_confirmed', 'aggregation_label', 'unavailable', 'cannot_compute'].includes(w.code)) continue
    if (m.status === 'partial' && (w.code === 'excluded_rows' || w.code === 'comparison_matched')) continue
    const text = NOTE_TEXT[w.code]?.(w)
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/**
 * Motivul pentru o serie fără puncte. Doar `not_connected` are un text propriu: celelalte stări goale nu
 * au cauză cunoscută la nivel de serie, deci nu inventăm una.
 */
export function trendReason(status: MetricStatus): string | null {
  return status === 'not_connected' ? 'Sursa nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.' : null
}
