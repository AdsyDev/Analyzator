import type { MetricResponse, MetricWarning } from '../contracts'
import { formatDate } from './format'
import { sourceName } from './sources'

const has = (m: MetricResponse, code: string) => m.warnings.some((w) => w.code === code)
const pct = (c: number | null) => (c === null ? null : Math.round(c * 100))

/**
 * Motivul principal al stării unei metrici, în română. Serverul trimite doar coduri (`warnings`);
 * textul se produce aici, din status, acoperire și coduri. Nu inventează cauze: fără cod cunoscut,
 * spune doar ce se știe.
 */
export function reasonFor(m: MetricResponse): string | null {
  switch (m.status) {
    case 'ok':
      return null
    case 'not_connected':
      return `${m.source ? `Sursa ${sourceName(m.source)}` : 'Sursa'} nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.`
    case 'unavailable':
      if (has(m, 'query_failed')) return 'Sursa nu a răspuns la interogare. Nu o tratăm ca zero; reîncearcă mai târziu.'
      if (has(m, 'duplicate_observations')) return 'Există observații duplicate pentru aceeași zi, deci valoarea nu se calculează.'
      if (has(m, 'interval_report_missing')) return 'Lipsește raportul pe intervalul întreg; zilele nu se însumează.'
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
      return has(m, 'excluded_rows') ? `${base} Unele rânduri au fost excluse din calcul.` : base
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
  excluded_rows: () => 'Unele rânduri au fost excluse din calcul.',
  definition_draft: (w) => `Definiție provizorie${typeof w.detail === 'string' && w.detail ? `: ${w.detail}` : '.'}`,
  // Condiții secundare: statusul principal e altul, dar condiția rămâne vizibilă.
  stale: () => 'Datele sunt întârziate.',
  partial: () => 'Date parțiale.',
  insufficient_sample: () => 'Eșantion mic.',
  base_zero: () => 'Baza de comparație e 0.',
}

/** Note secundare (avertismente care nu sunt motivul principal). Coduri necunoscute se ignoră. */
export function notesFor(m: MetricResponse): string[] {
  const out: string[] = []
  for (const w of m.warnings) {
    // Condiția care a devenit status e deja în motivul principal.
    if (w.code === m.status) continue
    // Codurile cu rol de motiv principal nu se repetă ca note.
    if (['query_failed', 'duplicate_observations', 'interval_report_missing', 'no_observation', 'no_confirmed_data', 'zero_denominator', 'zero_not_confirmed', 'aggregation_label', 'unavailable', 'cannot_compute'].includes(w.code)) continue
    if (m.status === 'partial' && w.code === 'excluded_rows') continue
    const text = NOTE_TEXT[w.code]?.(w)
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}
