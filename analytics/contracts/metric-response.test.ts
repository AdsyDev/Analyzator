// Invariantele versiunii 2 a contractului MetricResponse: currency obligatoriu când unit = currency (și value nu e null).
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { METRIC_CONTRACT_VERSION, METRIC_UNITS_V2, metricInvariantViolations } from './metric-response.ts'

describe('MetricResponse v2: moneda', () => {
  test('versiunea e 2 și lista de unități include currency', () => {
    assert.equal(METRIC_CONTRACT_VERSION, 2)
    assert.ok(METRIC_UNITS_V2.includes('currency'))
    assert.equal(METRIC_UNITS_V2.length, 6)
  })

  test('currency obligatoriu când unit = currency și value nu e null', () => {
    assert.deepEqual(metricInvariantViolations({ unit: 'currency', value: 152.4, currency: 'RON' }), [])
    assert.match(metricInvariantViolations({ unit: 'currency', value: 152.4, currency: null })[0]!, /obligatoriu/)
    assert.match(metricInvariantViolations({ unit: 'currency', value: 0, currency: null })[0]!, /obligatoriu/, '0 real fără monedă tot e invalid')
  })

  test('cu value null (indisponibil), currency poate lipsi sau poate fi cunoscut', () => {
    assert.deepEqual(metricInvariantViolations({ unit: 'currency', value: null, currency: null }), [])
    assert.deepEqual(metricInvariantViolations({ unit: 'currency', value: null, currency: 'EUR' }), [])
  })

  test('currency trebuie să fie cod ISO 4217 (trei litere mari)', () => {
    for (const bad of ['ron', 'RO', 'RONN', 'R0N', '']) {
      assert.match(metricInvariantViolations({ unit: 'currency', value: 1, currency: bad })[0] ?? '', /ISO 4217/, bad)
    }
  })

  test('unitățile nemonetare au currency null', () => {
    for (const unit of ['count', 'percent', 'seconds', 'position', 'score'] as const) {
      assert.deepEqual(metricInvariantViolations({ unit, value: 5, currency: null }), [], unit)
      assert.match(metricInvariantViolations({ unit, value: 5, currency: 'RON' })[0]!, /trebuie să fie null/, unit)
    }
  })

  test('unitate necunoscută respinsă', () => {
    assert.match(metricInvariantViolations({ unit: 'dolari' as never, value: 1, currency: null })[0]!, /necunoscută/)
  })
})
