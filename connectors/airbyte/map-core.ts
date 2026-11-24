// Maparea conturilor Airbyte pe site-urile clientului, din worker (E-8): aceeași propunere ca pasul „Conturile tuturor
// site-urilor” din aplicație (apps/web/src/lib/airbyteMapping.ts), pentru agenție, fără ecran.
//
// Implicit doar afișează propunerea. Cu `apply`, leagă doar conturile cu un singur site propus; cele ambigue și cele fără
// potrivire rămân nelegate și se raportează. Un cont legat deja (pe orice site al clientului) nu se atinge.
// Conexiunea la Airbyte: aceleași verificări ca la colectare (doar nume public, TLS verificat, sesiune read-only).

import { proposeAirbyteMapping } from '../../apps/web/src/lib/airbyteMapping.ts'
import { checkResolved, parseCredential } from '../../supabase/functions/airbyte/dsn.ts'
import { inspect, PLATFORM_LABEL, type PgSession, type PgTarget } from '../../supabase/functions/airbyte/inspect.ts'
import { getSourceToken, loadActiveConnections } from '../shared/connections.ts'
import { assertUuid, type Db } from '../shared/supabase-rest.ts'
import { AIRBYTE_CREDENTIAL_PROVIDER, AIRBYTE_PROVIDER } from './collect-core.ts'

/** Inspecția din worker nu are limita de 45 s a funcției server; rămâne totuși mărginită. */
export const MAP_INSPECT_BUDGET_MS = 300_000

export type MapDeps = {
  db: Db
  now?: () => number
  resolve: (host: string) => Promise<string[]>
  connect: <T>(target: PgTarget, run: (session: PgSession) => Promise<T>) => Promise<T>
  apply: boolean
}

export type MapAccount = { id: string; name: string; platform: string; label: string; last_date: string | null }

export type MapReport = {
  tenant_id: string
  tenant_name: string
  /** Eroarea care a oprit maparea clientului (conexiune, credențială); restul câmpurilor sunt goale. */
  error: string | null
  sites: Array<{ id: string; name: string; status: string }>
  proposed: Array<{ account: MapAccount; brand_id: string; linked: boolean; error: string | null }>
  ambiguous: Array<{ account: MapAccount; candidates: string[] }>
  unmatched: MapAccount[]
  already: Array<{ account: MapAccount; brand_id: string }>
  truncated: boolean
}

type Brand = { id: string; tenant_id: string; name: string; domain: string | null; status: string }
type Conn = { id: string; tenant_id: string; brand_id: string | null; external_account_id: string }

export async function mapAirbyte(deps: MapDeps): Promise<MapReport[]> {
  const { db } = deps
  const now = deps.now ?? Date.now
  const credentials = (await loadActiveConnections(db, AIRBYTE_CREDENTIAL_PROVIDER, { requireBrand: false })).connections.filter((c) => c.brand_id === null)
  const reports: MapReport[] = []
  for (const cred of credentials) {
    assertUuid(cred.tenant_id, 'tenant_id')
    const tenant = (await db.select<{ id: string; name: string }>('tenants', `select=id,name&id=eq.${cred.tenant_id}`))[0]
    const report: MapReport = { tenant_id: cred.tenant_id, tenant_name: tenant?.name ?? '', error: null, sites: [], proposed: [], ambiguous: [], unmatched: [], already: [], truncated: false }
    reports.push(report)

    const parsed = parseCredential(await getSourceToken(db, cred.id))
    if (!parsed.ok) {
      report.error = parsed.message
      continue
    }
    const dsn = parsed.dsn
    let addresses: string[]
    try {
      addresses = await deps.resolve(dsn.host)
    } catch {
      report.error = `Numele ${dsn.host} nu a putut fi rezolvat (DNS).`
      continue
    }
    const blocked = addresses.length === 0 ? { message: `Numele ${dsn.host} nu există în DNS.` } : checkResolved(addresses)
    if (blocked) {
      report.error = blocked.message
      continue
    }

    let inspection
    try {
      inspection = await deps.connect(
        { ip: addresses[0]!, servername: dsn.host, port: dsn.port, user: dsn.user, password: dsn.password, database: dsn.database, ca: dsn.ca },
        (session) => inspect(session, now() + MAP_INSPECT_BUDGET_MS, now),
      )
    } catch (err) {
      report.error = `Conexiunea la Airbyte a eșuat (${(err as Error).message}).`
      continue
    }
    report.truncated = inspection.truncated

    const brands = await db.select<Brand>('brands', `select=id,tenant_id,name,domain,status&tenant_id=eq.${cred.tenant_id}`)
    if (brands.some((b) => b.tenant_id !== cred.tenant_id)) throw new Error('brands: rând din alt tenant; opresc maparea.')
    report.sites = brands.map((b) => ({ id: b.id, name: b.name, status: b.status }))
    // Orice conexiune `airbyte` existentă (activă sau nu): cheia unică e pe tenant, deci contul nu se poate lega a doua oară.
    const conns = await db.select<Conn>('source_connections', `select=id,tenant_id,brand_id,external_account_id&tenant_id=eq.${cred.tenant_id}&provider=eq.${AIRBYTE_PROVIDER}`)
    const linkedTo = new Map(conns.filter((c) => c.tenant_id === cred.tenant_id && c.brand_id).map((c) => [c.external_account_id, c.brand_id!]))

    const accounts: MapAccount[] = inspection.accounts.map((a) => ({
      id: `${a.platform}:${a.account_id}`, name: a.name ?? a.account_id, platform: a.platform, label: PLATFORM_LABEL[a.platform], last_date: a.last_date,
    }))
    const proposal = proposeAirbyteMapping(accounts, brands, report.tenant_name, linkedTo)
    report.already = proposal.linked
    for (const row of proposal.rows) {
      if (row.proposed) report.proposed.push({ account: row.account, brand_id: row.proposed, linked: false, error: null })
      else if (row.candidates.length) report.ambiguous.push({ account: row.account, candidates: row.candidates })
      else report.unmatched.push(row.account)
    }

    if (!deps.apply) continue
    for (const p of report.proposed) {
      assertUuid(p.brand_id, 'brand_id')
      try {
        const rows = await db.insert<{ tenant_id: string; brand_id: string }>('source_connections', {
          tenant_id: cred.tenant_id, brand_id: p.brand_id, provider: AIRBYTE_PROVIDER, external_account_id: p.account.id, display_name: p.account.name,
        })
        if (rows.length !== 1 || rows[0]!.tenant_id !== cred.tenant_id || rows[0]!.brand_id !== p.brand_id) throw new Error('rândul întors nu corespunde clientului sau site-ului')
        p.linked = true
      } catch (err) {
        p.error = (err as Error).message
      }
    }
  }
  return reports
}
