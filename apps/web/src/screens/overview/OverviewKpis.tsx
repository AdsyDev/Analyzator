import { ChartBarIcon, ChatCircleTextIcon, RobotIcon, SmileyIcon, StackIcon, TrophyIcon, type Icon } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import type { Brand, CompetitionMatrix, MetricDefinition, MetricsBundle, ProviderResult, SentimentDistribution } from '../../contracts'
import { KpiTile } from '../../components/KpiTile'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger, formatMetricValue, formatRange } from '../../lib/format'
import { isGoodChange, metricView } from '../../lib/metricView'
import { brandPath } from '../../lib/navigation'
import type { EvidenceTarget } from '../shared/EvidenceHost'
import { MISSING_DEFINITION, unregisteredReason } from '../shared/slots'
import { positionRows } from './position'
import { OVERVIEW_CARDS } from './slots'

interface Props {
  brand: Brand
  /** Perioada și comparația din URL, păstrate la deschiderea detaliului. */
  search: string
  metrics: AsyncState<MetricsBundle>
  definitions: Map<string, MetricDefinition>
  sentiment: AsyncState<ProviderResult<SentimentDistribution>>
  matrix: AsyncState<ProviderResult<CompetitionMatrix>>
  onRetry: () => void
  onOpen: (target: EvidenceTarget) => void
}

const ICONS: Record<string, Icon> = {
  ai_sov: RobotIcon,
  ai_mention_rate: ChatCircleTextIcon,
  seomonitor_visibility_latest: StackIcon,
  sentiment_positive: SmileyIcon,
  gsc_clicks: ChartBarIcon,
  competitive_position: TrophyIcon,
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

const SENTIMENT_LABEL = 'Sentiment pozitiv (mențiuni revizuite)'
const SENTIMENT_DEFINITION = 'Ponderea mențiunilor cu sentiment pozitiv din mențiunile revizuite de echipă, în perioada selectată. Mențiunile nerevizuite și postările din conturile proprii nu intră.'
const POSITION_LABEL = 'Locul în setul de competitori (AI)'
const POSITION_DEFINITION = 'Locul brandului printre competitorii din setul în vigoare, pe primul indicator AI din matricea de Concurență. Entitățile fără valoare nu intră în clasament. Nu e un scor compus.'

/** Starea unui card care citește un provider: încărcare, eroare sau „Sursă neconectată”, înainte de date. */
function gate<T>(state: AsyncState<ProviderResult<T>>): { data: T } | { tile: { state: 'loading' | 'error' | 'ready'; valueText: null; error?: string; emptyTitle?: string; emptyReason?: string; status?: 'not_connected' | 'unavailable' } } {
  if (state.status === 'loading') return { tile: { state: 'loading', valueText: null } }
  if (state.status === 'failed') return { tile: { state: 'error', valueText: null, error: state.message } }
  if (state.value.kind === 'error') return { tile: { state: 'error', valueText: null, error: state.value.message } }
  if (state.value.kind === 'not_connected') return { tile: { state: 'ready', valueText: null, emptyTitle: 'Sursă neconectată', emptyReason: state.value.reason, status: 'not_connected' } }
  return { data: state.value.data }
}

/**
 * Cei șase indicatori din Overview, în ordinea din machetă. Patru sunt metrici din registru (cu numele lor exact și cu
 * dovezi la click); sentimentul și poziția competitivă vin din `brand_mention_sentiment` și din matricea de Concurență.
 * Fiecare card își păstrează starea: lipsa unei surse nu le blochează pe celelalte.
 */
export function OverviewKpis({ brand, search, metrics, definitions, sentiment, matrix, onRetry, onOpen }: Props) {
  const items = metrics.status === 'done' ? metrics.value.items : []
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-3 @3xl:grid-cols-3 @7xl:grid-cols-6" data-testid="kpi-grid">
      {OVERVIEW_CARDS.map((card) => {
        const detail = (
          <Link to={`${brandPath(brand.id, card.module)}${search}`} className="text-[11.5px] font-medium text-accent-text hover:underline" aria-label={`${card.category}: ${card.detailLabel}`}>
            {card.detailLabel}
          </Link>
        )
        const icon = ICONS[card.key] ?? ChartBarIcon

        if (card.kind === 'sentiment') {
          const g = gate(sentiment)
          if ('tile' in g) return <KpiTile key={card.key} icon={icon} title={card.category} label={SENTIMENT_LABEL} definition={SENTIMENT_DEFINITION} detail={detail} onRetry={onRetry} {...g.tile} />
          const s = g.data
          const has = s.total > 0 && s.shares.positive !== null
          return (
            <KpiTile
              key={card.key} icon={icon} title={card.category} label={SENTIMENT_LABEL} definition={SENTIMENT_DEFINITION} detail={detail} state="ready" status={has ? 'ok' : 'unavailable'}
              valueText={has ? formatMetricValue(s.shares.positive, 'percent') : null}
              sub={has ? `${formatInteger(s.positive)} din ${formatInteger(s.total)} revizuite${s.unreviewed > 0 ? ` · ${formatInteger(s.unreviewed)} nerevizuite` : ''}` : null}
              emptyTitle="Fără mențiuni revizuite" emptyReason={sentimentLine(s)}
            />
          )
        }

        if (card.kind === 'position') {
          const g = gate(matrix)
          if ('tile' in g) return <KpiTile key={card.key} icon={icon} title={card.category} label={POSITION_LABEL} definition={POSITION_DEFINITION} detail={detail} onRetry={onRetry} {...g.tile} />
          const row = positionRows(g.data).find((p) => p.dimension === 'ai')
          return (
            <KpiTile
              key={card.key} icon={icon} title={card.category} label={POSITION_LABEL} definition={POSITION_DEFINITION} detail={detail} state="ready" status={row?.rank ? 'ok' : 'unavailable'}
              valueText={row?.rank ? `#${row.rank.place} din ${row.rank.of}` : null}
              sub={row?.rank ? `După ${row.row.label}.` : null}
              emptyTitle="Fără clasament" emptyReason={row?.rankReason ?? 'Matricea de Concurență nu are un indicator AI.'}
            />
          )
        }

        const item = items.find((i) => i.metric_key === card.key) ?? null
        const def = definitions.get(card.key) ?? null
        const label = def?.label ?? card.label
        const view = item ? metricView(item) : null
        const cmp = item?.evidence_query.comparison_period
        return (
          <KpiTile
            key={card.key}
            icon={icon}
            title={card.category}
            label={label}
            definition={def?.formula ?? MISSING_DEFINITION}
            state={metrics.status === 'loading' ? 'loading' : metrics.status === 'failed' ? 'error' : 'ready'}
            status={item?.status}
            error={metrics.status === 'failed' ? metrics.message : null}
            valueText={view?.hasValue ? view.valueText : null}
            deltaText={view?.deltaText}
            deltaDirection={view?.deltaDirection}
            deltaGood={view?.deltaDirection ? isGoodChange(def?.direction ?? 'neutral', view.deltaDirection) : null}
            sub={view?.deltaText && cmp ? `față de ${formatRange(cmp.start, cmp.end)}` : null}
            caveat={view?.caveat}
            emptyTitle={view?.emptyTitle ?? 'Fără date pentru interval'}
            emptyReason={def === null && item?.status === 'not_connected' ? unregisteredReason(card) : (view?.emptyReason ?? null)}
            detail={detail}
            onOpen={item ? () => onOpen({ page: 'Overview', label, query: item.evidence_query, item, definition: def }) : undefined}
            onRetry={onRetry}
          />
        )
      })}
    </div>
  )
}
