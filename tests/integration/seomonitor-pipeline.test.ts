// Integrare pe Supabase LOCAL: fixtures SEOmonitor docs-derived → worker (client, normalizare, upsert real) →
// tabelele tipizate (constrângeri, chei, trigger de grup schimbat) → view-uri cu RLS → metrics.compute.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectSeomonitorConnection } from '../../connectors/seomonitor/collect-core.ts'
import { seoFixture, type FixtureName } from '../../connectors/seomonitor/docs-fixtures.ts'
import { SupabaseRest } from '../../connectors/shared/supabase-rest.ts'
import { loadActiveConnections } from '../../connectors/shared/connections.ts'
import { noSleep } from '../../connectors/shared/test-helpers.ts'
import type { FetchLike } from '../../connectors/shared/http-budget.ts'

const API_URL = process.env.API_URL ?? ''
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? ''
const ANON_KEY = process.env.ANON_KEY ?? ''
const JWT_SECRET = process.env.JWT_SECRET ?? ''
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL)) {
  throw new Error(`Testele de integrare rulează doar pe Supabase local (API_URL=${API_URL || 'lipsă'}).`)
}
const ROOT = join(import.meta.dirname, '..', '..')
const DB_CONTAINER = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8'))![1]}`

const T1 = '10000000-0000-0000-0000-000000000001'
const B1A = '20000000-0000-0000-0000-000000000011'
const CONN = '50000000-0000-0000-0000-000000000010' // SEOmonitor T1 din seed (brand_id null)
const ADMIN_T1 = '30000000-0000-0000-0000-000000000001'
const STRAT_T1 = '30000000-0000-0000-0000-000000000002' // acces 1A
const CLIENT_T1 = '30000000-0000-0000-0000-000000000004' // acces 1A
const STRAT_T2 = '30000000-0000-0000-0000-000000000012'
const now = () => new Date('2026-10-06T04:00:00Z')

const db = new SupabaseRest({ url: API_URL, serviceRoleKey: SERVICE_ROLE_KEY })

function userToken(sub: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const t = Math.floor(Date.now() / 1000)
  const u = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', iat: t, exp: t + 600 })}`
  return `${u}.${createHmac('sha256', JWT_SECRET).update(u).digest('base64url')}`
}
async function asUser<T>(sub: string, path: string, init: RequestInit = {}): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${userToken(sub)}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  })
  const text = await res.text()
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T }
}
function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim()
}

const PATHS: Record<string, FixtureName> = {
  '/v3/dashboard/v3.0/campaigns/tracked': 'campaigns-tracked',
  '/v3/rank-tracker/v3.0/groups': 'groups',
  '/v3/rank-tracker/v3.0/keywords': 'keywords',
  '/v3/rank-tracker/v3.0/keywords/daily-ranks': 'daily-ranks',
  '/v3/rank-tracker/v3.0/groups/daily-visibility': 'groups-daily-visibility',
  '/v3/rank-tracker/v3.0/keywords/ais': 'keywords-ais',
  '/v3/rank-tracker/v3.0/keywords/daily-ranks/ais': 'keywords-daily-ranks-ais',
  '/v3/rank-tracker/v3.0/keywords/competition/ais': 'keywords-competition-ais',
  '/v3/rank-tracker/v3.0/groups/daily-visibility/ais-mentions': 'groups-daily-visibility-ais-mentions',
  '/v3/rank-tracker/v3.0/groups/daily-visibility/ais-citations': 'groups-daily-visibility-ais-citations',
  '/v3/rank-tracker/v3.0/ais/stats': 'ais-stats',
  '/v3/rank-tracker/v3.0/keywords/aio': 'keywords-aio',
}
function api(keywordGroups1002 = '6001,7001'): FetchLike {
  return async (input) => {
    const url = new URL(input)
    let name = PATHS[url.pathname]
    if (!name) return new Response('{"error":{"message":"Data not found"}}', { status: 404 })
    if (Number(url.searchParams.get('offset') ?? 0) > 0) return new Response('[]', { status: 200 })
    if (name === 'keywords' && url.searchParams.get('group_id') === '-1') name = 'keywords-branded'
    if (name === 'daily-ranks' && url.searchParams.get('get_archive') === 'true') name = 'daily-ranks-archive'
    let payload = seoFixture(name).payload
    if (name === 'keywords') {
      payload = (payload as Array<Record<string, unknown>>).map((k) => (k.keyword_id === 1002 ? { ...k, groups: keywordGroups1002 } : k))
    }
    return new Response(JSON.stringify(payload), { status: 200 })
  }
}

