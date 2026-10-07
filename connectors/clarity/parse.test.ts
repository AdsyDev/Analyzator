// Parserul Clarity pe fixtures derivate din documentație (neconfirmate) și pe cazuri sintetice de toleranță.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { CLARITY_CALLS, type ClarityDimensionKey, type ParseContext } from './collect-core.ts'
import { METRIC_COLUMNS, parseClarityPayload } from './parse.ts'
import { docsFixture } from './docs-fixtures.ts'

function ctx(key: ClarityDimensionKey): ParseContext {
  return {
    tenant_id: '10000000-0000-0000-0000-000000000001',
    brand_id: '20000000-0000-0000-0000-000000000011',
    date: '2026-10-07',
    call: CLARITY_CALLS.find((c) => c.key === key)!,
    source_id: '50000000-0000-0000-0000-000000000031',
    sync_run_id: '60000000-0000-0000-0000-000000000001',
    collected_at: '2026-10-07T22:05:00.000Z',
    payload_hash: 'a'.repeat(64),
    window_days: 1,
  }
}

const UNCONFIRMED = METRIC_COLUMNS.filter((c) => !['sessions', 'bot_sessions', 'distinct_users', 'pages_per_session'].includes(c))

describe('fixtures docs-derived', () => {
  for (const key of ['all', 'device', 'source', 'page'] as const) {
    test(`${key}: fixture marcat „derivat din documentație, neconfirmat"`, () => {
      assert.equal(docsFixture(key).header, 'derivat din documentație, neconfirmat')
    })
  }

  test('totaluri: un rând „all", câmpurile Traffic convertite din string, restul NULL', () => {
    const { rows, notes } = parseClarityPayload(docsFixture('all').payload, ctx('all'))
    assert.equal(rows.length, 1)
    const row = rows[0]!
    assert.equal(row.dimension, 'all')
    assert.equal(row.dimension_value, 'all')
    assert.equal(row.sessions, 1200)
    assert.equal(row.bot_sessions, 150)
    assert.equal(row.distinct_users, 980)
    assert.equal(row.pages_per_session, 2.1)
    for (const col of UNCONFIRMED) assert.equal(row[col], null, `${col} trebuie să rămână NULL, nu 0`)
    assert.deepEqual(notes, [])
  })

  test('Device, Source, URL: câte un rând per valoare a dimensiunii', () => {
    const expected: Record<string, string[]> = {
      device: ['Mobile', 'PC'],
      source: ['google', '(direct)'],
      page: ['https://brand.test/', 'https://brand.test/produse'],
    }
    for (const key of ['device', 'source', 'page'] as const) {
      const { rows } = parseClarityPayload(docsFixture(key).payload, ctx(key))
      assert.deepEqual(rows.map((r) => r.dimension_value), expected[key], key)
      assert.ok(rows.every((r) => r.dimension === key))
      assert.ok(rows.every((r) => typeof r.sessions === 'number'))
    }
  })

  test('proveniența e copiată pe fiecare rând', () => {
    const { rows } = parseClarityPayload(docsFixture('device').payload, ctx('device'))
    for (const r of rows) {
      assert.equal(r.source_id, '50000000-0000-0000-0000-000000000031')
      assert.equal(r.collected_at, '2026-10-07T22:05:00.000Z')
      assert.equal(r.collection_method, 'api')
      assert.equal(r.payload_hash, 'a'.repeat(64))
      assert.equal(r.window_days, 1)
      assert.equal(r.schema_version, 'docs-2025-12-05')
      assert.equal(r.date, '2026-10-07')
    }
  })
})

describe('toleranță și jurnalizare (date sintetice)', () => {
  test('câmpuri și blocuri necunoscute: parsarea continuă, totul e logat', () => {
    const payload = [
      { metricName: 'Traffic', information: [{ totalSessionCount: '10', newFieldFromClarity: 5 }], extraKey: true },
      { metricName: 'Dead Click Count', information: [{ sessionsCount: '3', subTotal: '7' }] },
      { metricName: 'Brand New Metric', information: [{ x: 1 }] },
      { metricName: 'Popular Pages', information: [{ url: 'https://brand.test/', visitsCount: '4' }] },
    ]
    const { rows, notes } = parseClarityPayload(payload, ctx('all'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.sessions, 10)
    assert.equal(rows[0]!.dead_click_count, null, 'câmpurile nedocumentate nu se ghicesc')
    const codes = notes.map((n) => `${n.code}:${n.field ?? n.metric_name}`).sort()
    assert.deepEqual(codes, [
      'ignored_breakdown_block:Popular Pages',
      'unconfirmed_field:sessionsCount',
      'unconfirmed_field:subTotal',
      'unknown_block:Brand New Metric',
      'unknown_block_key:extraKey',
      'unknown_field:newFieldFromClarity',
    ])
  })

  test('notele nu se repetă pentru fiecare rând', () => {
    const payload = [{ metricName: 'Traffic', information: Array.from({ length: 50 }, (_, i) => ({ totalSessionCount: '1', zzz: i, Device: `d${i}` })) }]
    const { notes } = parseClarityPayload(payload, ctx('device'))
    assert.equal(notes.filter((n) => n.field === 'zzz').length, 1)
  })

  test('payload gol: zero rânduri, fără eroare', () => {
    assert.deepEqual(parseClarityPayload([], ctx('page')), { rows: [], notes: [] })
    assert.deepEqual(parseClarityPayload([{ metricName: 'Traffic', information: [] }], ctx('page')).rows, [])
  })

  test('formă de bază invalidă: aruncă (nu se scrie nimic)', () => {
    assert.throws(() => parseClarityPayload({ metricName: 'Traffic' }, ctx('all')), /formă necunoscută/)
    assert.throws(() => parseClarityPayload([{ information: [] }], ctx('all')), /formă necunoscută/)
    assert.throws(() => parseClarityPayload([{ metricName: 'Traffic', information: 'x' }], ctx('all')), /formă necunoscută/)
  })

  test('valoare nenumerică: NULL și notă, restul rândului rămâne', () => {
    const { rows, notes } = parseClarityPayload(
      [{ metricName: 'Traffic', information: [{ totalSessionCount: 'n/a', totalBotSessionCount: '2' }] }], ctx('all'))
    assert.equal(rows[0]!.sessions, null)
    assert.equal(rows[0]!.bot_sessions, 2)
    assert.equal(notes[0]!.code, 'invalid_value')
  })

  test('zero real rămâne 0, nu NULL', () => {
    const { rows } = parseClarityPayload([{ metricName: 'Traffic', information: [{ totalSessionCount: '0' }] }], ctx('all'))
    assert.equal(rows[0]!.sessions, 0)
    assert.equal(rows[0]!.bot_sessions, null)
  })

  test('valoare de dimensiune lipsă → „(unknown)"; duplicat → primul rând, fără adunare', () => {
    const { rows, notes } = parseClarityPayload([{
      metricName: 'Traffic',
      information: [
        { totalSessionCount: '5' },
        { totalSessionCount: '7', Source: 'google' },
        { totalSessionCount: '9', Source: 'google' },
      ],
    }], ctx('source'))
    assert.deepEqual(rows.map((r) => [r.dimension_value, r.sessions]), [['(unknown)', 5], ['google', 7]])
    assert.ok(notes.some((n) => n.code === 'missing_dimension_value'))
    assert.ok(notes.some((n) => n.code === 'duplicate_dimension_value'))
  })
})
