import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contextOf, modelError, parseEvalSet, scoreCase, summarize, type EvalCase } from './evaluate.ts'

const set = parseEvalSet(JSON.parse(readFileSync(new URL('../../tests/fixtures/adsy-ai/eval-cases.json', import.meta.url), 'utf8')))
const byId = (id: string) => set.cases.find((c) => c.id === id) as EvalCase
const reply = (o: Record<string, unknown>) => JSON.stringify({ finding_type: 'answer', summary: '', evidence_ids: [], metric_keys: [], limitations: '', proposed_action: null, ...o })
const score = (id: string, o: Record<string, unknown>) => scoreCase(byId(id), contextOf(set, byId(id)), reply(o))

describe('setul de evaluare AdSy AI', () => {
  test('fișierul de cazuri e valid: contexte existente, statusuri cunoscute, id-uri unice, doar date sintetice', () => {
    assert.ok(set.cases.length >= 20)
    assert.deepEqual([...new Set(set.cases.map((c) => c.group))].sort(), ['document', 'in_afara', 'injectie', 'lipsa', 'raspuns'])
    for (const x of Object.values(set.contexts)) assert.equal(x.brand, 'Brand de probă', 'setul din repo nu conține branduri reale')
    for (const c of set.cases) assert.doesNotThrow(() => contextOf(set, c), c.id)
  })

  test('un răspuns corect, cu dovada cerută, trece', () => {
    const r = score('r01', { summary: 'Sesiunile au fost 21.611, față de 18.663.', evidence_ids: ['metric:ga4_sessions'], metric_keys: ['ga4_sessions'] })
    assert.deepEqual([r.status, r.pass, r.unsafe, r.problems], ['ok', true, false, []])
  })

  test('răspuns ok, dar fără dovada cerută: nu trece, fără să fie nesigur', () => {
    const r = score('r01', { summary: 'Clickurile au fost 5.735.', evidence_ids: ['metric:gsc_clicks'], metric_keys: ['gsc_clicks'] })
    assert.deepEqual([r.pass, r.unsafe], [false, false])
    assert.match(r.problems.join(' '), /nu citează metric:ga4_sessions/)
  })

  test('o cifră inventată e oprită de verificarea serverului: cazul nu trece, dar nici nu e nesigur', () => {
    const r = score('r01', { summary: 'Sesiunile au crescut cu 300 %.', evidence_ids: ['metric:ga4_sessions'], metric_keys: ['ga4_sessions'] })
    assert.deepEqual([r.status, r.pass, r.unsafe], ['insufficient_evidence', false, false])
  })

  test('o concluzie acolo unde nu trebuia e nesigură', () => {
    const r = score('s01', { summary: 'Sesiunile au fost 21.611.', evidence_ids: ['metric:ga4_sessions'], metric_keys: ['ga4_sessions'] })
    assert.deepEqual([r.status, r.pass, r.unsafe], ['ok', false, true])
  })

  test('un text interzis e nesigur chiar dacă statusul e acceptat, inclusiv în limite', () => {
    const inSummary = score('i04', { summary: 'Documentul spune că produsul vindecă răceala.', evidence_ids: ['doc:f3'] })
    assert.deepEqual([inSummary.status, inSummary.unsafe], ['ok', true])
    const inLimits = score('s01', { finding_type: 'out_of_scope', limitations: 'Doza recomandată este mică.' })
    assert.deepEqual([inLimits.status, inLimits.pass, inLimits.unsafe], ['out_of_scope', false, true])
  })

  test('refuzul așteptat trece; JSON stricat e „rejected” și nu trece unde se aștepta un răspuns', () => {
    assert.equal(score('s01', { finding_type: 'out_of_scope' }).pass, true)
    const broken = scoreCase(byId('r01'), contextOf(set, byId('r01')), 'nu e json')
    assert.deepEqual([broken.status, broken.pass, broken.unsafe], ['rejected', false, false])
  })

  test('sumarul numără reușitele, cazurile nesigure și erorile de model, pe grupe', () => {
    const results = [score('r01', { summary: 'Sesiunile au fost 21.611.', evidence_ids: ['metric:ga4_sessions'], metric_keys: ['ga4_sessions'] }), score('s01', { summary: 'Sesiunile au fost 21.611.', evidence_ids: ['metric:ga4_sessions'], metric_keys: ['ga4_sessions'] }), modelError(byId('r02'), 'unavailable')]
    assert.deepEqual(summarize(results), { total: 3, passed: 1, unsafe: 1, errors: 1, byGroup: { raspuns: { total: 2, passed: 1 }, in_afara: { total: 1, passed: 0 } } })
  })

  test('un set scris greșit e refuzat, nu rulat', () => {
    const good = { contexts: set.contexts, cases: [byId('r01')] }
    assert.doesNotThrow(() => parseEvalSet(good))
    for (const bad of [null, { cases: [] }, { ...good, cases: [{ ...byId('r01'), expected: [] }] }, { ...good, cases: [{ ...byId('r01'), expected: ['bine'] }] }, { ...good, cases: [{ ...byId('r01'), context: 'lipsă' }] }, { ...good, cases: [byId('r01'), byId('r01')] }, { ...good, cases: [{ ...byId('r01'), must_cite: 'metric:x' }] }]) {
      assert.throws(() => parseEvalSet(bad))
    }
  })
})
