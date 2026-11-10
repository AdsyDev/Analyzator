import { Link } from 'react-router-dom'
import type { QueryContext } from '../../contracts'
import { ComparisonTable, type ComparisonGroup } from '../../components/ComparisonTable'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { ProviderProblem } from '../../routing/pages'
import { toComparison } from '../competition/CompetitionPage'
import { Section } from '../shared/Section'
import { positionRows } from './position'

interface Props {
  ctx: QueryContext
  fullHref: string
}

/**
 * „Poziția față de competitori" (propunerea din 10 nov. 2026): brandul și competitorii validați pe AI, SEO și
 * conversații, din aceeași matrice ca pagina Concurență (`brand_competition`), deci cu aceleași definiții și aceeași
 * perioadă. Locul în set se afișează separat pe fiecare dimensiune; nu există un scor general. Ce sursa nu oferă
 * rămâne N/A, nu zero.
 */
export function CompetitorSection({ ctx, fullHref }: Props) {
  const providers = useProviders()
  const matrix = useAsync(() => providers.competition.matrix(ctx), [providers, ctxKey(ctx)])
  const link = (
    <Link to={fullHref} className="text-[13px] font-medium text-accent-text hover:underline">
      Toată comparația
    </Link>
  )

  let body
  if (matrix.state.status === 'loading') {
    body = <ComparisonTable caption="Poziția față de competitori" columns={[]} groups={[]} loading />
  } else if (matrix.state.status === 'failed') {
    body = <ProviderProblem result={{ kind: 'error', message: matrix.state.message }} onRetry={matrix.reload} />
  } else if (matrix.state.value.kind !== 'ready') {
    body = <ProviderProblem result={matrix.state.value} onRetry={matrix.reload} />
  } else {
    const m = matrix.state.value.data
    const rows = positionRows(m)
    const { columns } = toComparison(m)
    const groups: ComparisonGroup[] = rows.map((r) => ({ name: r.title, source: r.source ?? undefined, rows: [{ key: r.row.key, label: r.row.label, definition: r.row.definition, direction: r.row.direction, cells: r.row.cells }] }))
    body = (
      <>
        <ComparisonTable caption="Poziția față de competitori" columns={columns} groups={groups} setVersion={m.set_version} effectiveFrom={m.effective_from} dataAsOf={m.data_as_of} />
        <ul aria-label="Locul în set, pe dimensiune" className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-text-2">
          {rows.map((r) => (
            <li key={r.dimension} title={r.rankReason ?? undefined}>
              <span className="font-semibold text-text">{r.title}</span>{' '}
              {r.rank ? (
                <>
                  locul <span className="font-mono text-[12px] text-text">{r.rank.place}</span> din <span className="font-mono text-[12px] text-text">{r.rank.of}</span>
                </>
              ) : (
                <span>fără clasament: {r.rankReason}</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[12px] leading-snug text-text-3">Locul se stabilește doar între entitățile cu valoare. Share of Voice în panel nu este cotă de piață.</p>
      </>
    )
  }

  return (
    <Section id="competitors" title="Poziția față de competitori" action={link}>
      {body}
    </Section>
  )
}
