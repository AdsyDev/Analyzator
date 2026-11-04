// Search Console: ce proprietate folosește fiecare site și ce proprietăți vede cheia clientului (D-27).
//
// Verificarea doar citește: conexiunile `gsc`, site-urile și lista proprietăților văzute de service account-ul
// clientului (aceeași listare ca selectorul din pagina site-ului, `discover`). Cheia se citește din Vault doar în
// memorie și nu se afișează.
//
// Trecerea pe Domain property se face doar când cheia vede proprietatea `sc-domain:<domeniul site-ului>` și când
// proprietatea veche ține de același domeniu: conexiunea veche se arhivează (istoricul ei rămâne), iar cea nouă se
// adaugă sau, dacă a existat și a fost arhivată, se reactivează. Dacă pasul al doilea eșuează, conexiunea veche se
// reactivează. Fiecare scriere filtrează explicit pe tenant și brand.

import { discover, type DiscoverOutcome } from '../../supabase/functions/source-credentials/discover.ts'
import { getSourceToken, loadActiveConnections } from '../shared/connections.ts'
import { assertUuid, type Db } from '../shared/supabase-rest.ts'
import { GOOGLE_CREDENTIAL_PROVIDER, GOOGLE_LOOKBACK_DAYS, GSC_HISTORY_MONTHS, GSC_PROVIDER } from './config.ts'

/** Proprietățile Search Console pe care le vede o cheie (JSON-ul service account-ului). */
export type ListGscSites = (serviceAccountJson: string) => Promise<DiscoverOutcome>

export type GscPropertyDeps = { db: Db; listSites?: ListGscSites; now?: () => Date }

export type GscAction =
  /** Deja pe Domain property. */
  | 'keep'
  /** URL prefix al aceluiași domeniu → Domain property, pe care cheia o vede. */
  | 'switch'
  /** Fără conexiune Search Console; cheia vede Domain property. */
  | 'connect'
  /** Cheia nu vede Domain property: clientul trebuie să adauge service account-ul pe ea. */
  | 'no_domain_access'
  /** Proprietatea actuală nu ține de domeniul site-ului: de lămurit, nu se schimbă automat. */
  | 'mismatch'
  /** Site fără domeniu în aplicație. */
  | 'no_domain'
  /** Clientul nu are cheie Google validă. */
  | 'no_credential'
  /** Google a refuzat listarea proprietăților. */
  | 'list_failed'
  /** Mai multe conexiuni Search Console active pe același site: de rezolvat manual. */
  | 'multiple'

export type GscSiteReport = {
  tenant_id: string
  tenant_name: string | null
  brand_id: string
  brand_name: string
  domain: string | null
  /** Conexiunile `gsc` active ale site-ului (normal: una). */
  current: Array<{ connection_id: string; site_url: string }>
  /** `sc-domain:<domeniu>`, când site-ul are domeniu. */
  target: string | null
  /** Proprietățile văzute de cheie care țin de domeniul site-ului. */
  visible: string[]
  action: GscAction
  note: string
  /** Rândurile scrise de ultima rulare Search Console (o fereastră de 35 de zile), dacă există. */
  last_run_rows: number | null
  /** Conexiunile `gsc` arhivate ale site-ului (proprietăți folosite înainte). */
  archived_count: number
  /** Există rânduri Search Console legate de o conexiune `gsc` arhivată a site-ului (proprietatea veche). */
  old_property_rows: boolean
}

type ConnectionRow = { id: string; tenant_id: string; brand_id: string | null; external_account_id: string; timezone: string; status: string }

