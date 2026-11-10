import type { MetricDefinition, MetricItem } from '../../contracts'
import { changeDirection } from '../../lib/format'
import { isGoodChange } from '../../lib/metricView'

export interface ChangeSignal {
  item: MetricItem
  definition: MetricDefinition
}

/**
 * „Ce s-a schimbat": cea mai mare variație favorabilă și cea mai mare variație nefavorabilă dintre indicatorii
 * principali. Nu calculează nimic: alege dintre variațiile venite de la server, după direcția din registru.
 * Sunt semnale automate, nu concluzii; interpretarea rămâne a echipei (spec 2.8).
 *
 * Nu intră în alegere: indicatorii fără valoare sau fără variație relativă (bază zero, comparație lipsă), cei
 * fără direcție „bună" în registru, cei învechiți (o valoare veche nu e o schimbare a perioadei) și variațiile
 * sub `MIN_SIGNAL_PERCENT`.
 */
/**
 * Sub acest prag (variație relativă, în procente) o schimbare nu e prezentată ca oportunitate sau risc: o mișcare
 * de câteva zecimi e zgomot, nu semnal. E o regulă de prezentare provizorie (decizia G-3); pragurile pe brand
 * rămân de configurat de agenție.
 */
export const MIN_SIGNAL_PERCENT = 5

export function changeSignals(items: readonly MetricItem[], definitions: ReadonlyMap<string, MetricDefinition>): { opportunity: ChangeSignal | null; risk: ChangeSignal | null } {
  let opportunity: ChangeSignal | null = null
  let risk: ChangeSignal | null = null
  for (const item of items) {
    const definition = definitions.get(item.metric_key)
    if (!definition || item.value === null || item.relative_change === null || item.status === 'stale') continue
    const good = isGoodChange(definition.direction, changeDirection(item.relative_change))
    if (good === null) continue
    const size = Math.abs(item.relative_change)
    if (size < MIN_SIGNAL_PERCENT) continue
    if (good && (!opportunity || size > Math.abs(opportunity.item.relative_change ?? 0))) opportunity = { item, definition }
    if (!good && (!risk || size > Math.abs(risk.item.relative_change ?? 0))) risk = { item, definition }
  }
  return { opportunity, risk }
}
