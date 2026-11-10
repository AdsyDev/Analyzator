import type { EvidenceQuery, Insight, MetricDefinition, MetricsBundle, ProviderResult } from '../../contracts'
import { StatusChip, type ChipTone } from '../../components/ui/Chip'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatMetricValue, formatRange } from '../../lib/format'
import { metricView } from '../../lib/metricView'
import { sourceName } from '../../lib/sources'
import { Section } from '../shared/Section'
import { MIN_SIGNAL_PERCENT, changeSignals, type ChangeSignal } from './changes'
import { latestPublished, opportunitiesFrom } from './InsightSections'

interface Props {
  metrics: AsyncState<MetricsBundle>
  definitions: Map<string, MetricDefinition>
  insights: AsyncState<ProviderResult<Insight[]>>
  onOpenMetric: (signal: ChangeSignal) => void
  onOpenEvidence: (q: EvidenceQuery, label: string) => void
}

function Card({ kind, tone, title, rows, confirmation, action, empty }: { kind: string; tone: ChipTone; title: string | null; rows?: Array<[string, React.ReactNode]>; confirmation?: { label: string; tone: ChipTone }; action?: React.ReactNode; empty?: string }) {
  return (
    <li aria-label={kind} className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface-2 p-4">
      <div>
        <StatusChip tone={tone}>{kind}</StatusChip>
      </div>
      {title === null ? (
        <p className="text-[13px] leading-snug text-text-2">{empty}</p>
      ) : (
        <>
          <h3 className="font-display text-[14.5px] font-semibold leading-snug">{title}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
            {(rows ?? []).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-text-3">{k}</dt>
                <dd className="text-text">{v}</dd>
              </div>
            ))}
            {confirmation && (
              <div className="contents">
                <dt className="text-text-3">Confirmare</dt>
                <dd>
                  <StatusChip tone={confirmation.tone}>{confirmation.label}</StatusChip>
                </dd>
              </div>
            )}
          </dl>
          {action && <div className="mt-auto pt-1">{action}</div>}
        </>
      )}
    </li>
  )
}

const linkCls = 'text-[13px] font-medium text-accent-text hover:underline'

function signalCard(kind: 'Oportunitate' | 'Risc', s: ChangeSignal | null, onOpen: (s: ChangeSignal) => void, loading: boolean) {
  const tone: ChipTone = kind === 'Oportunitate' ? 'pos' : 'neg'
  if (!s) {
    return (
      <Card
        key={kind}
        kind={kind}
        tone={tone}
        title={null}
        empty={loading ? 'Se încarcă indicatorii…' : `Niciun indicator principal nu are o variație ${kind === 'Oportunitate' ? 'favorabilă' : 'nefavorabilă'} de cel puțin ${MIN_SIGNAL_PERCENT} % în acest interval.`}
      />
    )
  }
  const v = metricView(s.item)
  const cmp = s.item.evidence_query.comparison_period
  const before = s.item.comparison_value === null ? null : formatMetricValue(s.item.comparison_value, s.item.unit, s.item.currency)
  return (
    <Card
      key={kind}
      kind={kind}
      tone={tone}
      title={`${s.definition.label}: ${v.deltaText ?? ''}`.trim()}
      rows={[
        ['Mărime', before ? `${before} → ${v.valueText}` : (v.valueText ?? '—')],
        ['Sursă', s.item.source ? sourceName(s.item.source) : '—'],
        ['Perioadă', <span className="font-mono text-[12px]">{formatRange(s.item.evidence_query.period.start, s.item.evidence_query.period.end)}</span>],
        ...(cmp ? ([['Față de', <span className="font-mono text-[12px]">{formatRange(cmp.start, cmp.end)}</span>]] as Array<[string, React.ReactNode]>) : []),
      ]}
      confirmation={{ label: s.item.status === 'ok' ? 'Semnal automat, neconfirmat' : 'Semnal automat, pe date parțiale', tone: 'warn' }}
      action={
        <button type="button" className={linkCls} onClick={() => onOpen(s)}>
          Vezi dovada
        </button>
      }
    />
  )
}

/**
 * „Ce s-a schimbat" (propunerea din 10 nov. 2026): o oportunitate, un risc și o decizie. Primele două sunt semnale
 * automate alese dintre indicatorii principali (`changeSignals`) și poartă eticheta „neconfirmat"; decizia vine din
 * ultima analiză publicată de echipă. Fiecare card arată mărimea, sursa, perioada și nivelul de confirmare.
 */
export function ChangesSection({ metrics, definitions, insights, onOpenMetric, onOpenEvidence }: Props) {
  const loading = metrics.status === 'loading'
  const signals = metrics.status === 'done' ? changeSignals(metrics.value.items, definitions) : { opportunity: null, risk: null }

  const latest = insights.status === 'done' && insights.value.kind === 'ready' ? latestPublished(insights.value.data) : null
  const next = opportunitiesFrom(latest)[0] ?? null
  const evidence = latest?.evidence[0] ?? null
  const decision =
    latest && next ? (
      <Card
        kind="Decizie"
        tone="accent"
        title={next.title}
        rows={[
          ['Responsabil', next.owner.name],
          ['Termen', next.due ? <span className="font-mono text-[12px]">{formatDate(next.due)}</span> : 'nesetat'],
          ['Sursă', `Analiza „${latest.title}”`],
        ]}
        confirmation={{ label: 'Din analiza publicată de AdSymphony', tone: 'pos' }}
        action={
          evidence ? (
            <button type="button" className={linkCls} onClick={() => onOpenEvidence(evidence.evidence_query, evidence.label)}>
              Vezi dovada
            </button>
          ) : undefined
        }
      />
    ) : (
      <Card kind="Decizie" tone="accent" title={null} empty={insights.status === 'loading' ? 'Se încarcă analizele…' : 'Nicio acțiune deschisă în ultima analiză publicată.'} />
    )

  return (
    <Section id="changes" title="Ce s-a schimbat" description="Trei semnale: cea mai mare variație favorabilă, cea mai mare variație nefavorabilă și următoarea decizie din analiza echipei. Semnalele automate nu sunt concluzii.">
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {signalCard('Oportunitate', signals.opportunity, onOpenMetric, loading)}
        {signalCard('Risc', signals.risk, onOpenMetric, loading)}
        {decision}
      </ul>
    </Section>
  )
}
