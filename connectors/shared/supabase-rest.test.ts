import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { SupabaseRest } from './supabase-rest.ts'

type Step = Error | { status: number; body?: string }
function db(steps: Step[]) {
  const calls: Array<{ url: string; method: string }> = []
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    const s = steps.shift() ?? { status: 200, body: '[]' }
    if (s instanceof Error) throw s
    return new Response(s.body ?? '[]', { status: s.status })
  }
  return { rest: new SupabaseRest({ url: 'http://sb.test', serviceRoleKey: 'k', fetch, retryDelaysMs: [0, 0] }), calls }
}

describe('SupabaseRest: reîncercare doar pentru cereri repetabile', () => {
  test('upsert: o eroare de rețea și un 503 se reîncearcă, apoi reușește', async () => {
    const { rest, calls } = db([new TypeError('fetch failed'), { status: 503 }, { status: 200, body: '[{"id":1}]' }])
    assert.deepEqual(await rest.upsert('t', [{ id: 1 }], ['id']), [{ id: 1 }])
    assert.equal(calls.length, 3)
  })

  test('select: reîncercat; după ultima încercare eroarea ajunge la apelant', async () => {
    const { rest, calls } = db([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')])
    await assert.rejects(rest.select('t', 'select=id'), /fetch failed/)
    assert.equal(calls.length, 3)
  })

  test('insert simplu: fără reîncercare (un rând scris al cărui răspuns s-a pierdut nu se dublează)', async () => {
    const { rest, calls } = db([new TypeError('fetch failed')])
    await assert.rejects(rest.insert('sync_runs', { a: 1 }), /fetch failed/)
    assert.equal(calls.length, 1)
  })

  test('o eroare definitivă (400) nu se reîncearcă', async () => {
    const { rest, calls } = db([{ status: 400, body: '{"code":"22P02","message":"invalid"}' }])
    await assert.rejects(rest.upsert('t', [{ id: 1 }], ['id']), /HTTP 400/)
    assert.equal(calls.length, 1)
  })

  test('on_conflict: coloane cu cifre (landing_page_md5) acceptate; orice altceva refuzat fără cerere', async () => {
    const { rest, calls } = db([{ status: 200, body: '[{"id":1}]' }])
    await rest.upsert('web_daily', [{ id: 1 }], ['tenant_id', 'landing_page_md5'])
    assert.ok(calls[0]!.url.endsWith('on_conflict=tenant_id,landing_page_md5'))
    await assert.rejects(rest.upsert('t', [{ id: 1 }], ['id,x']), /on_conflict invalidă/)
    await assert.rejects(rest.upsert('t', [{ id: 1 }], ['5id']), /on_conflict invalidă/)
    assert.equal(calls.length, 1)
  })
})
