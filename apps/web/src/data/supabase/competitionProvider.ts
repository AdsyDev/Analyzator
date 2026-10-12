import { failed, METRIC_STATUSES, METRIC_UNITS, notConnected, ready, type CompetitionGap, type CompetitionMatrix, type CompetitionProvider } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const NO_SET = 'Brandul nu are încă un set de competitori în vigoare; comparațiile apar după configurarea lui.'
const DIMENSIONS = ['ai', 'seo', 'social', 'listening']
const DIRECTIONS = ['higher_is_better', 'lower_is_better', 'neutral']
const rpcError = (e: { code?: string } | null) => (e?.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)

/** Concurența din SQL (D-16): aceleași definiții și intervale pentru brand și competitori; N/A cu motiv, nu zero. */
export function createSupabaseCompetition(client: DataClient): CompetitionProvider {
  return {
    async matrix(ctx) {
      const { data, error } = await client.rpc('brand_competition', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset) })
      if (error) return failed(rpcError(error))
      const d = data as (CompetitionMatrix & { has_set?: boolean }) | null
      if (!d || typeof d.has_set !== 'boolean') return failed(CONTRACT)
      if (!d.has_set) return notConnected(NO_SET)
      for (const g of d.groups ?? []) {
        if (!DIMENSIONS.includes(g.dimension)) return failed(CONTRACT)
        for (const r of g.rows) {
          if (!DIRECTIONS.includes(r.direction)) return failed(CONTRACT)
          for (const c of Object.values(r.cells)) {
            if (!(METRIC_STATUSES as readonly string[]).includes(c.status) || !(METRIC_UNITS as readonly string[]).includes(c.unit)) return failed(CONTRACT)
            c.value = c.value === null || c.value === undefined ? null : Number(c.value)
          }
        }
      }
      const { has_set: _h, ...matrix } = d
      return ready(matrix as CompetitionMatrix)
    },

    async gaps(ctx) {
      const { data, error } = await client.rpc('brand_competition_gaps', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as { has_set?: boolean; connected?: boolean; gaps?: CompetitionGap[] } | null
      if (!d || typeof d.has_set !== 'boolean') return failed(CONTRACT)
      if (!d.has_set) return notConnected(NO_SET)
      if (d.connected === false) return notConnected('Răspunsurile AI (SEOmonitor) nu sunt conectate pentru acest brand.')
      if (!Array.isArray(d.gaps)) return failed(CONTRACT)
      return ready(d.gaps)
    },
  }
}
