// Ce găsim în destinația Postgres Airbyte (E-6): tabelele Meta, Google Ads și TikTok la care utilizatorul are drept de
// citire, conturile din ele, perioada, ultima sincronizare și metricile disponibile. Independent de driver: primește o
// sesiune deja read-only (vezi pg.ts) și construiește doar SELECT-uri, cu identificatorii citați din catalog.
//
// Detectarea e după coloane, nu după numele tabelelor (conexiunile Airbyte pot avea prefix sau alt namespace):
//   Meta (source-facebook-marketing): account_id + date_start + spend/impressions (ads_insights și defalcările lui)
//   Google Ads (source-google-ads): customer_id + segments_date + metrics_* (rapoartele cu `customer.id`)
//   TikTok (source-tiktok-marketing): advertiser_id + stat_time_day + metrics (jsonb) sau spend (*_reports_daily)
// Tabelele-catalog dau doar numele conturilor: ad_account (Meta), customer (Google Ads), advertisers (TikTok).

export type Platform = 'meta_ads' | 'google_ads' | 'tiktok_ads'

export type PgSession = {
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>
}

/** Unde se conectează adaptorul (pg.ts): IP-ul public verificat și numele pentru TLS. */
export type PgTarget = {
  ip: string
  servername: string
  port: number
  user: string
  password: string
  database: string
  /** Autoritatea proprie care a emis certificatul serverului; `null` = autoritățile publice. */
  ca: string | null
}

export type PgErrorKind = 'auth' | 'database_not_found' | 'tls' | 'unreachable' | 'timeout' | 'permission' | 'not_read_only' | 'other'

/** Eroare a driverului, clasificată de adaptor (pg.ts). `code` = SQLSTATE sau codul de rețea, fără mesajul serverului. */
export class PgError extends Error {
  readonly kind: PgErrorKind
  readonly code: string | null
  constructor(kind: PgErrorKind, code: string | null) {
    super(`postgres: ${kind}${code ? ` (${code})` : ''}`)
    this.kind = kind
    this.code = code
  }
}

const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED'])

