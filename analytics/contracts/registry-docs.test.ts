// Documentele și implementarea nu au voie să se despartă:
// - câmpurile și statusurile din docs/contracts/metric-response.md = cele din tipul TS;
// - cheile și versiunile din docs/metrics/registry.md = cele inserate în migrații.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { METRIC_CONTRACT_VERSION, METRIC_FIELDS, METRIC_FIELDS_V2, METRIC_STATUSES, METRIC_UNITS_V2, META_FIELDS } from './metric-response.ts'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`)
  assert.ok(start >= 0, `lipsește secțiunea „${heading}"`)
  const next = markdown.indexOf('\n## ', start + 1)
  return markdown.slice(start, next === -1 ? undefined : next)
}

/** Prima coloană `cod` din rândurile unui tabel markdown. */
function firstCodeColumn(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]!)
}

describe('contractul MetricResponse', () => {
  const doc = read('docs/contracts/metric-response.md')

  test('câmpurile metricii din doc (versiunea 2) = METRIC_FIELDS_V2', () => {
    assert.deepEqual(firstCodeColumn(section(doc, 'Câmpurile metricii')), [...METRIC_FIELDS_V2])
  })

  test('versiunea 2 = versiunea 1 plus câmpul currency', () => {
    assert.deepEqual([...METRIC_FIELDS_V2].filter((f) => !(METRIC_FIELDS as readonly string[]).includes(f)), ['currency'])
    assert.deepEqual([...METRIC_FIELDS].filter((f) => !(METRIC_FIELDS_V2 as readonly string[]).includes(f)), [])
  })

  test('unitățile din doc = METRIC_UNITS_V2', () => {
    const row = section(doc, 'Câmpurile metricii').split('\n').find((l) => l.startsWith('| `unit` |'))!
    const units = [...row.split('|')[2]!.matchAll(/`([a-z]+)`/g)].map((m) => m[1])
    assert.deepEqual(units, [...METRIC_UNITS_V2])
  })

  test('versiunea contractului din doc = METRIC_CONTRACT_VERSION', () => {
    assert.match(doc, new RegExp(`\\*\\*Versiunea ${METRIC_CONTRACT_VERSION}\\*\\*`))
  })

  test('statusurile din doc = METRIC_STATUSES, în aceeași ordine', () => {
    const statuses = [...section(doc, 'Statusuri').matchAll(/^\| \d+ \| `([a-z_]+)` \|/gm)].map((m) => m[1])
    assert.deepEqual(statuses, [...METRIC_STATUSES])
  })

  test('câmpurile meta din doc = META_FIELDS', () => {
    const rows = [...section(doc, 'Meta').matchAll(/^\| ((?:`[a-z_]+`(?:, )?)+) \|/gm)]
      .flatMap((m) => [...m[1]!.matchAll(/`([a-z_]+)`/g)].map((x) => x[1]))
    assert.deepEqual([...rows].sort(), [...META_FIELDS].sort())
  })
})

describe('registrul de metrici', () => {
  // Nivel A în registry.md; nivel B (import CSV) în registry-b.md.
  const docA = read('docs/metrics/registry.md')
  const docB = read('docs/metrics/registry-b.md')
  const doc = `${docA}\n${docB}`
  // Nivel A (conectori automate) și nivel B (import CSV): aceeași regulă pentru ambele.
  const rowRe = /^\| `([a-z0-9_]+)` \| (\d+) \|/gm
  const documented = [
    ...section(docA, 'Metrici de nivel A').matchAll(rowRe),
    ...section(docB, 'Metrici de nivel B (import CSV)').matchAll(rowRe),
  ]
    .map((m) => `${m[1]}@${m[2]}`)
    .sort()

  const migrations = readdirSync(join(root, 'supabase', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => read(join('supabase', 'migrations', f)))
    .join('\n')
  const inserted = [...migrations.matchAll(/^\s*\('([a-z][a-z0-9_]*)', (\d+), '/gm)]
    .map((m) => `${m[1]}@${m[2]}`)
    .sort()

  test('fiecare definiție din migrații e documentată și invers', () => {
    assert.ok(inserted.length > 0, 'nicio definiție găsită în migrații')
    assert.deepEqual(documented, inserted)
  })

  test('fiecare metrică are o secțiune de detalii', () => {
    for (const key of documented.map((k) => k.split('@')[0])) {
      assert.match(doc, new RegExp(`^### ${key}$`, 'm'), key)
    }
  })
})
