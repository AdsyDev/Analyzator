import type { Brand, Insight, MetricDefinition, MetricItem, QueryContext } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { useProviders } from '../../data/DataProvidersContext'
import { ctxKey, useDefinitions, useMetrics } from '../../data/hooks'
import { useAsync } from '../../data/useAsync'
import { csvFileName, downloadCsv, toCsv } from '../../lib/csv'
import { formatDate, formatDateTime, formatRange } from '../../lib/format'
import { metricView } from '../../lib/metricView'
import { comparisonRange } from '../../lib/period'
import { useLayout } from '../../routing/AppLayout'
import { ProviderProblem } from '../../routing/pages'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { REPORT_GROUPS, REPORT_KEYS } from './slots'

/**
 * Rapoarte (Etapa 3, K-2): raportul perioadei alese, gata de tipărit sau de salvat ca PDF din browser, și exportul
 * indicatorilor în CSV. Pagina nu calculează nimic: arată aceleași valori ca restul aplicației, din aceleași RPC-uri.
 */
export function ReportsPage() {
  const { brand, ctx } = useLayout()
  if (!brand || !ctx) return null
  return <Report brand={brand} ctx={ctx} />
}

const stateText = (m: MetricItem): string => {
  const v = metricView(m)
  return v.hasValue ? (v.caveat ?? 'Complet') : [v.emptyTitle, v.emptyReason].filter(Boolean).join(': ')
}

function Report({ brand, ctx }: { brand: Brand; ctx: QueryContext }) {
  const providers = useProviders()
  const metrics = useMetrics(ctx, REPORT_KEYS)
  const { byKey } = useDefinitions(REPORT_KEYS)
  const insights = useAsync(() => providers.insights.list(ctx), [providers, ctxKey(ctx)])
  const cmp = comparisonRange(ctx.period, ctx.comparison)
  const nameOf = (key: string) => byKey.get(key)?.label ?? key
  const items = metrics.state.status === 'done' ? metrics.state.value.items : null

  function exportIndicators() {
    if (!items) return
    const rows = REPORT_GROUPS.flatMap((g) =>
      g.keys.map((key) => {
        const m = items.find((i) => i.metric_key === key)
        return [g.title, nameOf(key), key, m?.value ?? null, m?.unit ?? null, m?.currency ?? null, m?.comparison_value ?? null, m?.absolute_change ?? null, m?.relative_change ?? null, m?.status ?? 'not_connected']
      }),
    )
    downloadCsv(
      csvFileName('indicatori', brand.name, ctx.period.from, ctx.period.to),
      toCsv(['Grup', 'Indicator', 'Cheie', 'Valoare', 'Unitate', 'Monedă', 'Valoare de comparație', 'Variație absolută', 'Variație relativă (%)', 'Stare'], rows),
    )
  }

  return (
    <article aria-label="Raport de perioadă" className="flex flex-col gap-5">
      <section aria-label="Antetul raportului" className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-surface p-4 shadow-1 sm:p-5">
        <dl className="grid min-w-0 flex-1 basis-72 grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-text-2">Brand</dt>
          <dd className="font-semibold">{brand.name}{brand.tenant_name ? ` · ${brand.tenant_name}` : ''}</dd>
          <dt className="text-text-2">Perioadă</dt>
          <dd className="font-mono text-[12.5px]">{formatRange(ctx.period.from, ctx.period.to)}</dd>
          <dt className="text-text-2">Comparată cu</dt>
          <dd className="font-mono text-[12.5px]">{formatRange(cmp.from, cmp.to)}{ctx.comparison === 'year_ago' ? ' (anul trecut)' : ' (perioada anterioară)'}</dd>
          <dt className="text-text-2">Generat la</dt>
          <dd className="font-mono text-[12.5px]">{formatDateTime(new Date().toISOString())}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="primary" onClick={() => window.print()}>Tipărește sau salvează ca PDF</Button>
          <Button variant="secondary" onClick={exportIndicators} disabled={!items}>Exportă indicatorii (CSV)</Button>
        </div>
      </section>

      <Section id="report-indicators" title="Indicatori" description="Aceleași valori ca în modulele aplicației, pentru perioada aleasă. O valoare lipsă e explicată, nu înlocuită cu zero.">
        {metrics.state.status === 'loading' ? (
          <div role="status" aria-label="Se încarcă indicatorii" className="h-64 rounded-xl bg-skeleton" />
        ) : metrics.state.status === 'failed' ? (
          <ProviderProblem result={{ kind: 'error', message: metrics.state.message }} onRetry={metrics.reload} />
        ) : (
          <div className="flex flex-col gap-5">
            {REPORT_GROUPS.map((g) => (
              <IndicatorTable key={g.id} title={g.title} keys={g.keys} items={metrics.state.status === 'done' ? metrics.state.value.items : []} byKey={byKey} />
            ))}
          </div>
        )}
      </Section>

      <Section id="report-insights" title="Analize publicate" description="Interpretările echipei AdSymphony pentru perioada aleasă, cu recomandările și acțiunile lor.">
        <Resolved state={insights.state} onRetry={insights.reload} loadingLabel="Se încarcă analizele" skeletonClass="h-40">
          {(list) => {
            const published = list.filter((i) => i.status === 'published')
            return published.length === 0 ? (
              <p className="text-[13px] text-text-2">Nicio analiză publicată pentru perioada aleasă.</p>
            ) : (
              <div className="flex flex-col gap-5">
                {published.map((i) => (
                  <InsightBlock key={i.id} insight={i} />
                ))}
              </div>
            )
          }}
        </Resolved>
      </Section>
    </article>
  )
}

