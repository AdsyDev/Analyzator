import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { useAsync } from '../../data/useAsync'

const norm = (s: string) => s.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')

/**
 * Campaniile pe care le vede tokenul SEOmonitor al clientului (doar citire): confirmă cheia și arată campania
 * domeniului site-ului. Maparea grupurilor pe site rămâne în Configurare (versiuni, branded / nonbranded).
 */
export function SeomonitorCampaigns({ tenantConnectionId, siteDomain }: { tenantConnectionId: string; siteDomain: string | null }) {
  const providers = useProviders()
  // Fără reîncărcarea paginii după listare: ar remonta cardul și ar cere lista din nou.
  const list = useAsync(() => providers.sources.listAccounts(tenantConnectionId, 'seomonitor'), [providers, tenantConnectionId])

  if (list.state.status === 'loading') return <div role="status" aria-label="Se încarcă campaniile SEOmonitor" className="h-16 w-full rounded-lg bg-skeleton" />
  const r = list.state.status === 'done' ? list.state.value : null
  const problem = list.state.status === 'failed' ? list.state.message : r && r.kind !== 'ready' ? (r.kind === 'error' ? r.message : r.reason) : r?.kind === 'ready' && r.data.outcome !== 'ok' ? r.data.message : null
  if (problem || !r || r.kind !== 'ready') {
    return (
      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn-text">
        <span role="alert" className="flex-1">{problem ?? 'Campaniile nu au putut fi citite.'}</span>
        <Button variant="ghost" icon={<ArrowClockwiseIcon size={12} aria-hidden="true" />} onClick={list.reload}>Reîncarcă</Button>
      </div>
    )
  }
  const campaigns = r.data.accounts
  const domain = siteDomain ? norm(siteDomain) : null
  if (campaigns.length === 0) return <p className="text-[12.5px] text-text-2">Tokenul funcționează, dar nu vede nicio campanie urmărită în SEOmonitor.</p>
  return (
    <section aria-label="Campaniile SEOmonitor ale clientului" className="flex w-full flex-col gap-1.5">
      <span className="text-[12px] text-text-3">Tokenul funcționează și vede {campaigns.length === 1 ? 'o campanie' : `${campaigns.length} campanii`}:</span>
      <ul className="flex flex-col gap-1">
        {campaigns.map((c) => {
          const match = domain !== null && c.detail !== null && norm(c.detail) === domain
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <span className="font-medium">{c.name}</span>
              {c.detail && <span className="font-mono text-[12px] text-text-2">{c.detail}</span>}
              <span className="font-mono text-[11.5px] text-text-3">#{c.id}</span>
              {match && <StatusChip tone="accent">Domeniul site-ului</StatusChip>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
