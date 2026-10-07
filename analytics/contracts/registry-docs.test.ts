// Documentele și implementarea nu au voie să se despartă:
// - câmpurile și statusurile din docs/contracts/metric-response.md = cele din tipul TS;
// - cheile și versiunile din docs/metrics/registry.md = cele inserate în migrații.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { METRIC_FIELDS, METRIC_STATUSES, META_FIELDS } from './metric-response.ts'

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

  test('câmpurile metricii din doc = METRIC_FIELDS', () => {
    assert.deepEqual(firstCodeColumn(section(doc, 'Câmpurile metricii')), [...METRIC_FIELDS])
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
  const doc = read('docs/metrics/registry.md')
  const documented = [...section(doc, 'Metrici de nivel A').matchAll(/^\| `([a-z0-9_]+)` \| (\d+) \|/gm)]
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