/** Clasificarea erorilor driverului (postgres.js în Deno): SQLSTATE, coduri de rețea și erorile TLS din Deno. */
export function classifyPgError(e: unknown): PgError {
  if (e instanceof PgError) return e
  const err = (e ?? {}) as { code?: unknown; name?: unknown; message?: unknown }
  const code = typeof err.code === 'string' ? err.code : null
  const text = `${typeof err.name === 'string' ? err.name : ''} ${typeof err.message === 'string' ? err.message : ''}`
  let kind: PgErrorKind = 'other'
  if (code === '28P01' || code === '28000') kind = 'auth'
  else if (code === '3D000') kind = 'database_not_found'
  else if (code === '57014' || code === 'CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || /TimedOut/.test(text)) kind = 'timeout'
  else if (code === '42501') kind = 'permission'
  else if (code === '25006') kind = 'not_read_only'
  else if (code === 'SSL_NOT_SUPPORTED' || /\b(ssl|tls|certificate|InvalidData)\b/i.test(text) || /peer certificate|UnexpectedEof/i.test(text)) kind = 'tls'
  else if ((code && (UNREACHABLE.has(code) || code.startsWith('08'))) || /ConnectionRefused|ConnectionReset|NotConnected|HostUnreachable|NetworkUnreachable/.test(text)) kind = 'unreachable'
  return new PgError(kind, code)
}

export type TableSummary = {
  schema: string
  table: string
  role: 'report' | 'catalog'
  level: string | null
  rows: number | null
  accounts: number | null
  first_date: string | null
  last_date: string | null
  last_synced_at: string | null
  metrics: string[]
  dimensions: string[]
  error: 'timeout' | 'permission' | 'failed' | 'skipped' | null
}

export type AccountSummary = {
  platform: Platform
  account_id: string
  name: string | null
  rows: number
  first_date: string | null
  last_date: string | null
  last_synced_at: string | null
  tables: number
}

export type Inspection = {
  platforms: Array<{ platform: Platform; label: string; tables: TableSummary[] }>
  accounts: AccountSummary[]
  truncated: boolean
}

type Column = { schema: string; table: string; column: string; data_type: string }

type Signature = {
  platform: Platform
  label: string
  account: string
  date: string
  /** Măcar una dintre aceste coloane: tabelul are cheltuieli sau afișări, nu doar entități. */
  evidence: string[]
  names: string[]
  /** Coloana jsonb cu metrici (TikTok), ale cărei chei le listăm. */
  metricsJson?: string
  dimensionsJson?: string
  /** Nivelul raportului, după cel mai fin ID prezent. */
  levels: Array<[string, string]>
  /** Coloane care sunt defalcări (vârstă, țară, dispozitiv). */
  isDimension: (column: string) => boolean
  /** Tabelul-catalog cu numele conturilor: sufixul numelui tabelului și coloana cu numele. */
  catalog: { suffix: string; names: string[] }
}

export const PLATFORM_LABEL: Record<Platform, string> = { meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads' }

const META_DIMENSIONS = new Set(['age', 'gender', 'country', 'region', 'dma', 'publisher_platform', 'platform_position', 'device_platform', 'impression_device', 'action_type', 'product_id', 'hourly_stats_aggregated_by_advertiser_time_zone'])

export const SIGNATURES: Signature[] = [
  {
    platform: 'meta_ads', label: PLATFORM_LABEL.meta_ads, account: 'account_id', date: 'date_start', evidence: ['spend', 'impressions'],
    names: ['account_name'], levels: [['ad_id', 'ad'], ['adset_id', 'adset'], ['campaign_id', 'campaign']],
    isDimension: (c) => META_DIMENSIONS.has(c), catalog: { suffix: 'ad_account', names: ['name'] },
  },
  {
    platform: 'google_ads', label: PLATFORM_LABEL.google_ads, account: 'customer_id', date: 'segments_date',
    evidence: ['metrics_cost_micros', 'metrics_impressions', 'metrics_clicks'], names: ['customer_descriptive_name'],
    levels: [['ad_group_ad_ad_id', 'ad'], ['ad_group_criterion_criterion_id', 'keyword'], ['ad_group_id', 'ad_group'], ['campaign_id', 'campaign']],
    isDimension: (c) => c.startsWith('segments_') && c !== 'segments_date', catalog: { suffix: 'customer', names: ['customer_descriptive_name'] },
  },
  {
    platform: 'tiktok_ads', label: PLATFORM_LABEL.tiktok_ads, account: 'advertiser_id', date: 'stat_time_day', evidence: ['metrics', 'spend'],
    names: ['advertiser_name'], metricsJson: 'metrics', dimensionsJson: 'dimensions',
    levels: [['ad_id', 'ad'], ['adgroup_id', 'ad_group'], ['campaign_id', 'campaign']],
    isDimension: () => false, catalog: { suffix: 'advertisers', names: ['name', 'advertiser_name'] },
  },
]

/** Coloanele tehnice Airbyte (V2 și mai vechi), care nu sunt nici metrici, nici defalcări. */
const AIRBYTE_COLUMNS = new Set(['_airbyte_raw_id', '_airbyte_extracted_at', '_airbyte_meta', '_airbyte_generation_id', '_airbyte_ab_id', '_airbyte_emitted_at', '_airbyte_normalized_at'])
const SYNCED_AT = ['_airbyte_extracted_at', '_airbyte_emitted_at']
const NUMERIC = new Set(['numeric', 'bigint', 'integer', 'smallint', 'double precision', 'real', 'decimal'])
const SKIPPED_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'airbyte_internal']

/** Plafoane: o inspecție nu citește mai mult de atâtea tabele și conturi; peste ele, `truncated`. */
export const MAX_TABLES = 40
export const MAX_ACCOUNTS_PER_TABLE = 200
const KEYS_SAMPLE_ROWS = 500

/** Numele de coloană normalizat (Airbyte poate păstra `customer.id`), legat de numele real pentru citare. */
const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]+/g, '_')

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

type TableInfo = { schema: string; table: string; columns: Map<string, { name: string; type: string }> }

function groupTables(rows: Column[]): TableInfo[] {
  const byKey = new Map<string, TableInfo>()
  for (const r of rows) {
    const key = `${r.schema}\u0000${r.table}`
    let t = byKey.get(key)
    if (!t) byKey.set(key, (t = { schema: r.schema, table: r.table, columns: new Map() }))
    t.columns.set(norm(r.column), { name: r.column, type: r.data_type })
  }
  return [...byKey.values()]
}

type Match = { sig: Signature; info: TableInfo; role: 'report' | 'catalog' }

export function classify(tables: TableInfo[]): Match[] {
  const out: Match[] = []
  for (const info of tables) {
    const has = (c: string) => info.columns.has(c)
    for (const sig of SIGNATURES) {
      if (!has(sig.account)) continue
      if (has(sig.date) && sig.evidence.some(has)) {
        out.push({ sig, info, role: 'report' })
        break
      }
      // Catalogul poate avea și dată (fluxul `customer` din Google Ads are segments.date), dar nu are metrici.
      if (norm(info.table).endsWith(sig.catalog.suffix) && sig.catalog.names.some(has)) {
        out.push({ sig, info, role: 'catalog' })
        break
      }
    }
  }
  return out
}

function col(info: TableInfo, normalized: string): string {
  return quoteIdent(info.columns.get(normalized)!.name)
}