async function runWorker(groups1002?: string) {
  const { connections } = await loadActiveConnections(db, 'seomonitor', { requireBrand: false })
  const connection = connections.find((c) => c.id === CONN)
  assert.ok(connection, 'conexiunea SEOmonitor T1 trebuie să fie activă, cu token')
  return collectSeomonitorConnection({ db, fetch: api(groups1002), sleep: noSleep().sleep, now, random: () => 0.5 }, connection)
}

const count = async (table: string) => (await db.select(table, `select=tenant_id&brand_id=eq.${B1A}`)).length

describe('pipeline SEOmonitor pe Supabase local', () => {
  before(async () => {
    assert.equal(await db.rpc('set_source_token', { p_actor_user_id: ADMIN_T1, p_connection_id: CONN, p_token: 'docs-derived-seomonitor-token' }), 'unverified')
    // Maparea creată de agency_admin prin API (RLS: insert permis doar adminului, cu created_by = el însuși).
    const base = { tenant_id: T1, source_id: CONN, campaign_id: '102933', version: 1, effective_from: '2026-09-01', created_by: ADMIN_T1 }
    const res = await asUser(ADMIN_T1, 'seomonitor_group_mappings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([
        { ...base, group_id: '6001', mapping_kind: 'brand', brand_id: B1A, brand_type: 'nonbranded', is_primary_visibility: true },
        { ...base, group_id: '5002', mapping_kind: 'brand', brand_id: B1A, brand_type: 'branded', is_primary_visibility: false },
        { ...base, group_id: '5001', mapping_kind: 'excluded', brand_id: null, brand_type: null, is_primary_visibility: false },
        { ...base, group_id: '7001', mapping_kind: 'multi_brand', brand_id: null, brand_type: null, is_primary_visibility: false },
      ]),
    })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    const strat = await asUser(STRAT_T1, 'seomonitor_group_mappings', {
      method: 'POST',
      body: JSON.stringify({ ...base, created_by: STRAT_T1, group_id: '8001', mapping_kind: 'brand', brand_id: B1A, brand_type: 'nonbranded' }),
    })
    assert.ok([401, 403].includes(strat.status), `strategistul nu poate mapa: ${strat.status}`)
  })

  test('rulare dublă pe baza reală: succeeded, nimic dublat, constrângerile acceptă rândurile', async () => {
    const first = await runWorker()
    assert.equal(first.runs[0]!.status, 'succeeded', JSON.stringify(first.runs[0]!.errors))
    const tables = ['keywords', 'keyword_groups', 'rank_observations', 'seomonitor_group_visibility_daily', 'ai_answers',
      'ai_citations', 'ai_brand_observations', 'seomonitor_ai_visibility_daily', 'seomonitor_ai_engine_stats']
    const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await count(t)])))
    for (const t of tables) assert.ok(before[t] > 0, `${t} gol`)
    const second = await runWorker()
    assert.equal(second.runs[0]!.status, 'succeeded')
    for (const t of tables) assert.equal(await count(t), before[t], `${t}: duplicat după a doua rulare`)
    const queue = await db.select<{ group_id: string; reason: string }>('seomonitor_mapping_queue', `select=group_id,reason&tenant_id=eq.${T1}`)
    assert.deepEqual(queue.map((q) => `${q.group_id}:${q.reason}`).sort(), ['7001:multi_brand', '8001:unmapped'])
    const runs = await db.select<{ status: string; coverage: unknown }>('sync_runs', `select=status,coverage&source_connection_id=eq.${CONN}`)
    assert.equal(runs.length, 2)
    assert.ok(runs.every((r) => r.coverage), 'reportCoverage scris în sync_runs')
  })

  test('grup schimbat: trigger-ul marchează schimbarea; arhivat și rank absent rămân stări separate', async () => {
    await runWorker('6001')
    const [k] = await db.select<Record<string, unknown>>('keywords', `select=group_ids,previous_group_ids,group_ids_changed_at,status&keyword_id=eq.1002&brand_id=eq.${B1A}`)
    assert.deepEqual(k!.group_ids, ['6001'])
    assert.deepEqual(k!.previous_group_ids, ['6001', '7001'])
    assert.ok(k!.group_ids_changed_at)
    assert.equal(k!.status, 'active')
    const [archived] = await db.select<Record<string, unknown>>('keywords', `select=status,archived_detected_at&keyword_id=eq.1009&brand_id=eq.${B1A}`)
    assert.equal(archived!.status, 'archived')
    const absent = await db.select<Record<string, unknown>>('rank_observations', `select=rank,rank_status,rank_original&keyword_id=eq.1003&brand_id=eq.${B1A}`)
    assert.ok(absent.every((r) => r.rank === null && r.rank_status === 'at_tracking_limit' && r.rank_original === '100'))
  })

  test('RLS: clientul vede datele brandului, nu originalul AI, nu maparea și nici coada; T2 nu vede nimic', async () => {
    assert.ok((await asUser<unknown[]>(CLIENT_T1, 'rank_observations?select=id')).json.length > 0)
    assert.ok((await asUser<unknown[]>(CLIENT_T1, 'ai_answers?select=id')).json.length > 0)
    assert.deepEqual((await asUser<unknown[]>(CLIENT_T1, 'ai_answer_originals?select=answer_id')).json, [])
    assert.ok((await asUser<unknown[]>(STRAT_T1, 'ai_answer_originals?select=answer_id')).json.length > 0)
    assert.deepEqual((await asUser<unknown[]>(CLIENT_T1, 'seomonitor_group_mappings?select=id')).json, [])
    assert.deepEqual((await asUser<unknown[]>(CLIENT_T1, 'seomonitor_mapping_queue?select=id')).json, [])
    assert.ok((await asUser<unknown[]>(STRAT_T1, 'seomonitor_mapping_queue?select=id')).json.length > 0)
    for (const t of ['rank_observations', 'ai_answers', 'keywords', 'seomonitor_metric_observations', 'seomonitor_ai_answer_states']) {
      assert.deepEqual((await asUser<unknown[]>(STRAT_T2, `${t}?select=brand_id`)).json, [], t)
    }
    const write = await asUser(CLIENT_T1, 'rank_observations', { method: 'POST', body: '{}' })
    assert.ok([401, 403].includes(write.status))
  })

  test('view → metrics.compute: Top 3 / Top 10 (last_observation), visibility (medie în perioadă, unitate draft)', async () => {
    const def = async (key: string) => (await asUser<unknown[]>(CLIENT_T1, `metric_definitions_current?metric_key=eq.${key}`)).json[0]
    const obs = async (key: string) =>
      (await asUser<Array<{ date: string; value: number | null; weight: number | null }>>(CLIENT_T1,
        `seomonitor_metric_observations?select=date,value,weight&metric_key=eq.${key}&device=eq.desktop&order=date`)).json
    const compute = async (key: string) => {
      const observations = await obs(key)
      const confirmed = observations.filter((o) => o.value !== null)
      const input = {
        definition: await def(key), brand_id: B1A, as_of_date: '2026-10-07',
        period: { start: '2026-10-05', end: '2026-10-06', kind: 'custom' },
        connection: { connected: true, query_ok: true },
        current: { observations, confirmed_days: new Set(confirmed.map((o) => o.date)).size, data_as_of: confirmed.at(-1)?.date ?? null },
      }
      return JSON.parse(sql(`select metrics.compute($c$${JSON.stringify(input)}$c$::jsonb);`)) as {
        metric: { value: number | null; status: string }; warnings: Array<{ code: string; detail: unknown }>
      }
    }
    const top3 = await compute('seomonitor_keywords_top3')
    assert.equal(Number(top3.metric.value), 1, 'ultima zi: doar keyword 1001 (rank 3) e în Top 3')
    const top10 = await compute('seomonitor_keywords_top10')
    assert.equal(Number(top10.metric.value), 2, 'ultima zi (6 oct): 1001 (3) și 1002 (9); 1003 fără rank, 1009 arhivat are date doar pe 5 oct')
    const vis = await compute('seomonitor_visibility')
    assert.equal(Number(vis.metric.value), 0.265, 'medie ponderată cu zilele: (0.53 + 0) / 2')
    const codes = vis.warnings.map((w) => w.code)
    assert.ok(codes.includes('definition_draft'), 'unitatea visibility e încă draft')
    assert.ok(vis.warnings.some((w) => w.code === 'aggregation_label' && w.detail === 'medie în perioadă'))
    const latest = await compute('seomonitor_visibility_latest')
    assert.equal(Number(latest.metric.value), 0, 'ultima observație = 0 (zero real), nu NULL')
  })

  test('stările AI → metrics.ai_rate_inputs: eroarea tehnică nu intră la numitor', async () => {
    const states = (await asUser<Array<Record<string, unknown>>>(CLIENT_T1,
      'seomonitor_ai_answer_states?select=collection_ok,engine_refused,brand_present,status&surface=eq.ai_search')).json
    assert.deepEqual(states.map((s) => s.status).sort(), ['brand_absent', 'brand_present', 'technical_error'])
    const inputs = JSON.parse(sql(`select metrics.ai_rate_inputs($s$${JSON.stringify(states)}$s$::jsonb);`))
    assert.deepEqual(
      { planned: inputs.planned, valid: inputs.valid, present: inputs.brand_present, errors: inputs.technical_errors },
      { planned: 3, valid: 2, present: 1, errors: 1 },
    )
  })
})
