import type { ProviderResult, SocialCompetitor } from '../../contracts'
import { DataCard, DataCardList } from '../../components/ui/DataCard'
import { useIsPhone } from '../../components/ui/useIsPhone'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const dash = <span className="text-text-3">Fără date</span>

/** Concurența publică: doar date publice (cadence, followers, interacțiuni); fără reach privat al competitorului. */
export function CompetitorsSection({ state, onRetry }: { state: AsyncState<ProviderResult<SocialCompetitor[]>>; onRetry: () => void }) {
  const phone = useIsPhone()
  return (
    <Section id="competitors" title="Concurență publică" description="Date publice ale competitorilor: ritm de publicare, followers și interacțiuni pe postare. Reach-ul competitorilor nu e public și nu se estimează.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă concurența" skeletonClass="h-36">
        {(rows) =>
          phone ? (
            <DataCardList label="Concurența publică pe social">
              {rows.map((c) => (
                <DataCard
                  key={c.label}
                  title={
                    <>
                      {c.name} <span className="font-mono text-[11px] font-normal text-text-3">{c.label}</span>
                    </>
                  }
                  fields={[
                    { key: 'ppw', label: 'Postări / săpt.', value: c.posts_per_week === null ? dash : c.posts_per_week.toLocaleString('ro-RO') },
                    { key: 'followers', label: 'Followers', value: c.followers === null ? dash : formatInteger(c.followers) },
                    { key: 'ipp', label: 'Interacțiuni / postare', value: c.public_interactions_per_post === null ? dash : formatInteger(c.public_interactions_per_post) },
                    { key: 'asof', label: 'La data', value: c.as_of ? <span className="font-mono text-[12px]">{formatDate(c.as_of)}</span> : <span className="text-text-3">—</span> },
                  ]}
                />
              ))}
            </DataCardList>
          ) : (
            <div className="scroll-x relative rounded-xl border border-border">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">Concurența publică pe social</caption>
                <thead>
                  <tr className="bg-surface-2 text-left text-text-2">
                    <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">Competitor</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Postări / săpt.</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Followers</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Interacțiuni / postare</th>
                    <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">La data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.label} className="border-t border-border">
                      <th scope="row" className="px-4 py-2.5 text-left font-medium">{c.name} <span className="font-mono text-[11px] font-normal text-text-3">{c.label}</span></th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.posts_per_week === null ? dash : c.posts_per_week.toLocaleString('ro-RO')}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.followers === null ? dash : formatInteger(c.followers)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.public_interactions_per_post === null ? dash : formatInteger(c.public_interactions_per_post)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px]">{c.as_of ? formatDate(c.as_of) : <span className="text-text-3">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Resolved>
    </Section>
  )
}
