// Ce tabel Airbyte se colectează pe fiecare platformă și cum devin rândurile lui rânduri `paid_daily` (E-6, etapa 2).
// Pur: primește coloanele din catalog și rândurile citite, construiește doar SELECT-uri cu identificatori citați.
//
// Alegerea tabelului: fluxul standard al conectorului Airbyte, după nume (cu prefixul conexiunii acceptat):
//   Meta (source-facebook-marketing): `ads_insights` (pe anunț, fără defalcări)
//   Google Ads (source-google-ads): `campaign`, apoi `account_performance_report` (acoperă și Performance Max)
//   TikTok (source-tiktok-marketing): `campaigns_reports_daily`, `ads_reports_daily`, `advertisers_reports_daily`
// Defalcările (vârstă, țară) nu se aleg: s-ar aduna peste totaluri. Fără tabel recunoscut, contul nu se colectează.
//
// Duplicatele: în modul „append”, Airbyte rescrie zilele din fereastra de lookback la fiecare sincronizare. Pe cheia
// fluxului (cont, zi, ID-urile entității și segmentele) se păstrează doar rândul cel mai recent (`_airbyte_extracted_at`),
// apoi segmentele (oră, rețea, dispozitiv la Google Ads) se adună pe cont × campanie × grup × anunț × zi.

import { createHash } from 'node:crypto'
import { isStream, META_DIMENSIONS, PRIMARY_STREAMS, quoteIdent, SYNCED_AT, tableName, type Platform, type TableInfo } from '../../supabase/functions/airbyte/inspect.ts'

export const AIRBYTE_SCHEMA_VERSION = 'airbyte-postgres-v1'

type Spec = {
  platform: Platform
  /** Numele fluxurilor acceptate, în ordinea preferinței (numele normalizat al tabelului sau sufixul `_<nume>`). */
  streams: string[]
  account: string
  date: string
  /** ID-urile entității (cel mai fin întâi); cele prezente intră în cheia de deduplicare. */
  ids: string[]
  /** Coloane de segment care intră în cheie (rândul e unic doar cu ele). */
  segment: (column: string) => boolean
  /** Coloana jsonb cu metrici sau dimensiuni (TikTok), din care se citesc câmpurile fără coloană proprie. */
  json: string[]
  fields: Record<Field, string[]>
  /** Costul e în micro-unități (Google Ads `cost_micros`). */
  micros: boolean
  /** Ce înseamnă `clicks` pe platformă (ca la conectorii API). */
  clickType: string
  catalog: { suffix: string; currency: string[]; timezone: string[] }
}

type Field = 'campaign_id' | 'campaign_name' | 'ad_group_id' | 'ad_group_name' | 'ad_id' | 'ad_name' | 'account_name' | 'spend' | 'impressions' | 'clicks' | 'conversions' | 'currency' | 'timezone'

