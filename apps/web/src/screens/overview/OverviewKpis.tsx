import { Link } from 'react-router-dom'
import type { Brand, MetricDefinition, MetricsBundle, ProviderResult, QueryContext, SentimentDistribution, SocialSummary, TrendSeries } from '../../contracts'
import { KpiCard } from '../../components/KpiCard'
import { StatCard } from '../../components/StatCard'
import type { AsyncState } from '../../data/useAsync'
import { changeDirection, formatInteger, formatMetricValue, formatRange, formatRelativeChange } from '../../lib/format'
import { brandPath } from '../../lib/navigation'
import { comparisonRange } from '../../lib/period'
import { sourceName } from '../../lib/sources'
import type { EvidenceTarget } from '../shared/EvidenceHost'
import { MISSING_DEFINITION, unregisteredReason } from '../shared/slots'
import { sparkPoints } from '../shared/sparks'
import { OVERVIEW_CARDS, type OverviewSocialCard } from './slots'

interface Props {
  brand: Brand
  ctx: QueryContext
  /** Perioada și comparația din URL, păstrate la deschiderea detaliului. */
  search: string
  metrics: AsyncState<MetricsBundle>
  definitions: Map<string, MetricDefinition>
  trends: AsyncState<TrendSeries[]>
  sentiment: AsyncState<ProviderResult<SentimentDistribution>>
  social: AsyncState<ProviderResult<SocialSummary>>
  onRetry: () => void
  onOpen: (target: EvidenceTarget) => void
}

/**
 * Ponderea negativă apare doar din mențiunile revizuite de om, împreună cu numărul absolut și cu cele nerevizuite
 * (propunerea din 10 nov. 2026: procentul nu apare fără eșantion). Cifrele vin calculate din `brand_mention_sentiment`.
 */
export function sentimentLine(s: SentimentDistribution): string {
  const pending = s.unreviewed > 0 ? ` · ${formatInteger(s.unreviewed)} nerevizuite` : ''
  if (s.total === 0) return `Nicio mențiune revizuită încă${pending}.`
  const share = s.shares.negative === null ? '' : ` (${formatMetricValue(s.shares.negative, 'percent')})`
  return `Negativ, după revizuire: ${formatInteger(s.negative)} din ${formatInteger(s.total)}${share}${pending}.`
}

function SocialCard({ card, social, ctx, detail }: { card: OverviewSocialCard; social: Props['social']; ctx: QueryContext; detail: React.ReactNode }) {
  const base = { label: 'Interacțiuni (social propriu)', definition: 'Interacțiunile raportate de Planable pentru conturile brandului, în perioada selectată.', category: card.category, detail, sourceLabel: sourceName('planable') }
  if (social.status === 'loading') return <StatCard {...base} valueText={null} status="unavailable" loading />
  if (social.status === 'failed') return <StatCard {...base} valueText={null} status="unavailable" emptyTitle="Nu am putut încărca datele" note={social.message} />
  const r = social.value
  if (r.kind === 'not_connected') return <StatCard {...base} valueText={null} status="not_connected" emptyTitle="Sursă neconectată" note={r.reason} />
  if (r.kind === 'error') return <StatCard {...base} valueText={null} status="unavailable" emptyTitle="Nu am putut încărca datele" note={r.message} />
  const k = r.data.kpis.find((x) => x.key === 'interactions')
  if (!k) return <StatCard {...base} valueText={null} status="unavailable" note="Planable nu a trimis interacțiuni pentru acest interval." dataAsOf={r.data.data_as_of} />
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  return (
    <StatCard
      {...base}
      label={`${k.label} (social propriu)`}
      definition={k.definition}
      valueText={k.value === null ? null : formatInteger(k.value)}
      deltaText={k.change === null ? null : formatRelativeChange(k.change)}
      deltaDirection={k.change === null ? null : changeDirection(k.change)}
      goodWhen="up"
      status={k.status}
      note={[k.note, card.gap].filter(Boolean).join(' ')}
      compareLabel={`față de ${formatRange(cmp.from, cmp.to)}`}
      dataAsOf={r.data.data_as_of}
    />
  )
}

/** Cele șase carduri din Overview. Fiecare își păstrează starea: lipsa unei surse nu blochează celelalte carduri. */
export function OverviewKpis({ brand, ctx, search, metrics, definitions, trends, sentiment, social, onRetry, onOpen }: Props) {
  const items = metrics.status === 'done' ? metrics.value.items : []
  const sentimentReady = sentiment.status === 'done' && sentiment.value.kind === 'ready' ? sentiment.value.data : null
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="kpi-grid">
      {OVERVIEW_CARDS.map((card) => {
        const detail = (
          <Link to={`${brandPath(brand.id, card.module)}${search}`} className="text-[11.5px] font-medium text-accent-text hover:underline" aria-label={`${card.category}: ${card.detailLabel}`}>
            {card.detailLabel}
          </Link>
        )
        if (card.kind === 'social') return <SocialCard key={card.key} card={card} social={social} ctx={ctx} detail={detail} />
        const item = items.find((i) => i.metric_key === card.key) ?? null
        const def = definitions.get(card.key) ?? null
        const label = def?.label ?? card.label
        const cmp = item?.evidence_query.comparison_period
        const extra = [card.key === 'mentions_count' && sentimentReady ? sentimentLine(sentimentReady) : null, card.gap ?? null].filter(Boolean).join(' ')
        return (
          <KpiCard
            key={card.key}
            category={card.category}
            label={label}
            definition={def?.formula ?? MISSING_DEFINITION}
            metric={item}
            loading={metrics.status === 'loading'}
            error={metrics.status === 'failed' ? metrics.message : null}
            spark={sparkPoints(trends, card.key)}
            direction={def?.direction ?? 'neutral'}
            qualifier={def?.aggregation_label ?? null}
            compareLabel={cmp ? `față de ${formatRange(cmp.start, cmp.end)}` : undefined}
            emptyReason={def === null && item?.status === 'not_connected' ? unregisteredReason(card) : null}
            extra={extra || null}
            detail={detail}
            onOpen={() => item && onOpen({ page: 'Overview', label, query: item.evidence_query, item, definition: def })}
            onRetry={onRetry}
          />
        )
      })}
    </div>
  )
}
