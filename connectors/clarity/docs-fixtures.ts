// Încărcarea fixtures Clarity derivate din documentație (tests/fixtures/clarity/docs-derived). Doar pentru teste.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClarityDimensionKey } from './collect-core.ts'

const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'clarity', 'docs-derived')
const FILE: Record<ClarityDimensionKey, string> = { all: 'totals', device: 'device', source: 'source', page: 'page' }

export function docsFixture(key: ClarityDimensionKey): { header: string; request: string; payload: unknown } {
  const doc = JSON.parse(readFileSync(join(FIXTURES, `${FILE[key]}.json`), 'utf8')) as {
    _header: string
    _request: string
    payload: unknown
  }
  return { header: doc._header, request: doc._request, payload: doc.payload }
}
