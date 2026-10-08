import type { PaidPlatform, PaidRow, ProviderResult } from '../../contracts'
import { SortableTable, type Column } from '../../components/ui/SortableTable'
import type { AsyncState } from '../../data/useAsync'
import { formatCurrency, formatDate, formatInteger, formatMetricValue } from '../../lib/format'
import { Resolved } from '../shared/Resolved'
import { Section } from '../shared/Section'

const PLATFORM: Record<PaidPlatform, string> = { google_ads: 'Google Ads', meta_ads: 'Meta Ads' }
const dash = <span className="text-text-3">Fără date</span>
const n = (v: number | null) => (v === null ? dash : formatInteger(v))

function columns(currency: string): Column<PaidRow>[] {
  return [
    { key: 'date', header: 'Data', sortValue: (r) => r.date, render: (r) => <span className="font-mono text-[12px]">{formatDate(r.date)}</span> },
    { key: 'platform', header: 'Platformă', sortValue: (r) => r.platform, render: (r) => PLATFORM[r.platform] },
    { key: 'account', header: 'Cont', sortValue: (r) => r.account, render: (r) => r.account },
    { key: 'campaign', header: 'Campanie', sortValue: (r) => r.campaign, render: (r) => <span className="font-medium">{r.campaign}</span> },
    { key: 'objective', header: 'Obiectiv', sortValue: (r) => r.objective, render: (r) => r.objective ?? dash },
    { key: 'spend', header: `Spend (${currency})`, align: 'right', sortValue: (r) => r.spend, render: (r) => formatCurrency(r.spend, currency, 2) ?? dash },
    { key: 'impressions', header: 'Impressions', align: 'right', sortValue: (r) => r.impressions, render: (r) => n(r.impressions) },
    { key: 'clicks', header: 'Clicks', align: 'right', sortValue: (r) => r.clicks, render: (r) => n(r.clicks) },
    { key: 'ctr', header: 'CTR', align: 'right', sortValue: (r) => r.ctr, render: (r) => formatMetricValue(r.ctr, 'percent') ?? dash },
    { key: 'cpc', header: 'CPC', align: 'right', sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc, currency, 2) ?? dash },
    { key: 'conversions', header: 'Conversii', align: 'right', sortValue: (r) => r.conversions, render: (r) => (r.conversions === null ? <span className="text-text-3" title="Campania nu raportează conversii">N/A</span> : formatInteger(r.conversions)) },
    { key: 'cpa', header: 'CPA', align: 'right', sortValue: (r) => r.cpa, render: (r) => (r.cpa === null ? <span className="text-text-3" title="Nu e relevant sau nu există conversii">N/A</span> : formatCurrency(r.cpa, currency, 2)) },
    { key: 'window', header: 'Atribuire', sortValue: (r) => r.attribution_window, render: (r) => <span className="text-[12px] text-text-2">{r.attribution_window ?? 'Necunoscută'}</span> },
  ]
}

/** Performance table: câte un rând pe zi, platformă, cont și campanie. Fără galerie de creatives. */
export function PaidTable({ state, currency, onRetry }: { state: AsyncState<ProviderResult<PaidRow[]>>; currency: string; onRetry: () => void }) {
  return (
    <Section id="performance" title="Performanță pe zi" description="Câte un rând pe zi, platformă, cont și campanie, în moneda și fusul orar ale exportului. N/A înseamnă că metrica nu se aplică campaniei, nu zero.">
      <Resolved state={state} onRetry={onRetry} loadingLabel="Se încarcă tabelul" skeletonClass="h-72">
        {(rows) => <SortableTable caption="Performanță Paid Media pe zi, platformă, cont și campanie" columns={columns(currency)} rows={rows} rowKey={(r) => `${r.date}|${r.platform}|${r.account}|${r.campaign}`} pageSize={12} emptyText="Niciun rând importat pentru filtrele și perioada alese." />}
      </Resolved>
    </Section>
  )
}
