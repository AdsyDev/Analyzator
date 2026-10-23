import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Brand, QueryContext, Sentiment, SentimentFilter } from '../../contracts'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics, useTrends } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { brandPath } from '../../lib/navigation'
import { sharedSearch } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { EvidenceHost, type EvidenceTarget } from '../shared/EvidenceHost'
import { KpiGrid } from '../shared/KpiGrid'
import { LISTENING_KPI_KEYS, LISTENING_KPI_SLOTS } from './slots'
import { MentionFeed, type MentionFilters } from './MentionFeed'
import { SentimentSection } from './SentimentSection'

const SENTIMENTS: readonly Sentiment[] = ['positive', 'neutral', 'negative']

/** Filtrele din URL → filtrele provider-ului; valorile au trecut deja de allowlist-ul din `useQueryContext`. */
export function mentionFiltersFrom(ctx: QueryContext): MentionFilters {
  const s = ctx.filters.sentiment
  const src = ctx.filters.source
  const author = ctx.filters.author
  return {
    sentiment: s === 'unreviewed' || (SENTIMENTS as readonly string[]).includes(s ?? '') ? (s as SentimentFilter) : null,
    source: src && src !== 'all' ? src : null,
    author: author === 'external' || author === 'owned' ? author : null,
  }
}

/**
 * Listening (spec cap. 18): KPI (neconectate până intră în registru), distribuția sentimentului și feed-ul de
 * mențiuni cu marcare pentru farmacovigilență. Jurnalul PV are submeniul lui (Farmacovigilență, E-2), doar pentru
 * `agency_admin`.
 */
export function ListeningPage() {
  const { brand, ctx, user } = useLayout()
  if (!brand || !ctx) return null
  return <ListeningContent brand={brand} ctx={ctx} admin={user.role === 'agency_admin'} />
}

function ListeningContent({ brand, ctx, admin }: { brand: Brand; ctx: QueryContext; admin: boolean }) {
  const providers = useProviders()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<EvidenceTarget | null>(null)
  const filters = mentionFiltersFrom(ctx)
  const key = ctxKey(ctx)

  const metrics = useMetrics(ctx, LISTENING_KPI_KEYS)
  const { byKey } = useDefinitions(LISTENING_KPI_KEYS)
  const sparks = useTrends(ctx, LISTENING_KPI_KEYS)
  const sentiment = useAsync(() => providers.mentions.sentiment(ctx), [providers, key])

  return (
    <div className="flex flex-col gap-5">
      <KpiGrid slots={LISTENING_KPI_SLOTS} page="Listening" metrics={metrics.state} definitions={byKey} trends={sparks.state} onRetry={metrics.reload} onOpen={setTarget} />
      <SentimentSection state={sentiment.state} onRetry={sentiment.reload} />
      <MentionFeed key={key} brand={brand} ctx={ctx} filters={filters} onChanged={() => {}} />
      {admin && (
        <p className="text-[12.5px] text-text-2">
          Marcajele pentru farmacovigilență, cu starea notificării, sunt în{' '}
          <Link to={{ pathname: brandPath(brand.id, 'pharmacovigilance'), search: sharedSearch(params) }} className="font-medium text-accent-text underline-offset-2 hover:underline">
            Listening → Farmacovigilență
          </Link>
          .
        </p>
      )}
      <EvidenceHost brand={brand} target={target} onClose={() => setTarget(null)} canManageSources={admin} />
    </div>
  )
}
