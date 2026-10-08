import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CallBudget, fetchWithRetry, parseRetryAfter } from './http-budget.ts'
import { fakeFetch, noSleep } from './test-helpers.ts'

const URL_ = 'https://example.test/api'

function run(responses: Parameters<typeof fakeFetch>[0], budgetLimit = 10, extra: { maxDelayMs?: number } = {}) {
  const f = fakeFetch(responses)
  const s = noSleep()
  const budget = new CallBudget(budgetLimit)
  const promise = fetchWithRetry(URL_, {}, { budget, fetch: f.fetch, sleep: s.sleep, now: () => 0, ...extra })
  return { promise, f, s, budget }
}

describe('CallBudget', () => {
  test('consumă până la limită, apoi refuză', () => {
    const b = new CallBudget(2)
    assert.equal(b.tryConsume(), true)
    assert.equal(b.tryConsume(), true)
    assert.equal(b.tryConsume(), false)
    assert.equal(b.used, 2)
    assert.equal(b.remaining, 0)
  })
  test('limită invalidă respinsă', () => {
    assert.throws(() => new CallBudget(-1))
    assert.throws(() => new CallBudget(1.5))
  })
})

describe('parseRetryAfter', () => {
  test('secunde', () => assert.equal(parseRetryAfter('7', 0), 7000))
  test('dată HTTP', () => {
    const now = Date.parse('2026-10-07T10:00:00Z')
    assert.equal(parseRetryAfter('Wed, 07 Oct 2026 10:00:30 GMT', now), 30_000)
  })
  test('dată în trecut → 0', () => {
    assert.equal(parseRetryAfter('Wed, 07 Oct 2026 09:00:00 GMT', Date.parse('2026-10-07T10:00:00Z')), 0)
  })
  test('lipsă sau invalid → null', () => {
    assert.equal(parseRetryAfter(null, 0), null)
    assert.equal(parseRetryAfter('mâine', 0), null)
  })
})

describe('fetchWithRetry', () => {
  test('200 la prima încercare: un apel, o unitate de buget', async () => {
    const { promise, f, budget } = run([{ status: 200, body: '[]' }])
    const r = await promise
    assert.deepEqual(r, { ok: true, status: 200, body: '[]', attempts: 1 })
    assert.equal(f.calls.length, 1)
    assert.equal(budget.used, 1)
  })

  for (const status of [401, 403]) {
    test(`${status}: fără retry, raportat ca acces refuzat`, async () => {
      const { promise, f, s } = run([{ status }, { status: 200 }])
      const r = await promise
      assert.equal(r.ok, false)
      assert.equal(!r.ok && r.kind, 'access_denied')
      assert.equal(f.calls.length, 1)
      assert.deepEqual(s.delays, [])
    })
  }

  test('400: fără retry (nume de dimensiune invalid nu se ghicește)', async () => {
    const { promise, f } = run([{ status: 400 }, { status: 200 }])
    const r = await promise
    assert.equal(!r.ok && r.kind, 'bad_request')
    assert.equal(f.calls.length, 1)
  })

  test('404: fără retry', async () => {
    const { promise, f } = run([{ status: 404 }])
    assert.equal(!(await promise).ok, true)
    assert.equal(f.calls.length, 1)
  })

  test('429 cu Retry-After în secunde, apoi 200', async () => {
    const { promise, f, s, budget } = run([{ status: 429, headers: { 'Retry-After': '2' } }, { status: 200, body: 'x' }])
    const r = await promise
    assert.equal(r.ok, true)
    assert.equal(r.attempts, 2)
    assert.deepEqual(s.delays, [2000])
    assert.equal(f.calls.length, 2)
    assert.equal(budget.used, 2, 'retry-ul se contorizează în buget')
  })

  test('5xx de 3 ori: backoff exponențial 1 s, 2 s, apoi eșec', async () => {
    const { promise, f, s } = run([{ status: 503 }, { status: 502 }, { status: 500 }, { status: 200 }])
    const r = await promise
    assert.equal(!r.ok && r.kind, 'server_error')
    assert.equal(r.attempts, 3)
    assert.equal(f.calls.length, 3)
    assert.deepEqual(s.delays, [1000, 2000])
  })

  test('429 de 3 ori: rate_limited', async () => {
    const { promise } = run([{ status: 429 }, { status: 429 }, { status: 429 }])
    const r = await promise
    assert.equal(!r.ok && r.kind, 'rate_limited')
  })

  test('Retry-After peste limită: nu așteaptă, nu reîncearcă', async () => {
    const { promise, f, s } = run([{ status: 429, headers: { 'Retry-After': '86400' } }, { status: 200 }], 10, {
      maxDelayMs: 60_000,
    })
    const r = await promise
    assert.equal(!r.ok && r.kind, 'rate_limited')
    assert.equal(f.calls.length, 1)
    assert.deepEqual(s.delays, [])
  })

  test('eroare de rețea: reîncercată', async () => {
    const { promise, f } = run([new Error('ECONNRESET'), { status: 200, body: 'ok' }])
    const r = await promise
    assert.equal(r.ok, true)
    assert.equal(f.calls.length, 2)
  })

  test('bugetul oprește retry-ul: budget 2, trei 503 → doar 2 apeluri', async () => {
    const { promise, f, budget } = run([{ status: 503 }, { status: 503 }, { status: 503 }], 2)
    const r = await promise
    assert.equal(!r.ok && r.kind, 'budget_exhausted')
    assert.equal(r.attempts, 2)
    assert.equal(!r.ok && r.status, 503)
    assert.equal(f.calls.length, 2)
    assert.equal(budget.used, 2)
  })

  test('buget 0: niciun apel', async () => {
    const { promise, f } = run([{ status: 200 }], 0)
    const r = await promise
    assert.equal(!r.ok && r.kind, 'budget_exhausted')
    assert.equal(f.calls.length, 0)
  })
})

