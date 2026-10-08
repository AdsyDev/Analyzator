import { Link } from 'react-router-dom'
import type { Brand, CompetitorSet, MetricItem, QueryContext } from '../../contracts'
import { ComparisonTable, type ComparisonColumn, type ComparisonGroup } from '../../components/ComparisonTable'
import { useProviders } from '../../data/DataProvidersContext'
import { useDefinitions, useMetrics } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { ProviderProblem } from '../../routing/pages'
import { Section } from '../shared/Section'

/** Rândurile comparației: brandul vine din provider; competitorii nu au (încă) o sursă de date. */
const ROWS: Array<{ group: string; source?: string; key: string; label: string }> = [
  { group: 'AI', source: 'SEOmonitor', key: 'ai_mention_rate', label: 'AI Mention Rate' },
  { group: 'SEO', source: 'SEOmonitor', key: 'seomonitor_visibility_latest', label: 'Visibility SEOmonitor' },
  { group: 'Listening', key: 'listening_sov', label: 'Listening SoV' },
]
const KEYS = ROWS.map((r) => r.key)

const NO_COMPETITOR_DATA = 'Nu există încă o sursă de date pentru competitori; comparația apare când sursa e conectată.'

interface Props {
  brand: Brand
  ctx: QueryContext
  fullHref: string
}

export function CompetitorSection({ brand, ctx, fullHref }: Props) {
  const providers = useProviders()
  const set = useAsync(() => providers.brands.competitorSet(brand.id), [providers, brand.id])
  const metrics = useMetrics(ctx, KEYS)
  const { byKey } = useDefinitions(KEYS)
  const link = (
    <Link to={fullHref} className="text-[13px] font-medium text-accent-text hover:underline">
      Toată comparația
    </Link>
  )

  let body
  if (set.state.status === 'loading' || metrics.state.status === 'loading') {
    body = <ComparisonTable caption="Comparație cu competitorii" columns={[]} groups={[]} loading />
  } else if (set.state.status === 'failed') {
    body = <ProviderProblem result={{ kind: 'error', message: set.state.message }} onRetry={set.reload} />
  } else if (metrics.state.status === 'failed') {
    body = <ProviderProblem result={{ kind: 'error', message: metrics.state.message }} onRetry={metrics.reload} />
  } else if (set.state.value.kind !== 'ready') {
    body = <ProviderProblem result={set.state.value} onRetry={set.reload} />
  } else {
    const comp: CompetitorSet = set.state.value.data
    const items = metrics.state.status === 'done' ? metrics.state.value.items : []
    const columns: ComparisonColumn[] = [
      { key: 'brand', short: brand.name, full: brand.name, kind: 'brand' },
      ...comp.competitors.map<ComparisonColumn>((c) => ({ key: c.id, short: c.label, full: c.name, kind: 'competitor' })),
    ]
    const groups: ComparisonGroup[] = []
    for (const r of ROWS) {
      const item: MetricItem | undefined = items.find((i) => i.metric_key === r.key)
      if (!item) continue
      let g = groups.find((x) => x.name === r.group)
      if (!g) groups.push((g = { name: r.group, source: r.source, rows: [] }))
      g.rows.push({
        key: r.key,
        label: byKey.get(r.key)?.label ?? r.label,
        direction: byKey.get(r.key)?.direction,
        cells: { brand: item, ...Object.fromEntries(comp.competitors.map((c) => [c.id, { unavailable: NO_COMPETITOR_DATA }])) },
      })
    }
    const dates = items.map((i) => i.data_as_of).filter((d): d is string => !!d).sort()
    body = <ComparisonTable caption="Comparație cu competitorii" columns={columns} groups={groups} setVersion={comp.version} effectiveFrom={comp.effective_from} dataAsOf={dates[0] ?? null} />
  }

  return (
    <Section id="competitors" title="Comparație cu competitorii" action={link}>
      {body}
    </Section>
  )
}
