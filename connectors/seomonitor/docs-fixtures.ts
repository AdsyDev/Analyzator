// Încărcarea fixtures SEOmonitor derivate din documentație (tests/fixtures/seomonitor/docs-derived). Doar pentru teste.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FIXTURES = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'seomonitor', 'docs-derived')

export const FIXTURE_FILES = [
  'campaigns-tracked', 'groups', 'keywords', 'keywords-branded', 'daily-ranks', 'daily-ranks-archive', 'groups-daily-visibility',
  'keywords-ais', 'keywords-daily-ranks-ais', 'keywords-competition-ais', 'groups-daily-visibility-ais-mentions',
  'groups-daily-visibility-ais-citations', 'ais-stats', 'keywords-aio',
] as const
export type FixtureName = (typeof FIXTURE_FILES)[number]

export function seoFixture(name: FixtureName): { header: string; source: string; payload: unknown } {
  const doc = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { _header: string; _source: string; payload: unknown }
  return { header: doc._header, source: doc._source, payload: doc.payload }
}