function IndicatorTable({ title, keys, items, byKey }: { title: string; keys: readonly string[]; items: MetricItem[]; byKey: Map<string, MetricDefinition> }) {
  return (
    <div className="break-inside-avoid overflow-hidden rounded-xl border border-border">
      {/* Lățimi fixe: coloanele stau aliniate de la un grup la altul, pe ecran și la tipărire. */}
      <table className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[13%]" />
          <col className="w-[13%]" />
          <col />
        </colgroup>
        <caption className="border-b border-border bg-surface-2 px-4 py-2 text-left text-[12.5px] font-semibold">{title}</caption>
        <thead>
          <tr className="border-b border-border text-[12px] text-text-2">
            <th scope="col" className="px-4 py-2 text-left font-semibold">Indicator</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Valoare</th>
            <th scope="col" className="px-4 py-2 text-right font-semibold">Variație</th>
            <th scope="col" className="px-4 py-2 text-left font-semibold">Stare</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const m = items.find((i) => i.metric_key === key)
            const v = m ? metricView(m) : null
            return (
              <tr key={key} className="border-b border-border last:border-b-0" data-status={m?.status ?? 'not_connected'}>
                <th scope="row" className="px-4 py-2 text-left font-medium">{byKey.get(key)?.label ?? key}</th>
                <td className="px-4 py-2 text-right tabular-nums">{v?.hasValue ? v.valueText : <span className="text-text-3">Fără date</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{v?.deltaText ?? <span className="text-text-3">N/A</span>}</td>
                <td className="px-4 py-2 text-[12.5px] text-text-2">{m ? stateText(m) : 'Sursă neconectată'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const STAGE: Record<string, string> = { open: 'Deschisă', in_progress: 'În lucru', done: 'Încheiată', cancelled: 'Anulată' }

function InsightBlock({ insight: i }: { insight: Insight }) {
  return (
    <div className="flex break-inside-avoid flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
      <h3 className="font-display text-[15px] font-semibold">{i.title}</h3>
      <p className="text-[12px] text-text-2">
        Perioada <span className="font-mono text-[11.5px] text-text">{formatRange(i.period.from, i.period.to)}</span>
        {i.published_at && <> · publicată la <span className="font-mono text-[11.5px] text-text">{formatDate(i.published_at.slice(0, 10))}</span></>}
        {' · '}{i.author.name}
      </p>
      <p className="text-[13.5px] leading-relaxed">{i.summary}</p>
      {i.interpretation && i.interpretation !== i.summary && <p className="text-[13.5px] leading-relaxed"><strong className="font-semibold">Interpretare. </strong>{i.interpretation}</p>}
      {i.limits && <p className="text-[12.5px] leading-snug text-text-2"><strong className="font-semibold text-text">Limite. </strong>{i.limits}</p>}
      {(i.recommendations?.length ?? 0) > 0 && (
        <div>
          <h4 className="text-[12.5px] font-semibold">Recomandări</h4>
          <ol className="mt-1 list-decimal pl-5 text-[13px] leading-relaxed">
            {i.recommendations!.map((r) => (
              <li key={r.id}>{r.action} <span className="text-text-2">({r.problem}; așteptat: {r.expected_benefit})</span></li>
            ))}
          </ol>
        </div>
      )}
      {i.actions.length > 0 && (
        <div>
          <h4 className="text-[12.5px] font-semibold">Acțiuni</h4>
          <ul className="mt-1 list-disc pl-5 text-[13px] leading-relaxed">
            {i.actions.map((a) => (
              <li key={a.id}>
                {a.title} <span className="text-text-2">· {STAGE[a.status] ?? a.status} · {a.owner.name}{a.due ? ` · termen ${formatDate(a.due)}` : ''}{a.effort ? ` · efort ${a.effort}` : ''}{a.tracked_metric ? ` · urmărim ${a.tracked_metric.label}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
