import type { Brand, PvLogEntry, PvStatus, QueryContext } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'
import { useLayout } from '../../routing/AppLayout'
import { PvLogSection } from './PvLogSection'

const STATUSES: readonly PvStatus[] = ['pending', 'notified', 'acknowledged']

/** Filtrele din URL (allowlist-ul modulului) → predicatul pe jurnal. Valorile necunoscute au căzut deja pe „toate”. */
export function pvFilterFrom(ctx: QueryContext): (e: PvLogEntry) => boolean {
  const status = (STATUSES as readonly string[]).includes(ctx.filters.status ?? '') ? (ctx.filters.status as PvStatus) : null
  const kind = ctx.filters.item === 'mention' || ctx.filters.item === 'ai_answer' ? ctx.filters.item : null
  return (e) => (status === null || e.status === status) && (kind === null || e.item.kind === kind)
}

/**
 * Listening → Farmacovigilență (E-2, varianta a): jurnalul PV, mutat de la baza paginii Listening, cu filtre pe status
 * și tip. Doar `agency_admin` (B7-14): ruta redirecționează celelalte roluri, iar jurnalul nu se cere pentru ele.
 * Marcarea rămâne în feed-ul Listening și în răspunsurile AI.
 */
export function PharmacovigilancePage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx || user.role !== 'agency_admin') return null
  return <PvContent brand={brand} ctx={ctx} />
}

function PvContent({ brand, ctx }: { brand: Brand; ctx: QueryContext }) {
  const providers = useProviders()
  // Jurnalul se filtrează pe perioada aleasă (provider); statusul și tipul doar pe ce s-a încărcat, fără cerere nouă.
  const log = useAsync(() => providers.mentions.pvLog(ctx), [providers, brand.id, ctx.period.from, ctx.period.to])
  return (
    <div className="flex flex-col gap-5">
      <PvLogSection state={log.state} onRetry={log.reload} keep={pvFilterFrom(ctx)} />
    </div>
  )
}