export const SPECS: Record<Platform, Spec> = {
  meta_ads: {
    platform: 'meta_ads', streams: PRIMARY_STREAMS.meta_ads, account: 'account_id', date: 'date_start', ids: ['ad_id', 'adset_id', 'campaign_id'],
    segment: (c) => META_DIMENSIONS.has(c), json: [], micros: false, clickType: 'all',
    fields: {
      campaign_id: ['campaign_id'], campaign_name: ['campaign_name'], ad_group_id: ['adset_id'], ad_group_name: ['adset_name'], ad_id: ['ad_id'], ad_name: ['ad_name'],
      account_name: ['account_name'], spend: ['spend'], impressions: ['impressions'], clicks: ['clicks'],
      // Ca la conectorul API (docs/contracts/meta-ads.md): rezultatul depinde de obiectiv, nu se alege implicit.
      conversions: [], currency: ['account_currency'], timezone: [],
    },
    catalog: { suffix: 'ad_account', currency: ['currency'], timezone: ['timezone_name'] },
  },
  google_ads: {
    platform: 'google_ads', streams: PRIMARY_STREAMS.google_ads, account: 'customer_id', date: 'segments_date',
    ids: ['ad_group_ad_ad_id', 'ad_group_id', 'campaign_id'], segment: (c) => c.startsWith('segments_') && c !== 'segments_date', json: [], micros: true, clickType: 'all',
    fields: {
      campaign_id: ['campaign_id'], campaign_name: ['campaign_name'], ad_group_id: ['ad_group_id'], ad_group_name: ['ad_group_name'], ad_id: ['ad_group_ad_ad_id'],
      ad_name: ['ad_group_ad_ad_name'], account_name: ['customer_descriptive_name'], spend: ['metrics_cost_micros'], impressions: ['metrics_impressions'],
      clicks: ['metrics_clicks'], conversions: ['metrics_conversions'], currency: ['customer_currency_code'], timezone: ['customer_time_zone'],
    },
    catalog: { suffix: 'customer', currency: ['customer_currency_code'], timezone: ['customer_time_zone'] },
  },
  tiktok_ads: {
    platform: 'tiktok_ads', streams: PRIMARY_STREAMS.tiktok_ads, account: 'advertiser_id', date: 'stat_time_day',
    ids: ['ad_id', 'adgroup_id', 'campaign_id'], segment: () => false, json: ['metrics', 'dimensions'], micros: false, clickType: 'all',
    fields: {
      campaign_id: ['campaign_id'], campaign_name: ['campaign_name'], ad_group_id: ['adgroup_id'], ad_group_name: ['adgroup_name'], ad_id: ['ad_id'], ad_name: ['ad_name'],
      account_name: ['advertiser_name'], spend: ['spend'], impressions: ['impressions'], clicks: ['clicks'], conversions: ['conversion'], currency: ['currency'], timezone: [],
    },
    catalog: { suffix: 'advertisers', currency: ['currency'], timezone: ['timezone', 'display_timezone'] },
  },
}

const nameMatches = isStream

/** Tabelul de raport ales pentru platformă: primul flux preferat care are cont, zi și cost sau afișări. */
export function pickReport(platform: Platform, tables: TableInfo[]): TableInfo | null {
  const spec = SPECS[platform]
  const usable = (t: TableInfo) => {
    const has = (c: string) => t.columns.has(c)
    const value = (f: Field) => spec.fields[f].some(has) || spec.json.some(has)
    return has(spec.account) && has(spec.date) && (value('spend') || value('impressions'))
  }
  for (const stream of spec.streams) {
    const found = tables.filter((t) => nameMatches(t.table, stream) && usable(t)).sort((a, b) => `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`))
    if (found.length) return found[0]!
  }
  return null
}

/** Tabelul-catalog al platformei (moneda și fusul orar ale contului), dacă există. */
export function pickCatalog(platform: Platform, tables: TableInfo[]): TableInfo | null {
  const spec = SPECS[platform]
  return tables.find((t) => tableName(t.table).endsWith(spec.catalog.suffix) && t.columns.has(spec.account) && spec.catalog.currency.some((c) => t.columns.has(c))) ?? null
}

const col = (t: TableInfo, c: string) => quoteIdent(t.columns.get(c)!.name)
const rel = (t: TableInfo) => `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`

/** Expresia text a unui câmp: coloana proprie sau cheia din jsonb (TikTok); `null::text` dacă nu există. */
function fieldExpr(spec: Spec, t: TableInfo, field: Field): string {
  const names = spec.fields[field]
  const own = names.find((n) => t.columns.has(n))
  if (own) return `${col(t, own)}::text`
  const json = spec.json.filter((j) => t.columns.has(j)).flatMap((j) => names.map((n) => `(${col(t, j)}::jsonb ->> '${n.replace(/'/g, "''")}')`))
  return json.length ? `coalesce(${json.join(', ')})` : 'null::text'
}

