import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDefinitions } from '../supabase/mapMetrics'
import { FIXTURE_DEFINITIONS } from './metrics'
import profilesFile from '../../../../../tests/fixtures/ui/metric-profiles.json'

/**
 * Fixtures nu au voie să se despartă de registru. Citește migrația cu `insert into public.metric_definitions`
 * și docs/metrics/registry.md și le compară cu `definitions.json` și cu profilurile de date fictive.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const migrations = join(ROOT, 'supabase/migrations')
const sql = readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(migrations, f), 'utf8'))
  .find((t) => t.includes('insert into public.metric_definitions'))
const text = (s: string) => s.replace(/''/g, "'")
const nullable = (s: string) => (s === 'null' ? null : text(s.slice(1, -1)))

// ('key', version, 'name', 'formula', 'unit', 'source', 'aggregation', multiplier, weight|null,
//  label|null, 'direction', min_sample|null, grace, 'lifecycle', note|null, 'valid_from', 'doc_ref')
const ROW =
  /\('([a-z0-9_]+)', (\d+), '((?:[^']|'')*)', '((?:[^']|'')*)', '(\w+)', '(\w+)', '\w+', [\d.]+, (?:null|'\w+'),\s*(null|'(?:[^']|'')*'), '(\w+)', (?:null|[\d.]+), \d+, '(\w+)', (null|'(?:[^']|'')*'), '[\d-]+', '([^']*)'\)/g

function registryFromSql() {
  expect(sql, 'nu am găsit migrația cu definițiile registrului').toBeDefined()
  const block = sql!.slice(sql!.indexOf('insert into public.metric_definitions'))
  return [...block.matchAll(ROW)].map((m) => ({
    metric_key: m[1]!,
    version: Number(m[2]),
    name_ro: text(m[3]!),
    formula_ro: text(m[4]!),
    unit: m[5]!,
    primary_source: m[6]!,
    aggregation_label: nullable(m[7]!),
    direction: m[8]!,
    lifecycle: m[9]!,
    lifecycle_note: nullable(m[10]!),
    doc_ref: m[11]!,
  }))
}

describe('fixtures ↔ registrul de metrici', () => {
  it('migrația are cel puțin cele 16 definiții de nivel A (parserul de test funcționează)', () => {
    expect(registryFromSql().length).toBeGreaterThanOrEqual(16)
  })

  it('definitions.json = rândurile din migrație (chei, versiuni, nume, formule, unități, surse, direcții, stare)', () => {
    expect(FIXTURE_DEFINITIONS).toEqual(parseDefinitions(registryFromSql()))
  })

  it('cheile din registru.md = cheile de nivel A din toate migrațiile (nivelul B e în registry-b.md)', () => {
    const md = readFileSync(join(ROOT, 'docs/metrics/registry.md'), 'utf8')
    const keys = [...md.matchAll(/^\| `([a-z0-9_]+)` \| \d+ \|/gm)].map((m) => m[1])
    const levelB = new Set([...readFileSync(join(ROOT, 'docs/metrics/registry-b.md'), 'utf8').matchAll(/^\| `([a-z0-9_]+)` \| \d+ \|/gm)].map((m) => m[1]))
    const all = readdirSync(migrations)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .flatMap((f) => [...readFileSync(join(migrations, f), 'utf8').matchAll(/^\s*\('([a-z][a-z0-9_]*)', \d+, '/gm)].map((m) => m[1]!))
    const levelA = [...new Set(all)].filter((k) => !levelB.has(k))
    expect(keys).toEqual(levelA)
    // Prima migrație rămâne baza nivelului A; cele adăugate ulterior (de ex. AI, D-15) vin după.
    expect(levelA.slice(0, registryFromSql().length)).toEqual(registryFromSql().map((r) => r.metric_key))
  })

  it('profilurile de date fictive acoperă exact cheile din registru, nimic în plus', () => {
    expect(Object.keys(profilesFile.profiles)).toEqual(registryFromSql().map((r) => r.metric_key))
  })

  it('unitatea din profil e cea din registru', () => {
    const units = Object.fromEntries(registryFromSql().map((r) => [r.metric_key, r.unit]))
    for (const [key, p] of Object.entries(profilesFile.profiles)) expect(p.unit, key).toBe(units[key])
  })
})
