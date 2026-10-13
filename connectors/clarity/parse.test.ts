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
    assert.equal(rows[0]!.dead_click_count, null, 'fără procent, sessionsCount nu se poate verifica și nu se ghicește')
    const codes = notes.map((n) => `${n.code}:${n.field ?? n.metric_name}`).sort()
    assert.deepEqual(codes, [
      'behavior_unverified:sessionsCount',
      'ignored_breakdown_block:Popular Pages',
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

describe('numele reale din API (12 oct 2026)', () => {
  test('blocuri fără spații, câmpuri cu altă capitalizare și „Url”: recunoscute; câmpurile de comportament apar în note', () => {
    const payload = [
      { metricName: 'Traffic', information: [{ totalSessionCount: '120', totalBotSessionCount: '3', distinctUserCount: '98', pagesPerSessionPercentage: 1.4, Url: 'https://x.ro/a' }, { totalSessionCount: '5', Url: 'https://x.ro/b' }] },
      { metricName: 'RageClickCount', information: [{ sessionsCount: '120', sessionsWithMetricPercentage: 2.5, Url: 'https://x.ro/a' }] },
      { metricName: 'PopularPages', information: [{ url: 'https://x.ro/a', visitsCount: '9' }] },
    ]
    const { rows, notes } = parseClarityPayload(payload, ctx('page'))
    const a = rows.find((r) => r.dimension_value === 'https://x.ro/a')!
    assert.equal(a.sessions, 120)
    assert.equal(a.distinct_users, 98)
    assert.equal(a.pages_per_session, 1.4)
    assert.ok(rows.some((r) => r.dimension_value === 'https://x.ro/b'), 'a doua pagină nu cade pe „(unknown)”')
    assert.ok(!notes.some((n) => n.code === 'unknown_block'), JSON.stringify(notes.filter((n) => n.code === 'unknown_block')))
    assert.ok(!notes.some((n) => n.code === 'missing_dimension_value'))
    // Câmpurile blocului de comportament se notează cu numele lor (fără valori), ca maparea să se facă pe date reale.
    assert.ok(notes.some((n) => n.metric_name === 'RageClickCount' && n.field === 'sessionsWithMetricPercentage'))
  })

  test('ScrollDepth.averageScrollDepth → scroll_depth; valorile câmpurilor nedocumentate apar doar pe agregat', () => {
    const payload = [
      { metricName: 'Traffic', information: [{ totalSessionCount: '200' }] },
      { metricName: 'ScrollDepth', information: [{ averageScrollDepth: 47.3 }] },
      { metricName: 'RageClickCount', information: [{ sessionsCount: '12', sessionsWithMetricPercentage: 6 }] },
    ]
    const all = parseClarityPayload(payload, ctx('all'))
    assert.equal(all.rows[0]!.scroll_depth, 47.3)
    // 12 / 200 = 6% = procentul raportat: sessionsCount sunt sesiunile cu rage clicks (D-24).
    assert.equal(all.rows[0]!.rage_click_count, 12)
    assert.ok(all.notes.some((n) => n.field === 'sessionsWithMetricPercentage' && /= 6/.test(n.message)))
    const dev = parseClarityPayload(payload.map((b) => ({ ...b, information: b.information.map((i) => ({ ...i, Device: 'PC' })) })), ctx('device'))
    assert.ok(dev.notes.every((n) => !/ = /.test(n.message)), 'pe defalcări nu se notează valori')
  })
})

describe('blocurile de comportament: sessionsCount doar cu dovada din payload (D-24)', () => {
  const traffic = { metricName: 'Traffic', information: [{ totalSessionCount: '400' }] }
  const parse = (info: Record<string, unknown>, metricName = 'DeadClickCount') => parseClarityPayload([traffic, { metricName, information: [info] }], ctx('all'))

  test('sessionsCount / totalSessionCount ≈ procent: valoarea Clarity intră în coloană, nemodificată', () => {
    const r = parse({ sessionsCount: '31', sessionsWithMetricPercentage: 7.75, subTotal: '58' })
    assert.equal(r.rows[0]!.dead_click_count, 31)
    for (const [block, col] of [['RageClickCount', 'rage_click_count'], ['QuickbackClick', 'quickback_click'], ['ExcessiveScroll', 'excessive_scroll'], ['ScriptErrorCount', 'script_error_count'], ['ErrorClickCount', 'error_click_count']] as const) {
      assert.equal(parse({ sessionsCount: '8', sessionsWithMetricPercentage: 2 }, block).rows[0]![col], 8, block)
    }
  })

  test('zero real: 0 sesiuni și 0% dau 0, nu NULL', () => {
    assert.equal(parse({ sessionsCount: '0', sessionsWithMetricPercentage: 0 }).rows[0]!.dead_click_count, 0)
  })

  test('sessionsCount egal cu totalul sesiunilor: NULL, cu motivul și valorile în notă', () => {
    const r = parse({ sessionsCount: '400', sessionsWithMetricPercentage: 7.75 })
    assert.equal(r.rows[0]!.dead_click_count, null)
    const n = r.notes.find((x) => x.code === 'behavior_count_is_total')
    assert.ok(n && /sessionsCount = 400, totalSessionCount = 400, procent = 7.75/.test(n.message), JSON.stringify(r.notes))
  })

  test('nepotrivire sau Traffic lipsă: NULL, nu o estimare din procent', () => {
    assert.equal(parse({ sessionsCount: '90', sessionsWithMetricPercentage: 7.75 }).rows[0]!.dead_click_count, null)
    assert.ok(parse({ sessionsCount: '90', sessionsWithMetricPercentage: 7.75 }).notes.some((n) => n.code === 'behavior_inconsistent'))
    const noTraffic = parseClarityPayload([{ metricName: 'DeadClickCount', information: [{ sessionsCount: '31', sessionsWithMetricPercentage: 7.75 }] }], ctx('all'))
    assert.equal(noTraffic.rows[0]!.dead_click_count, null)
    assert.ok(noTraffic.notes.some((n) => n.code === 'behavior_unverified'))
  })

  test('pe defalcări, verificarea se face pe rândul aceleiași valori', () => {
    const r = parseClarityPayload([
      { metricName: 'Traffic', information: [{ totalSessionCount: '100', Device: 'PC' }, { totalSessionCount: '50', Device: 'Mobile' }] },
      { metricName: 'RageClickCount', information: [{ sessionsCount: '5', sessionsWithMetricPercentage: 5, Device: 'PC' }, { sessionsCount: '5', sessionsWithMetricPercentage: 10, Device: 'Mobile' }] },
    ], ctx('device'))
    assert.deepEqual(r.rows.map((x) => [x.dimension_value, x.rage_click_count]), [['PC', 5], ['Mobile', 5]])
  })
})