export type ReportRow = {
  account_id: string
  date: string
  campaign_id: string | null
  campaign_name: string | null
  ad_group_id: string | null
  ad_group_name: string | null
  ad_id: string | null
  ad_name: string | null
  account_name: string | null
  spend: string | null
  impressions: string | null
  clicks: string | null
  conversions: string | null
  currency: string | null
  timezone: string | null
}

/**
 * SELECT-ul raportului pentru conturile date, în fereastră: un rând pe cheia fluxului (cel mai recent extras).
 * Parametri: $1 = ID-urile conturilor, separate prin virgulă (doar cifre; postgres.js fără `fetch_types` nu trimite
 * corect un array), $2 / $3 = prima și ultima zi (ISO).
 */
export function reportQuery(platform: Platform, t: TableInfo): string {
  const spec = SPECS[platform]
  const acct = `${col(t, spec.account)}::text`
  const day = `left(${col(t, spec.date)}::text, 10)`
  const key = [acct, day, ...spec.ids.filter((c) => t.columns.has(c)).map((c) => `${col(t, c)}::text`), ...[...t.columns.keys()].filter(spec.segment).sort().map((c) => `${col(t, c)}::text`)]
  for (const j of spec.json) if (t.columns.has(j) && j === 'dimensions') key.push(`${col(t, j)}::jsonb`)
  const synced = SYNCED_AT.find((c) => t.columns.has(c))
  const fields: Field[] = ['campaign_id', 'campaign_name', 'ad_group_id', 'ad_group_name', 'ad_id', 'ad_name', 'account_name', 'spend', 'impressions', 'clicks', 'conversions', 'currency', 'timezone']
  return (
    `select distinct on (${key.join(', ')}) ${acct} as account_id, ${day} as date, ` +
    fields.map((f) => `${fieldExpr(spec, t, f)} as ${f}`).join(', ') +
    ` from ${rel(t)} where ${acct} = any(string_to_array($1, ',')) and ${day} between $2 and $3` +
    ` order by ${key.join(', ')}${synced ? `, ${col(t, synced)} desc nulls last` : ''}`
  )
}

/** Ultima zi cu date a fiecărui cont, în tot tabelul (diagnostic când fereastra e goală). Parametru: $1 = ID-urile conturilor. */
export function lastDateQuery(platform: Platform, t: TableInfo): string {
  const spec = SPECS[platform]
  const acct = `${col(t, spec.account)}::text`
  return `select ${acct} as account_id, max(left(${col(t, spec.date)}::text, 10)) as last_date from ${rel(t)} where ${acct} = any(string_to_array($1, ',')) group by 1`
}

/** Moneda și fusul orar din catalog, pe cont. Parametru: $1 = ID-urile conturilor, separate prin virgulă. */
export function catalogQuery(platform: Platform, t: TableInfo): string {
  const spec = SPECS[platform]
  const pick = (names: string[]) => {
    const c = names.find((n) => t.columns.has(n))
    return c ? `max(${col(t, c)}::text)` : 'null::text'
  }
  const acct = `${col(t, spec.account)}::text`
  return `select ${acct} as account_id, ${pick(spec.catalog.currency)} as currency, ${pick(spec.catalog.timezone)} as timezone from ${rel(t)} where ${acct} = any(string_to_array($1, ',')) group by 1`
}

// --- Normalizarea în paid_daily ---------------------------------------------------------------------------------

export type Provenance = {
  tenant_id: string
  brand_id: string
  source_id: string
  sync_run_id: string
  collected_at: string
  source_timezone: string
  currency: string
  table: string
}

const DECIMAL = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/

function decimal(v: string | null, key: string, notes: string[]): number | null {
  if (v === null || v.trim() === '') return null
  const s = v.trim()
  if (!DECIMAL.test(s) || Number(s) < 0) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return Number(s)
}

