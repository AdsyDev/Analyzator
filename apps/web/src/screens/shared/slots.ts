import type { SourceProviderId } from '../../contracts'
import { sourceName } from '../../lib/sources'

export interface KpiSlot {
  key: string
  /** Eticheta slotului din spec: folosită doar când metrica nu are definiție în registru. */
  label: string
  /**
   * Sursele din care va veni indicatorul, doar pentru cheile din afara registrului (serverul nu le știe sursa).
   * E o etichetă pentru motivul afișat, nu o formulă: valoarea rămâne `not_connected` până intră în registru.
   */
  sources?: readonly SourceProviderId[]
}

export const MISSING_DEFINITION = 'Definiția acestui indicator nu este încă în registrul de metrici.'

const listRo = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} și ${names[names.length - 1]}`)

/**
 * Motivul unui card fără definiție în registru: numește sursele așteptate și spune de ce nu e valoare. Nu afirmă
 * că sursa e deconectată (poate fi conectată): lipsește definiția, deci indicatorul nu se calculează încă.
 */
export function unregisteredReason(slot: KpiSlot): string {
  const names = (slot.sources ?? []).map(sourceName)
  const from = names.length === 0 ? 'Indicatorul' : `Indicatorul vine din ${listRo(names)}, dar`
  return `${from} nu are încă definiție în registrul de metrici, deci nu se calculează. Nu afișăm valori estimate.`
}
