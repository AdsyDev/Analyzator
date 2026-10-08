import type { ProviderResult, SocialGroupStat, SocialGroups } from '../../contracts'
import type { AsyncState } from '../../data/useAsync'
import { formatInteger, formatRange } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'
import { FORMAT_LABELS } from './labels'
import type { SocialFormat } from '../../contracts'

function Table({ title, rows, label }: { title: string; rows: SocialGroupStat[]; label: (g: string) => string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr className="bg-surface-2 text-left text-text-2">
            <th scope="col" className="px-4 py-2.5 text-[12px] font-semibold">{title}</th>
            <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Postări / săpt.</th>
            <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">n</th>
            <th scope="col" className="px-3 py-2.5 text-right text-[12px] font-semibold">Mediană interacțiuni</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.group} className="border-t border-border">
              <th scope="row" className="px-4 py-2.5 text-left font-medium">{label(g.group)}</th>
              <td className="px-3 py-2.5 text-right tabular-nums">{g.posts_per_week === null ? <span className="text-text-3">Fără date</span> : g.posts_per_week.toLocaleString('ro-RO')}</td>
              <td className="px-3 py-2.5 text-right font-mono text-[12px]">{g.n}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">
                {g.median_interactions === null ? <span className="text-text-3" title="Nicio postare matură cu date de performanță">Fără date</span> : formatInteger(Math.round(g.median_interactions))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Topic și format: frecvență și mediană pe postare, cu n și perioada de observare (spec cap. 17). Doar postările mature intră în mediană. */
export function GroupsSection({ state, onRetry }: { state: AsyncState<ProviderResult<SocialGroups>>; onRetry: () => void }) {
  return (
    <Section id="groups" title="Topic și format" description="Frecvența și performanța mediană pe postare. Mediana include doar postările mature (cel puțin 7 zile) cu date de performanță; n e numărul lor.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă topicurile" skeletonClass="h-48">
        {(g) => (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Table title="Topic" rows={g.by_topic} label={(x) => x} />
              <Table title="Format" rows={g.by_format} label={(x) => FORMAT_LABELS[x as SocialFormat] ?? x} />
            </div>
            <p className="text-[12px] text-text-2">Perioada de observare: <span className="font-mono text-[11.5px] text-text">{formatRange(g.observed.from, g.observed.to)}</span>. Cu n mic, mediana e orientativă.</p>
          </div>
        )}
      </Resolved>
    </Section>
  )
}