function integer(v: string | null, key: string, notes: string[]): number | null {
  const n = decimal(v, key, notes)
  if (n === null) return null
  if (!Number.isInteger(n)) {
    notes.push(`valoare neîntreagă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return n
}

/** Suma în care `null` rămâne `null` doar dacă toate valorile lipsesc (regula 8: lipsa nu devine 0). */
const add = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b)
const empty = (v: string | null) => (v === null || v === '' ? null : v)

/**
 * Rândurile citite (deja deduplicate) → rânduri `paid_daily`, adunate pe cont × campanie × grup × anunț × zi.
 * Costul Google Ads vine în micro-unități; moneda e a contului (o monedă diferită pe rând devine notă și rândul se sare).
 */
export function toPaidRows(platform: Platform, rows: ReportRow[], p: Provenance, notes: string[]): Array<Record<string, unknown>> {
  const spec = SPECS[platform]
  const out = new Map<string, Record<string, unknown> & { _hash: ReturnType<typeof createHash> }>()
  for (const r of rows) {
    const rowCurrency = empty(r.currency)
    if (rowCurrency !== null && rowCurrency !== p.currency) {
      notes.push(`moneda rândului (${rowCurrency}) diferă de moneda contului (${p.currency}); rândul nu se scrie`)
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      notes.push(`dată invalidă: ${JSON.stringify(r.date)}`)
      continue
    }
    const campaign = empty(r.campaign_id) ?? (empty(r.campaign_name) ? `name:${r.campaign_name}` : `account:${r.account_id}`)
    const adGroup = empty(r.ad_group_id) ?? ''
    const ad = empty(r.ad_id) ?? ''
    const k = [r.account_id, campaign, adGroup, ad, r.date].join('\u0000')
    let spend = decimal(r.spend, spec.fields.spend[0] ?? 'spend', notes)
    if (spend !== null && spec.micros) spend = Math.round(spend) / 1_000_000
    const impressions = integer(r.impressions, 'impressions', notes)
    const clicks = integer(r.clicks, 'clicks', notes)
    const conversions = spec.fields.conversions.length ? decimal(r.conversions, 'conversions', notes) : null
    let row = out.get(k)
    if (!row) {
      row = {
        _hash: createHash('sha256'),
        tenant_id: p.tenant_id, brand_id: p.brand_id, source: platform, account_id: r.account_id,
        campaign_id: campaign.slice(0, 512), ad_group_id: adGroup.slice(0, 512), ad_id: ad.slice(0, 512), date: r.date,
        breakdown_signature: 'none', attribution_config: 'unspecified', click_type: spec.clickType,
        account_name: empty(r.account_name), campaign_name: empty(r.campaign_name), ad_group_name: empty(r.ad_group_name), ad_name: empty(r.ad_name),
        spend: null, impressions: null, clicks: null, conversions: null, currency: p.currency,
        source_id: p.source_id, sync_run_id: p.sync_run_id, import_batch_id: null, row_number: null, collected_at: p.collected_at,
        collection_method: 'api', source_timezone: p.source_timezone, schema_version: `${AIRBYTE_SCHEMA_VERSION}:${p.table}`.slice(0, 200),
      }
      out.set(k, row)
    }
    row.spend = add(row.spend as number | null, spend)
    row.impressions = add(row.impressions as number | null, impressions)
    row.clicks = add(row.clicks as number | null, clicks)
    row.conversions = add(row.conversions as number | null, conversions)
    row.account_name ??= empty(r.account_name)
    row.campaign_name ??= empty(r.campaign_name)
    row._hash.update(JSON.stringify(r))
  }
  return [...out.values()].map(({ _hash, ...row }) => ({
    ...row,
    // Suma de micro-unități împărțită poate lăsa zecimale de virgulă mobilă: costul se rotunjește la 6 zecimale.
    spend: row.spend === null ? null : Math.round((row.spend as number) * 1_000_000) / 1_000_000,
    payload_hash: _hash.digest('hex'),
  }))
}
