import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AiEngineStat, CompetitionMatrix, MetricDefinition, MetricItem, MetricsBundle, ProviderResult, QueryContext, SentimentDistribution, TrendSeries } from '../../contracts'
import { Sparkline } from '../../components/Sparkline'
import { TrendChart } from '../../components/TrendChart'
import type { AsyncState } from '../../data/useAsync'
import { AI_ENGINE_LABELS } from '../../lib/ai'
import { toChartSeries, type ChartSeries } from '../../lib/chartData'
import { formatDayMonth, formatInteger, formatMetricValue, formatRange } from '../../lib/format'
import { resolvePeriod } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { metricView } from '../../lib/metricView'
import { trendReason } from '../../lib/warnings'
import { ProviderProblem } from '../../routing/pages'
import { positionRows } from './position'
import { AI_TREND_KEY, ORGANIC_TREND_KEY } from './slots'

/**
 * Cardurile de sub indicatori, în compoziția din machetă: evoluția vizibilității AI, vizibilitatea pe platforme, SEO și
 * trafic, Social listening și Competitori. Niciun card nu calculează: arată valorile venite de la server și starea lor.
 */
function Card({ id, title, description, action, children, className }: { id: string; title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-1 ${className ?? ''}`}>
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="font-display text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description && <p className="mt-0.5 text-[12px] leading-snug text-text-2">{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
const more = (to: string, label: string) => (
  <Link to={to} className="text-[12.5px] font-medium text-accent-text hover:underline">
    {label}
  </Link>
)
const skeleton = (label: string, h = 'h-32') => <div role="status" aria-label={label} className={`${h} rounded-xl bg-skeleton`} />

/** O bară orizontală cu valoare în procente. Lățimea e valoarea însăși (0–100), nu o normalizare. */
function Bar({ label, pct, text, highlight = false }: { label: string; pct: number | null; text: string; highlight?: boolean }) {
  return (
    <li className={`grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-[13px] ${highlight ? 'bg-accent-soft font-semibold text-accent-text' : ''}`}>
      <span className="truncate">{label}</span>
      <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-neutral-soft">
        {pct !== null && <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
      </span>
      <span className={`tabular-nums ${pct === null ? 'text-text-3' : ''}`}>{text}</span>
    </li>
  )
}

const QUICK_PERIODS = [
  { preset: '28d', label: '28 zile' },
  { preset: '90d', label: '90 zile' },
] as const

/** Comutatorul de perioadă din machetă. Schimbă perioada întregii pagini (aceeași din bara de sus), nu doar graficul. */
function QuickPeriod({ ctx }: { ctx: QueryContext }) {
  const { changeFilters } = useLayout()
  return (
    <div role="group" aria-label="Perioada paginii" className="flex flex-none items-center gap-0.5 rounded-[10px] border border-border bg-surface-2 p-0.5">
      {QUICK_PERIODS.map((p) => {
        const on = ctx.period.preset === p.preset
        return (
          <button key={p.preset} type="button" aria-pressed={on} onClick={() => changeFilters({ period: resolvePeriod(p.preset) })} className={`h-7 rounded-lg px-2.5 text-[12px] font-semibold transition-colors ${on ? 'bg-accent-soft text-accent-text' : 'text-text-2 hover:text-text'}`}>
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

export function AiTrendCard({ ctx, trends, label, onRetry, href }: { ctx: QueryContext; trends: AsyncState<TrendSeries[]>; label: string; onRetry: () => void; href: string }) {
  const series = trends.status === 'done' ? trends.value.find((t) => t.metric_key === AI_TREND_KEY) : undefined
  let chart: { labels: string[]; series: ChartSeries[] } = { labels: [], series: [] }
  if (series) {
    const main = toChartSeries([series])
    chart = { labels: main.labels, series: main.series.map((s) => ({ ...s, name: label })) }
    if (series.comparison_points) chart.series.push({ key: `${series.metric_key}:cmp`, name: 'Perioada de comparație', color: 'var(--text-3)', dashed: true, values: series.comparison_points.map((p) => p.value) })
  }
  const hasGaps = !!series?.points.some((p) => p.value === null) && series.points.some((p) => p.value !== null)
  return (
    <Card id="ai-trend" title="Evoluția vizibilității AI" description={`${label}, ${formatRange(ctx.period.from, ctx.period.to)}. Linia punctată e perioada de comparație.`} action={<div className="flex flex-wrap items-center gap-3"><QuickPeriod ctx={ctx} />{more(href, 'Vizibilitate AI')}</div>} className="@5xl:col-span-2">
      <TrendChart
        title={`Evoluție: ${label}`}
        labels={chart.labels}
        series={chart.series}
        height={220}
        format="pct"
        smooth
        area
        endMarkers
        loading={trends.status === 'loading'}
        error={trends.status === 'failed' ? trends.message : null}
        onRetry={onRetry}
        unavailableReason={series ? trendReason(series.status) : trends.status === 'done' ? 'Seria nu a venit de la server pentru acest interval.' : null}
        note={hasGaps ? 'Zilele fără date apar hașurate; nu sunt zero.' : undefined}
      />
    </Card>
  )
}

export function PlatformsCard({ state, onRetry, href }: { state: AsyncState<ProviderResult<AiEngineStat[]>>; onRetry: () => void; href: string }) {
  let body
  if (state.status === 'loading') body = skeleton('Se încarcă vizibilitatea pe platforme', 'h-40')
  else if (state.status === 'failed') body = <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={onRetry} />
  else if (state.value.kind !== 'ready') body = <ProviderProblem result={state.value} onRetry={onRetry} />
  else if (state.value.data.length === 0) body = <p className="text-[13px] text-text-2">Niciun engine cu răspunsuri colectate în perioada aleasă.</p>
  else {
    body = (
      <ul aria-label="AI Mention Rate pe platformă" className="flex flex-col gap-0.5">
        {[...state.value.data]
          .sort((a, b) => (b.mention_rate ?? -1) - (a.mention_rate ?? -1))
          .map((e) => (
            <Bar key={e.engine} label={AI_ENGINE_LABELS[e.engine]} pct={e.mention_rate} text={formatMetricValue(e.mention_rate, 'percent') ?? 'Fără date'} />
          ))}
      </ul>
    )
  }
  return (
    <Card id="ai-platforms" title="Vizibilitate pe platforme" description="AI Mention Rate pe fiecare engine, din răspunsurile valide ale perioadei." action={more(href, 'Engine-uri')}>
      {body}
    </Card>
  )
}

function Row({ label, item, definition }: { label: string; item: MetricItem | null; definition: MetricDefinition | undefined }) {
  const v = item ? metricView(item) : null
  return (
    <div className="flex items-baseline gap-3 border-t border-border py-2 text-[13px]" title={definition?.formula}>
      <dt className="min-w-0 flex-1 truncate text-text-2">{definition?.label ?? label}</dt>
      <dd className="tabular-nums">
        {v?.hasValue ? (
          <>
            <span className="font-semibold">{v.valueText}</span>
            {v.deltaText && <span className="ml-2 text-[12px] text-text-2">{v.deltaText}</span>}
          </>
        ) : (
          <span className="text-text-3">{v?.emptyTitle ?? 'Fără date'}</span>
        )}
      </dd>
    </div>
  )
}

export function SeoTrafficCard({ metrics, definitions, trends, onRetry, onRetryTrends, href }: { metrics: AsyncState<MetricsBundle>; definitions: Map<string, MetricDefinition>; trends: AsyncState<TrendSeries[]>; onRetry: () => void; onRetryTrends: () => void; href: string }) {
  const items = metrics.status === 'done' ? metrics.value.items : []
  const item = (key: string) => items.find((i) => i.metric_key === key) ?? null
  const series = trends.status === 'done' ? trends.value.find((t) => t.metric_key === ORGANIC_TREND_KEY) : undefined
  const name = definitions.get(ORGANIC_TREND_KEY)?.label ?? 'Clicks (Search Console)'
  return (
    <Card id="seo-traffic" title="SEO și trafic" description={`${name}, pe zi.`} action={more(href, 'SEO și Search')}>
      {trends.status === 'loading' ? (
        skeleton('Se încarcă evoluția clickurilor', 'h-[72px]')
      ) : trends.status === 'failed' ? (
        <ProviderProblem result={{ kind: 'error', message: trends.message }} onRetry={onRetryTrends} />
      ) : !series || series.points.every((p) => p.value === null) ? (
        <p className="rounded-lg border border-dashed border-border-strong px-3 py-4 text-center text-[12.5px] leading-snug text-text-2">
          <strong className="block font-semibold text-text">{series && !trendReason(series.status) ? 'Fără date pentru interval' : 'Sursă neconectată'}</strong>
          {series ? (trendReason(series.status) ?? 'Nu există observații în perioada selectată.') : 'Seria nu a venit de la server pentru acest interval.'}
        </p>
      ) : (
        <div>
          <Sparkline label={`Evoluție: ${name}`} values={series.points.map((p) => p.value)} />
          <div aria-hidden="true" className="mt-1 flex justify-between font-mono text-[11px] text-text-3">
            <span>{formatDayMonth(series.points[0]!.date)}</span>
            <span>{formatDayMonth(series.points[series.points.length - 1]!.date)}</span>
          </div>
        </div>
      )}
      {metrics.status === 'loading' ? (
        skeleton('Se încarcă indicatorii SEO și trafic', 'h-24')
      ) : metrics.status === 'failed' ? (
        <ProviderProblem result={{ kind: 'error', message: metrics.message }} onRetry={onRetry} />
      ) : (
        <dl>
          <Row label="Keywords în Top 10" item={item('seomonitor_keywords_top10')} definition={definitions.get('seomonitor_keywords_top10')} />
          <Row label="CTR (Search Console)" item={item('gsc_ctr')} definition={definitions.get('gsc_ctr')} />
          <Row label="Sesiuni" item={item('ga4_sessions')} definition={definitions.get('ga4_sessions')} />
        </dl>
      )}
    </Card>
  )
}

// Culorile din machetă: pozitivul pe accent, neutrul gri, negativul pe violet. Eticheta scrisă poartă sensul, nu culoarea.
const SENTIMENT = [
  { key: 'positive', label: 'Pozitiv', color: 'var(--accent)' },
  { key: 'neutral', label: 'Neutru', color: 'var(--text-3)' },
  { key: 'negative', label: 'Negativ', color: 'var(--lav)' },
] as const

/** Inel cu distribuția sentimentului. Arcele folosesc ponderile venite de la server; fără revizuiri, inelul rămâne gol. */
function Donut({ shares, center, caption }: { shares: SentimentDistribution['shares']; center: string; caption: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg viewBox="0 0 110 110" role="img" aria-label={`${center} ${caption}`} className="size-[110px] flex-none">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--neutral-soft)" strokeWidth="11" />
      {SENTIMENT.map((s) => {
        const share = shares[s.key]
        if (share === null || share <= 0) return null
        const len = (share / 100) * c
        const el = <circle key={s.key} cx="55" cy="55" r={r} fill="none" stroke={s.color} strokeWidth="11" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 55 55)" />
        offset += len
        return el
      })}
      <text x="55" y="53" textAnchor="middle" className="fill-[var(--text)] font-display text-[17px] font-semibold">{center}</text>
      <text x="55" y="68" textAnchor="middle" className="fill-[var(--text-2)] text-[9px]">{caption}</text>
    </svg>
  )
}

export function ListeningCard({ sentiment, mentions, onRetry, href }: { sentiment: AsyncState<ProviderResult<SentimentDistribution>>; mentions: MetricItem | null; onRetry: () => void; href: string }) {
  const period = mentions ? metricView(mentions) : null
  let body
  if (sentiment.status === 'loading') body = skeleton('Se încarcă sentimentul')
  else if (sentiment.status === 'failed') body = <ProviderProblem result={{ kind: 'error', message: sentiment.message }} onRetry={onRetry} />
  else if (sentiment.value.kind !== 'ready') body = <ProviderProblem result={sentiment.value} onRetry={onRetry} />
  else {
    const s = sentiment.value.data
    body = (
      <>
        <div className="flex items-center gap-4">
          <Donut shares={s.shares} center={formatInteger(s.total)} caption="revizuite" />
          <ul aria-label="Sentiment, din mențiunile revizuite" className="flex min-w-0 flex-1 flex-col gap-1.5 text-[13px]">
            {SENTIMENT.map((x) => (
              <li key={x.key} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 flex-none rounded-full" style={{ background: x.color }} />
                <span className="flex-1">{x.label}</span>
                <span className="tabular-nums font-semibold">{s.shares[x.key] === null ? <span className="font-normal text-text-3">Fără date</span> : formatMetricValue(s.shares[x.key], 'percent')}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] leading-snug text-text-2">
          {s.total === 0 ? 'Nicio mențiune revizuită încă: sentimentul apare doar după revizuirea echipei.' : `Din ${formatInteger(s.total)} mențiuni revizuite de echipă.`}
          {s.unreviewed > 0 && ` ${formatInteger(s.unreviewed)} nerevizuite.`}
          {period?.hasValue && ` Mențiuni în perioadă: ${period.valueText}.`}
        </p>
      </>
    )
  }
  return (
    <Card id="social-listening" title="Social listening" description="Mențiunile perioadei și sentimentul lor, după revizuirea umană." action={more(href, 'Mention feed')}>
      {body}
    </Card>
  )
}

export function CompetitorsCard({ matrix, onRetry, href }: { matrix: AsyncState<ProviderResult<CompetitionMatrix>>; onRetry: () => void; href: string }) {
  let body
  let description = 'Brandul și competitorii din setul în vigoare.'
  if (matrix.status === 'loading') body = skeleton('Se încarcă poziția față de competitori')
  else if (matrix.status === 'failed') body = <ProviderProblem result={{ kind: 'error', message: matrix.message }} onRetry={onRetry} />
  else if (matrix.value.kind !== 'ready') body = <ProviderProblem result={matrix.value} onRetry={onRetry} />
  else {
    const m = matrix.value.data
    const row = positionRows(m).find((p) => p.dimension === 'ai')?.row
    if (!row) body = <p className="text-[13px] text-text-2">Matricea de Concurență nu are un indicator AI pentru acest brand.</p>
    else {
      description = `Brand / ${row.label}. Ce sursa nu oferă rămâne N/A, nu zero.`
      const rows = m.entities.map((e) => ({ e, cell: row.cells[e.id] })).sort((a, b) => (b.cell?.value ?? -1) - (a.cell?.value ?? -1))
      body = (
        <ul aria-label={`Competitori după ${row.label}`} className="flex flex-col gap-0.5">
          {rows.map(({ e, cell }) => {
            const value = cell?.value ?? null
            return <Bar key={e.id} label={e.name} highlight={e.kind === 'brand'} pct={cell?.unit === 'percent' ? value : null} text={value === null ? 'N/A' : (formatMetricValue(value, cell!.unit) ?? 'N/A')} />
          })}
        </ul>
      )
    }
  }
  return (
    <Card id="competitors" title="Competitori" description={description} action={more(href, 'Toată comparația')}>
      {body}
    </Card>
  )
}