describe('fetchWithRetry cu program explicit (SEOmonitor: 1, 5, 15 minute)', () => {
  const delaysMs = [60_000, 300_000, 900_000]

  test('patru încercări, așteptări 1/5/15 minute cu jitter, apoi eșec', async () => {
    const f = fakeFetch([{ status: 503 }, { status: 503 }, { status: 502 }, { status: 500 }, { status: 200 }])
    const s = noSleep()
    const r = await fetchWithRetry(URL_, {}, {
      budget: new CallBudget(10), fetch: f.fetch, sleep: s.sleep, now: () => 0,
      delaysMs, maxDelayMs: 20 * 60_000, jitter: (ms) => ms * 1.1,
    })
    assert.equal(!r.ok && r.kind, 'server_error')
    assert.equal(f.calls.length, 4)
    assert.deepEqual(s.delays, [66_000, 330_000, 990_000])
  })

  test('Retry-After are prioritate față de program și nu primește jitter', async () => {
    const f = fakeFetch([{ status: 429, headers: { 'Retry-After': '30' } }, { status: 200, body: '[]' }])
    const s = noSleep()
    await fetchWithRetry(URL_, {}, {
      budget: new CallBudget(10), fetch: f.fetch, sleep: s.sleep, now: () => 0,
      delaysMs, maxDelayMs: 20 * 60_000, jitter: (ms) => ms * 2,
    })
    assert.deepEqual(s.delays, [30_000])
  })

  for (const status of [401, 403]) {
    test(`${status}: fără retry nici cu program explicit`, async () => {
      const f = fakeFetch([{ status }, { status: 200 }])
      const s = noSleep()
      const r = await fetchWithRetry(URL_, {}, { budget: new CallBudget(10), fetch: f.fetch, sleep: s.sleep, delaysMs })
      assert.equal(!r.ok && r.kind, 'access_denied')
      assert.equal(f.calls.length, 1)
      assert.deepEqual(s.delays, [])
    })
  }
})
