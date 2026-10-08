import type { ProviderResult, SocialCompetitor } from '../../contracts'
import type { AsyncState } from '../../data/useAsync'
import { formatDate, formatInteger } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const dash = <span className="text-text-3">Fără date</span>

/** Concurența publică: doar date publice (cadence, followers, interacțiuni); fără reach privat al competitorului. */
export function CompetitorsSection({ state, onRetry }: { state: AsyncState<ProviderResult<SocialCompetitor[]>>; onRetry: () => void }) {
  return (
    <Section id="competitors" title="Concurență publică" description="Date publice ale competitorilor: ritm de publicare, followers și interacțiuni pe postare. Reach-ul competitorilor nu e public și nu se estimează.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă concurența" skeletonClass="h-36">
        {(rows) => (
          <div className="overflow-x-auto rounded-xl border border-border">
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
        )}
      </Resolved>
    </Section>
  )
}