/** Gazda unei proprietăți (`sc-domain:x.ro` → `x.ro`, `https://www.x.ro/` → `www.x.ro`), sau null. */
export function propertyHost(siteUrl: string): string | null {
  if (siteUrl.startsWith('sc-domain:')) return siteUrl.slice('sc-domain:'.length).toLowerCase() || null
  try {
    const u = new URL(siteUrl)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

/** Proprietatea ține de domeniu: gazda e domeniul sau un subdomeniu al lui (`www.x.ro` ține de `x.ro`). */
export function belongsToDomain(siteUrl: string, domain: string): boolean {
  const host = propertyHost(siteUrl)
  return host !== null && (host === domain || host.endsWith(`.${domain}`))
}

const defaultListSites = (now: () => Date): ListGscSites => (raw) => discover('gsc', raw, (input, init) => fetch(input, init), now())

/** Doar citire: raportul pe fiecare site activ (opțional doar un client). */
export async function inspectGscProperties(deps: GscPropertyDeps, options: { tenantId?: string } = {}): Promise<GscSiteReport[]> {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const listSites = deps.listSites ?? defaultListSites(now)
  if (options.tenantId !== undefined) assertUuid(options.tenantId, 'tenant_id')
  const tenantFilter = options.tenantId ? `&tenant_id=eq.${options.tenantId}` : ''

  const tenants = await db.select<{ id: string; name: string }>('tenants', `select=id,name${options.tenantId ? `&id=eq.${options.tenantId}` : ''}`)
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))
  const brands = await db.select<{ id: string; tenant_id: string; name: string; domain: string | null; status: string }>(
    'brands',
    `select=id,tenant_id,name,domain,status&status=eq.active${tenantFilter}`,
  )
  const gsc = await db.select<ConnectionRow>(
    'source_connections',
    `select=id,tenant_id,brand_id,external_account_id,timezone,status&provider=eq.${GSC_PROVIDER}${tenantFilter}`,
  )
  const credentials = await loadActiveConnections(db, GOOGLE_CREDENTIAL_PROVIDER, { requireBrand: false })
  const credentialByTenant = new Map(credentials.connections.map((c) => [c.tenant_id, c.id]))

  // O singură listare per client: aceeași cheie pentru toate site-urile lui.
  const sitesByTenant = new Map<string, { ok: true; sites: string[] } | { ok: false; message: string }>()
  for (const tenantId of new Set(brands.map((b) => b.tenant_id))) {
    const credentialId = credentialByTenant.get(tenantId)
    if (!credentialId) continue
    let outcome: DiscoverOutcome
    try {
      outcome = await listSites(await getSourceToken(db, credentialId))
    } catch (err) {
      sitesByTenant.set(tenantId, { ok: false, message: (err as Error).message })
      continue
    }
    sitesByTenant.set(tenantId, outcome.ok ? { ok: true, sites: outcome.accounts.map((a) => a.id) } : { ok: false, message: outcome.message })
  }

  const reports: GscSiteReport[] = []
  for (const b of [...brands].sort((x, y) => x.tenant_id.localeCompare(y.tenant_id) || x.name.localeCompare(y.name))) {
    const mine = gsc.filter((c) => c.tenant_id === b.tenant_id && c.brand_id === b.id)
    const active = mine.filter((c) => c.status === 'active')
    const archivedIds = mine.filter((c) => c.status === 'archived').map((c) => c.id)
    const domain = b.domain ? b.domain.toLowerCase().replace(/^www\./, '') : null
    const target = domain ? `sc-domain:${domain}` : null
    const listing = sitesByTenant.get(b.tenant_id)
    const visible = listing?.ok && domain ? listing.sites.filter((s) => belongsToDomain(s, domain)) : []
    const current = active.map((c) => ({ connection_id: c.id, site_url: c.external_account_id.trim() }))

    let action: GscAction
    let note: string
    if (!credentialByTenant.has(b.tenant_id)) {
      action = 'no_credential'
      note = 'clientul nu are cheie Google validă'
    } else if (!listing || !listing.ok) {
      action = 'list_failed'
      note = listing && !listing.ok ? listing.message : 'listarea nu a rulat'
    } else if (!domain || !target) {
      action = 'no_domain'
      note = 'site-ul nu are domeniu în aplicație'
    } else if (current.length > 1) {
      action = 'multiple'
      note = 'mai multe proprietăți Search Console active pe același site'
    } else if (current[0]?.site_url === target) {
      action = 'keep'
      note = 'folosește deja Domain property'
    } else if (current[0] && !belongsToDomain(current[0].site_url, domain)) {
      action = 'mismatch'
      note = `proprietatea actuală nu ține de ${domain}`
    } else if (!visible.includes(target)) {
      action = 'no_domain_access'
      note = `cheia nu vede ${target}: clientul trebuie să adauge service account-ul pe Domain property`
    } else if (current[0]) {
      action = 'switch'
      note = `${current[0].site_url} → ${target}`
    } else {
      action = 'connect'
      note = `fără conexiune; se adaugă ${target}`
    }

    reports.push({
      tenant_id: b.tenant_id,
      tenant_name: tenantName.get(b.tenant_id) ?? null,
      brand_id: b.id,
      brand_name: b.name,
      domain,
      current,
      target,
      visible,
      action,
      note,
      last_run_rows: await lastRunRows(db, b.tenant_id, b.id),
      archived_count: archivedIds.length,
      old_property_rows: await hasOldPropertyRows(db, b.tenant_id, b.id, archivedIds),
    })
  }
  return reports
}

async function lastRunRows(db: Db, tenantId: string, brandId: string): Promise<number | null> {
  const runs = await db.select<{ rows_written: number | null; created_at: string; status: string }>(
    'sync_runs',
    `select=rows_written,created_at,status&tenant_id=eq.${tenantId}&brand_id=eq.${brandId}&source=eq.${GSC_PROVIDER}&order=created_at.desc&limit=1`,
  )
  const last = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return typeof last?.rows_written === 'number' ? last.rows_written : null
}

