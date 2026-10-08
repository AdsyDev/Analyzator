export interface KpiSlot {
  key: string
  /** Eticheta slotului din spec: folosită doar când metrica nu are definiție în registru. */
  label: string
}

export const MISSING_DEFINITION = 'Definiția acestui indicator nu este încă în registrul de metrici.'
