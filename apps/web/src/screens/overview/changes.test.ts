import { describe, expect, it } from 'vitest'
import type { MetricDefinition, MetricDirection, MetricItem } from '../../contracts'
import { metric } from '../../test/factories'
import { changeSignals } from './changes'

const def = (metric_key: string, direction: MetricDirection): MetricDefinition => ({ metric_key, version: 1, label: metric_key, formula: '', unit: 'count', source: 'ga4', aggregation_label: null, direction, lifecycle: 'active', lifecycle_note: null, doc_ref: '' })
const defs = (...d: MetricDefinition[]) => new Map(d.map((x) => [x.metric_key, x]))
const m = (metric_key: string, relative_change: number | null, over: Partial<MetricItem> = {}): MetricItem => metric({ metric_key, relative_change, ...over })

describe('„Ce s-a schimbat”: semnalele automate', () => {
  it('oportunitatea e cea mai mare variație favorabilă, riscul cea mai mare variație nefavorabilă', () => {
    const r = changeSignals([m('a', 6), m('b', 12.9), m('c', -5), m('d', -17.8)], defs(def('a', 'higher_is_better'), def('b', 'higher_is_better'), def('c', 'higher_is_better'), def('d', 'higher_is_better')))
    expect(r.opportunity?.item.metric_key).toBe('b')
    expect(r.risk?.item.metric_key).toBe('d')
  })

  it('direcția vine din registru: o scădere la „mai mic e mai bine” e favorabilă', () => {
    const r = changeSignals([m('pos', -8), m('cost', 20)], defs(def('pos', 'lower_is_better'), def('cost', 'lower_is_better')))
    expect(r.opportunity?.item.metric_key).toBe('pos')
    expect(r.risk?.item.metric_key).toBe('cost')
  })

  it('nu inventează semnale: fără valoare, fără variație relativă, învechit, fără direcție, fără definiție sau sub pragul de 5 % nu intră', () => {
    const items = [m('none', 30, { value: null, status: 'unavailable' }), m('base', null, { status: 'base_zero' }), m('old', 40, { status: 'stale' }), m('neutral', 50), m('nodef', 60), m('small', -4.9)]
    const r = changeSignals(items, defs(def('none', 'higher_is_better'), def('base', 'higher_is_better'), def('old', 'higher_is_better'), def('neutral', 'neutral'), def('small', 'higher_is_better')))
    expect(r).toEqual({ opportunity: null, risk: null })
  })
})
