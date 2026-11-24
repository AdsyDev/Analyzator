import { useState } from 'react'
import type { AirbyteAccount, AirbyteInspection, Client, TenantConnection } from '../../contracts'
import { Button } from '../../components/ui/Button'
import { StatusChip } from '../../components/ui/Chip'
import { useProviders } from '../../data/DataProvidersContext'
import { proposeAirbyteMapping, type MappingProposal } from '../../lib/airbyteMapping'
import { formatRange } from '../../lib/format'

const PLATFORM: Record<string, string> = { meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads' }
const field = 'h-8 max-w-full rounded-[10px] border border-border-strong bg-surface px-2 text-[12.5px]'

type Loaded = { inspection: AirbyteInspection; proposal: MappingProposal<AirbyteAccount> }
type RowResult = { ok: true } | { ok: false; message: string }

/**
 * Maparea în bloc (E-8): conturile Meta, Google Ads și TikTok din Airbyte, propuse pe toate site-urile clientului după
 * nume și domeniu. Nimic nu se leagă fără „Leagă conturile alese”; fiecare legătură e o conexiune `airbyte` a site-ului,
 * la fel ca din formularul unui singur cont.
 */
export function AirbyteBulkMapping({ client, connection, onChanged }: { client: Client; connection: TenantConnection; onChanged: () => void }) {
  const providers = useProviders()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Loaded | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [results, setResults] = useState<Record<string, RowResult>>({})

  const siteName = (id: string) => client.spaces.find((s) => s.id === id)?.name ?? 'alt site'
  const active = client.spaces.filter((s) => s.status === 'active')

  async function load() {
    if (loading) return
    setLoading(true)
    setError(null)
    setResults({})
    const [inspection, ...conns] = await Promise.all([
      providers.sources.inspectAirbyte(connection.id),
      ...client.spaces.map((s) => providers.sources.connections(s.id)),
    ])
    setLoading(false)
    if (inspection!.kind !== 'ready') return setError(inspection!.kind === 'error' ? inspection!.message : inspection!.reason)
    if (inspection!.data.outcome !== 'ok') return setError(inspection!.data.message)
    const linkedTo = new Map<string, string>()
    for (const [i, r] of conns.entries()) {
      // Fără conexiunile unui site nu știm ce e legat deja: nu propunem nimic, ca să nu dublăm o legătură.
      if (r!.kind !== 'ready') return setError(`Conexiunile site-ului ${client.spaces[i]!.name} nu au putut fi citite. Încearcă din nou.`)
      for (const c of r!.data) if (c.provider === 'airbyte') linkedTo.set(c.external_account_id, c.brand_id)
    }
    const proposal = proposeAirbyteMapping(inspection!.data.accounts, client.spaces, client.name, linkedTo)
    setData({ inspection: inspection!.data, proposal })
    setChoice(Object.fromEntries(proposal.rows.filter((r) => r.proposed).map((r) => [r.account.id, r.proposed!])))
  }

  async function save() {
    if (!data || saving) return
    setSaving(true)
    const out: Record<string, RowResult> = {}
    for (const row of data.proposal.rows) {
      const brand = choice[row.account.id]
      if (!brand || results[row.account.id]?.ok) continue
      const r = await providers.sources.createConnection(brand, { provider: 'airbyte', external_account_id: row.account.id, display_name: row.account.name })
      out[row.account.id] = r.kind === 'ready' ? { ok: true } : { ok: false, message: r.kind === 'error' ? r.message : r.reason }
    }
    setResults((prev) => ({ ...prev, ...out }))
    setSaving(false)
    if (Object.values(out).some((r) => r.ok)) onChanged()
  }

  const pending = data ? data.proposal.rows.filter((r) => choice[r.account.id] && !results[r.account.id]?.ok).length : 0
  const done = Object.values(results).filter((r) => r.ok).length

  return (
    <section aria-label="Maparea conturilor Airbyte pe site-uri" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void load()} loading={loading}>{data ? 'Reia propunerea' : 'Propune conturile pentru toate site-urile'}</Button>
        <span className="text-[12px] text-text-2">
          Citește conturile din Airbyte (o inspecție din limita zilnică) și le propune pe site-urile lui {client.name}, după nume și domeniu. Tu confirmi.
        </span>
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {error && <p role="alert" className="text-[12.5px] text-neg-text">{error}</p>}
        {data && (
          <>
            <p className="text-[12.5px] text-text-2">
              {data.proposal.rows.length === 0
                ? 'Toate conturile văzute în Airbyte sunt deja legate de site-uri.'
                : `${data.proposal.rows.filter((r) => r.proposed).length} din ${data.proposal.rows.length} conturi nelegate au un site propus. Verifică și schimbă unde e cazul; „—” = nu se leagă.`}
              {data.proposal.linked.length > 0 && ` ${data.proposal.linked.length} ${data.proposal.linked.length === 1 ? 'cont e deja legat' : 'conturi sunt deja legate'}.`}
              {data.inspection.truncated && ' Inspecția nu a citit toate tabelele (limită de timp sau de tabele): pot lipsi conturi fără catalog de nume.'}
            </p>
            {data.proposal.rows.length > 0 && (
              <ul aria-label="Conturile nelegate" className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {data.proposal.rows.map((row) => {
                  const a = row.account
                  const result = results[a.id]
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-[12.5px]">
                      <span className="flex min-w-[14rem] flex-1 flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-[11.5px] text-text-3">
                          {PLATFORM[a.platform]} · ID <span className="font-mono">{a.account_id}</span>
                          {a.first_date && a.last_date ? ` · date ${formatRange(a.first_date, a.last_date)}` : ' · fără rapoarte citite'}
                        </span>
                      </span>
                      {row.candidates.length > 0 && !choice[a.id] && (
                        <StatusChip tone="warn">Ambiguu: {row.candidates.map(siteName).join(' sau ')}</StatusChip>
                      )}
                      {result?.ok ? (
                        <StatusChip tone="pos">Legat de {siteName(choice[a.id]!)}</StatusChip>
                      ) : (
                        <select
                          value={choice[a.id] ?? ''}
                          onChange={(e) => setChoice((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          aria-label={`Site-ul contului ${a.name} (${PLATFORM[a.platform]})`}
                          className={field}
                        >
                          <option value="">—</option>
                          {active.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}{row.proposed === s.id ? ' (propus)' : ''}</option>
                          ))}
                        </select>
                      )}
                      {result && !result.ok && <span role="alert" className="w-full text-[12px] text-neg-text">{result.message}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
            {data.proposal.rows.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" loading={saving} disabled={pending === 0} onClick={() => void save()}>
                  {pending === 1 ? 'Leagă contul ales' : `Leagă cele ${pending} conturi alese`}
                </Button>
                {done > 0 && <span className="text-[12.5px] text-pos-text">{done === 1 ? 'Un cont legat.' : `${done} conturi legate.`} Colectarea Airbyte le aduce la următoarea rulare.</span>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