async function hasOldPropertyRows(db: Db, tenantId: string, brandId: string, archivedIds: string[]): Promise<boolean> {
  if (archivedIds.length === 0) return false
  for (const id of archivedIds) assertUuid(id, 'source_id')
  const filter = `tenant_id=eq.${tenantId}&brand_id=eq.${brandId}&source_id=in.(${archivedIds.join(',')})&limit=1`
  for (const table of ['search_daily', 'search_queries']) {
    if ((await db.select(table, `select=id&${filter}`)).length > 0) return true
  }
  return false
}

/** Câte rânduri ar adăuga un reimport de 16 luni, din ultima rulare de 35 de zile (estimare). */
export function estimateHistoryRows(lastRunRows: number | null): number | null {
  if (lastRunRows === null) return null
  return Math.round(lastRunRows * ((GSC_HISTORY_MONTHS * 365.25) / 12 / GOOGLE_LOOKBACK_DAYS))
}

export type GscApplyResult = { brand_id: string; action: 'switched' | 'connected' | 'kept'; connection_id: string; site_url: string; previous: string | null }

/**
 * Trece un site pe Domain property, după raportul proaspăt al aceluiași site. Acceptă doar `switch`, `connect`
 * (scrie) și `keep` (nu scrie nimic). Orice altă situație aruncă înainte de vreo scriere.
 */
export async function applyGscProperty(db: Db, report: GscSiteReport): Promise<GscApplyResult> {
  assertUuid(report.tenant_id, 'tenant_id')
  assertUuid(report.brand_id, 'brand_id')
  const scope = `tenant_id=eq.${report.tenant_id}&brand_id=eq.${report.brand_id}&provider=eq.${GSC_PROVIDER}`
  if (report.action === 'keep') {
    const kept = report.current[0]!
    return { brand_id: report.brand_id, action: 'kept', connection_id: kept.connection_id, site_url: kept.site_url, previous: null }
  }
  if ((report.action !== 'switch' && report.action !== 'connect') || !report.target) {
    throw new Error(`${report.brand_name}: nu trec automat (${report.action}: ${report.note}).`)
  }
  const target = report.target

  // Proprietatea nouă poate exista deja pe client (de ex. arhivată după o revenire): atunci se reactivează.
  const existing = (
    await db.select<ConnectionRow>(
      'source_connections',
      `select=id,tenant_id,brand_id,external_account_id,timezone,status&tenant_id=eq.${report.tenant_id}&provider=eq.${GSC_PROVIDER}`,
    )
  ).filter((c) => c.tenant_id === report.tenant_id && c.external_account_id.trim() === target)
  const clash = existing.find((c) => c.brand_id !== report.brand_id)
  if (clash) throw new Error(`${report.brand_name}: ${target} e deja legată de alt site al clientului (conexiunea ${clash.id}).`)

  let previous: ConnectionRow | null = null
  if (report.action === 'switch') {
    const old = report.current[0]!
    assertUuid(old.connection_id, 'connection_id')
    const archived = await db.update<ConnectionRow>('source_connections', `id=eq.${old.connection_id}&${scope}&status=eq.active`, { status: 'archived' })
    if (archived.length !== 1 || archived[0]!.tenant_id !== report.tenant_id || archived[0]!.brand_id !== report.brand_id) {
      throw new Error(`${report.brand_name}: conexiunea ${old.connection_id} nu mai e activă pe acest site; nu schimb nimic.`)
    }
    previous = archived[0]!
  }

  try {
    const revived = existing.find((c) => c.brand_id === report.brand_id)
    const rows = revived
      ? await db.update<ConnectionRow>('source_connections', `id=eq.${revived.id}&${scope}&status=eq.archived`, { status: 'active' })
      : await db.insert<ConnectionRow>('source_connections', {
          tenant_id: report.tenant_id,
          brand_id: report.brand_id,
          provider: GSC_PROVIDER,
          external_account_id: target,
          display_name: target,
          ...(previous ? { timezone: previous.timezone } : {}),
          status: 'active',
        })
    const row = rows[0]
    if (rows.length !== 1 || !row || row.tenant_id !== report.tenant_id || row.brand_id !== report.brand_id || row.external_account_id !== target) {
      throw new Error(`${report.brand_name}: conexiunea nouă nu corespunde site-ului.`)
    }
    return { brand_id: report.brand_id, action: previous ? 'switched' : 'connected', connection_id: row.id, site_url: target, previous: previous?.external_account_id ?? null }
  } catch (err) {
    // Site-ul nu rămâne fără proprietate: conexiunea veche revine.
    if (previous) await db.update('source_connections', `id=eq.${previous.id}&${scope}&status=eq.archived`, { status: 'active' })
    throw err
  }
}
