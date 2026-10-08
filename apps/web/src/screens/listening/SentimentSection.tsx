import type { ProviderResult, Sentiment, SentimentDistribution } from '../../contracts'
import { EmptyState } from '../../components/EmptyState'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { SENTIMENT_LABELS } from './labels'

const ORDER: Sentiment[] = ['positive', 'neutral', 'negative']

/**
 * Distribuția sentimentului. Doar mențiunile revizuite de un om intră în total și în procente; cele nerevizuite
 * se numără separat și nu se presupun neutre. Procentele vin calculate de provider.
 */
export function SentimentSection({ state, onRetry }: { state: AsyncState<ProviderResult<SentimentDistribution>>; onRetry: () => void }) {
  return (
    <Section id="sentiment" title="Distribuția sentimentului" description="Fiecare sentiment e verificat de un om din echipa AdSymphony; mențiunile încă nerevizuite nu sunt incluse în procente.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă distribuția" skeletonClass="h-28">
        {(d) =>
          d.total === 0 ? (
            <EmptyState compact title="Nicio mențiune revizuită" text={d.unreviewed > 0 ? `${d.unreviewed} mențiuni așteaptă revizuirea umană; până atunci nu afișăm o distribuție.` : 'Nu există mențiuni eligibile în perioada aleasă.'} />
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-text-2">
                <span className="font-display text-[22px] font-semibold text-text tabular-nums">{formatInteger(d.total)}</span> mențiuni revizuite
              </p>
              <div role="img" aria-label={`Distribuția sentimentului: ${ORDER.map((s) => `${SENTIMENT_LABELS[s].label} ${formatMetricValue(d.shares[s], 'percent') ?? 'fără date'}`).join(', ')}`} className="flex h-3 overflow-hidden rounded-full bg-neutral-soft">
                {ORDER.map((s) => (d.shares[s] ? <span key={s} className={SENTIMENT_LABELS[s].bar} style={{ width: `${d.shares[s]}%` }} /> : null))}
              </div>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ORDER.map((s) => (
                  <li key={s} className="flex items-center gap-2 text-[13px]">
                    <span aria-hidden="true" className={`size-2.5 flex-none rounded-full ${SENTIMENT_LABELS[s].bar}`} />
                    <span className="font-medium">{SENTIMENT_LABELS[s].label}</span>
                    <span className="flex-1" />
                    <span className="tabular-nums text-text-2">{formatInteger(d[s])}</span>
                    <span className="w-14 text-right font-semibold tabular-nums">{formatMetricValue(d.shares[s], 'percent') ?? 'Fără date'}</span>
                  </li>
                ))}
              </ul>
              {d.unreviewed > 0 && (
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] leading-snug text-warn-text">
                  {formatInteger(d.unreviewed)} {d.unreviewed === 1 ? 'mențiune așteaptă' : 'mențiuni așteaptă'} revizuirea umană și nu {d.unreviewed === 1 ? 'e inclusă' : 'sunt incluse'} în procente.
                </p>
              )}
            </div>
          )
        }
      </Resolved>
    </Section>
  )
}
