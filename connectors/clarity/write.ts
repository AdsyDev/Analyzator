// Scrierea în clarity_daily: upsert idempotent pe (tenant_id, brand_id, date, dimension, dimension_value).
// Doar worker (service role). Verificare explicită a tenantului: înainte (fiecare rând aparține scope-ului)
// și după (fiecare rând întors aparține scope-ului).

import { assertUuid, type Db } from '../shared/supabase-rest.ts'
import type { ClarityWriter } from './collect-core.ts'
import type { ClarityDailyRow } from './parse.ts'

export const CLARITY_UNIQUE_KEY = ['tenant_id', 'brand_id', 'date', 'dimension', 'dimension_value']
/** Răspunsul Clarity are cel mult 1.000 de rânduri; scriem în loturi mai mici. */
const BATCH = 500

export function clarityWriter(db: Db): ClarityWriter<ClarityDailyRow> {
  return {
    async upsert(scope, rows) {
      assertUuid(scope.tenant_id, 'tenant_id')
      assertUuid(scope.brand_id, 'brand_id')
      for (const row of rows) {
        if (row.tenant_id !== scope.tenant_id || row.brand_id !== scope.brand_id) {
          throw new Error('clarity_daily: rând pentru alt tenant sau brand; opresc scrierea.')
        }
      }
      let written = 0
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const returned = await db.upsert<{ tenant_id: string; brand_id: string }>('clarity_daily', batch, CLARITY_UNIQUE_KEY)
        if (returned.length !== batch.length) {
          throw new Error(`clarity_daily: upsert a întors ${returned.length} rânduri din ${batch.length}.`)
        }
        for (const r of returned) {
          if (r.tenant_id !== scope.tenant_id || r.brand_id !== scope.brand_id) {
            throw new Error('clarity_daily: rândul întors aparține altui tenant sau brand; opresc rularea.')
          }
        }
        written += returned.length
      }
      return written
    },
  }
}
