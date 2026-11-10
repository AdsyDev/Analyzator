import type { IsoDateTime, SourceFreshness, SourceProviderId } from '../contracts'
import { formatDate, formatDateTime } from '../lib/format'
import { nextScheduledRunFor } from '../lib/schedule'
import { sourceName } from '../lib/sources'
import { StatusChip, type ChipTone } from './ui/Chip'

const STATE: Record<SourceFreshness['freshness'], { label: string; tone: ChipTone }> = {
  current: { label: 'La zi', tone: 'pos' },
  delayed: { label: 'Întârziat', tone: 'warn' },
  no_data: { label: 'Fără date', tone: 'neutral' },
}

interface Props {
  /** Sursele de care depinde modulul. */
  sources: readonly SourceProviderId[]
  /** `null` cât timp se încarcă sau când starea surselor nu poate fi citită. */
  freshness: SourceFreshness[] | null
  /** Ultima sincronizare reușită, doar unde utilizatorul o poate vedea (echipa agenției). */
  syncedAt?: IsoDateTime | null
  now?: Date
}

/**
 * Starea datelor unui modul (propunerea din 10 nov. 2026): până când există date pe fiecare sursă, când s-a
 * sincronizat ultima dată și când e programată următoarea colectare. Nu calculează nimic: afișează ce spune
 * vederea `source_freshness` și programarea din `lib/schedule`. „Fără date" nu e zero și nu ascunde sursa.
 */
export function ModuleFreshness({ sources, freshness, syncedAt = null, now = new Date() }: Props) {
  if (sources.length === 0) return null
  if (freshness === null) return <div role="status" aria-label="Se încarcă starea surselor" className="h-9 rounded-xl bg-skeleton" />
  const rows = sources.map((p) => freshness.find((f) => f.provider === p) ?? { provider: p, data_as_of: null, freshness: 'no_data' as const })
  const live = rows.filter((r) => r.data_as_of !== null)
  const next = nextScheduledRunFor(live.map((r) => r.provider), now)

  return (
    <section aria-label="Starea datelor" className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-[12.5px] text-text-2 shadow-1">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Date până la, pe sursă">
        {rows.map((r) => (
          <li key={r.provider} className="inline-flex items-center gap-1.5" data-freshness={r.freshness}>
            <span className="font-medium text-text">{sourceName(r.provider)}</span>
            {r.data_as_of ? (
              <span>
                date până la <span className="font-mono text-[12px] text-text">{formatDate(r.data_as_of)}</span>
              </span>
            ) : null}
            <StatusChip tone={STATE[r.freshness].tone}>{STATE[r.freshness].label}</StatusChip>
          </li>
        ))}
      </ul>
      <span className="flex-1" />
      {syncedAt && (
        <span>
          Sincronizat la <span className="font-mono text-[12px] text-text">{formatDateTime(syncedAt)}</span>
        </span>
      )}
      {next && (
        <span title="După programul colectării; o rulare poate întârzia sau poate fi oprită de echipă.">
          Următoarea actualizare estimată <span className="font-mono text-[12px] text-text">{formatDateTime(next.toISOString())}</span>
        </span>
      )}
    </section>
  )
}