function syncedAtExpr(info: TableInfo): string {
  const c = SYNCED_AT.find((n) => info.columns.has(n))
  if (!c) return 'null::text'
  const { type } = info.columns.get(c)!
  const v = type === 'timestamp with time zone' ? `max(${col(info, c)}) at time zone 'UTC'` : `max(${col(info, c)})`
  return `to_char(${v}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
}

function metricColumns(sig: Signature, info: TableInfo): string[] {
  const out: string[] = []
  for (const [n, { type }] of info.columns) {
    if (AIRBYTE_COLUMNS.has(n) || n === sig.metricsJson || n === sig.dimensionsJson) continue
    if (n === 'id' || n.endsWith('_id') || sig.isDimension(n)) continue
    if (sig.platform === 'google_ads' ? n.startsWith('metrics_') : NUMERIC.has(type)) out.push(n)
    else if (sig.platform === 'meta_ads' && (type === 'jsonb' || type === 'json') && /(^|_)(actions|action_values|conversions|conversion_values|purchase_roas|cost_per_action_type)$/.test(n)) out.push(n)
  }
  return out.sort()
}

async function jsonKeys(session: PgSession, info: TableInfo, column: string): Promise<string[]> {
  const c = info.columns.get(column)
  if (!c || (c.type !== 'jsonb' && c.type !== 'json')) return []
  const rows = await session.query<{ key: string }>(
    `select distinct k as key from (select ${quoteIdent(c.name)}::jsonb as v from ${quoteIdent(info.schema)}.${quoteIdent(info.table)} ` +
      `where ${quoteIdent(c.name)} is not null limit ${KEYS_SAMPLE_ROWS}) s, ` +
      `lateral jsonb_object_keys(case when jsonb_typeof(s.v) = 'object' then s.v else '{}'::jsonb end) k order by 1 limit 200`,
  )
  return rows.map((r) => r.key).filter((k): k is string => typeof k === 'string')
}

type AccountRow = { account_id: string | null; name: string | null; rows: string | number; first_date: string | null; last_date: string | null; last_synced_at: string | null }

async function summarizeReport(session: PgSession, m: Match): Promise<{ summary: TableSummary; accounts: AccountRow[]; truncated: boolean }> {
  const { sig, info } = m
  const name = sig.names.find((n) => info.columns.has(n))
  const rel = `${quoteIdent(info.schema)}.${quoteIdent(info.table)}`
  const acct = col(info, sig.account)
  const date = col(info, sig.date)
  const rows = await session.query<AccountRow>(
    `select ${acct}::text as account_id, ${name ? `max(${col(info, name)}::text)` : 'null::text'} as name, count(*) as rows, ` +
      `left(min(${date})::text, 10) as first_date, left(max(${date})::text, 10) as last_date, ${syncedAtExpr(info)} as last_synced_at ` +
      `from ${rel} group by 1 order by count(*) desc limit ${MAX_ACCOUNTS_PER_TABLE + 1}`,
  )
  const truncated = rows.length > MAX_ACCOUNTS_PER_TABLE
  const accounts = rows.slice(0, MAX_ACCOUNTS_PER_TABLE).filter((r) => r.account_id !== null && r.account_id !== '')
  const level = sig.levels.find(([c]) => info.columns.has(c))?.[1] ?? 'account'
  const metrics = sig.metricsJson && info.columns.has(sig.metricsJson) ? await jsonKeys(session, info, sig.metricsJson) : metricColumns(sig, info)
  const dimensions = sig.dimensionsJson && info.columns.has(sig.dimensionsJson)
    ? (await jsonKeys(session, info, sig.dimensionsJson)).filter((k) => k !== sig.account && k !== sig.date && !k.endsWith('_id'))
    : [...info.columns.keys()].filter((c) => sig.isDimension(c)).sort()
  const dates = accounts.flatMap((a) => [a.first_date, a.last_date]).filter((d): d is string => d !== null).sort()
  const synced = accounts.map((a) => a.last_synced_at).filter((d): d is string => d !== null).sort()
  return {
    summary: {
      schema: info.schema, table: info.table, role: 'report', level,
      rows: accounts.reduce((s, a) => s + Number(a.rows), 0), accounts: accounts.length,
      first_date: dates[0] ?? null, last_date: dates[dates.length - 1] ?? null, last_synced_at: synced[synced.length - 1] ?? null,
      metrics, dimensions, error: null,
    },
    accounts,
    truncated,
  }
}

async function catalogNames(session: PgSession, m: Match): Promise<{ summary: TableSummary; names: Map<string, string> }> {
  const { sig, info } = m
  const name = sig.catalog.names.find((n) => info.columns.has(n))!
  const rows = await session.query<{ account_id: string | null; name: string | null }>(
    `select ${col(info, sig.account)}::text as account_id, max(${col(info, name)}::text) as name ` +
      `from ${quoteIdent(info.schema)}.${quoteIdent(info.table)} group by 1 limit 1000`,
  )
  const names = new Map<string, string>()
  for (const r of rows) if (r.account_id && r.name) names.set(r.account_id, r.name)
  return {
    summary: {
      schema: info.schema, table: info.table, role: 'catalog', level: null, rows: rows.length, accounts: names.size,
      first_date: null, last_date: null, last_synced_at: null, metrics: [], dimensions: [], error: null,
    },
    names,
  }
}

function emptySummary(m: Match, error: TableSummary['error']): TableSummary {
  return {
    schema: m.info.schema, table: m.info.table, role: m.role, level: null, rows: null, accounts: null,
    first_date: null, last_date: null, last_synced_at: null, metrics: [], dimensions: [], error,
  }
}

function tableError(err: unknown): TableSummary['error'] {
  if (err instanceof PgError) {
    if (err.kind === 'timeout') return 'timeout'
    if (err.kind === 'permission') return 'permission'
    if (err.kind === 'unreachable' || err.kind === 'auth') throw err // conexiunea s-a pierdut: nu mai are rost să continuăm
  }
  return 'failed'
}

/**
 * Inspecția completă. Erorile pe un tabel (timeout, drept lipsă) rămân pe tabel și nu opresc restul.
 * `deadline` (ms epoch): după el, tabelele rămase apar ca `skipped`, iar rezultatul e `truncated`.
 */
export async function inspect(session: PgSession, deadline: number, now: () => number = Date.now): Promise<Inspection> {
  const columns = await session.query<Column>(
    `select table_schema::text as "schema", table_name::text as "table", column_name::text as "column", data_type::text as data_type ` +
      `from information_schema.columns ` +
      `where table_schema not in (${SKIPPED_SCHEMAS.map((s) => `'${s}'`).join(', ')}) and table_schema not like 'pg\\_%' ` +
      `order by table_schema, table_name, ordinal_position`,
  )
  const matches = classify(groupTables(columns))
  let truncated = matches.length > MAX_TABLES
  const selected = matches.slice(0, MAX_TABLES)

  const tables = new Map<Platform, TableSummary[]>()
  const push = (p: Platform, t: TableSummary) => tables.set(p, [...(tables.get(p) ?? []), t])
  const accounts = new Map<string, AccountSummary>()
  const names = new Map<string, string>()

  // Cataloagele întâi (mici), apoi rapoartele.
  for (const m of [...selected.filter((x) => x.role === 'catalog'), ...selected.filter((x) => x.role === 'report')]) {
    if (now() > deadline) {
      push(m.sig.platform, emptySummary(m, 'skipped'))
      truncated = true
      continue
    }
    try {
      if (m.role === 'catalog') {
        const r = await catalogNames(session, m)
        for (const [id, n] of r.names) names.set(`${m.sig.platform}:${id}`, n)
        push(m.sig.platform, r.summary)
        continue
      }
      const r = await summarizeReport(session, m)
      truncated ||= r.truncated
      push(m.sig.platform, r.summary)
      for (const a of r.accounts) {
        const key = `${m.sig.platform}:${a.account_id}`
        const prev = accounts.get(key)
        const rows = Number(a.rows)
        if (!prev) {
          accounts.set(key, { platform: m.sig.platform, account_id: a.account_id!, name: a.name, rows, first_date: a.first_date, last_date: a.last_date, last_synced_at: a.last_synced_at, tables: 1 })
          continue
        }
        // Același cont în mai multe tabele (defalcări): perioada cea mai largă, rândurile din tabelul cel mai mare.
        prev.name ??= a.name
        prev.rows = Math.max(prev.rows, rows)
        prev.first_date = minDate(prev.first_date, a.first_date)
        prev.last_date = maxDate(prev.last_date, a.last_date)
        prev.last_synced_at = maxDate(prev.last_synced_at, a.last_synced_at)
        prev.tables += 1
      }
    } catch (err) {
      push(m.sig.platform, emptySummary(m, tableError(err)))
    }
  }

  for (const [key, a] of accounts) {
    const n = names.get(key)
    if (n) a.name = n
  }

  return {
    platforms: SIGNATURES.filter((s) => tables.has(s.platform)).map((s) => ({ platform: s.platform, label: s.label, tables: tables.get(s.platform)! })),
    accounts: [...accounts.values()].sort((a, b) => a.platform.localeCompare(b.platform) || (a.name ?? a.account_id).localeCompare(b.name ?? b.account_id, 'ro')),
    truncated,
  }
}

const minDate = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b)
const maxDate = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)
