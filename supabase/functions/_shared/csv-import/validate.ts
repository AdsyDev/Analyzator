// Validarea rând cu rând a unui CSV, pe baza contractului sursei. Fără dependențe.
// Reguli: valoare lipsă = NULL (nu 0); numere cu punct zecimal și fără separator de mii; date ISO;
// duplicate în fișier respinse (primul rămâne); rândurile „Total” se ignoră; nimic nu se deduce.

import { CONTRACTS, normalizeHeader, type Column, type SourceContract, type SourceId } from './contracts.ts'

export type Target = 'paid_daily' | 'social_daily' | 'social_posts' | 'mentions'

export type Declared = {
  currency?: string
  timezone: string
  attribution_config?: string
  click_type?: string
}

export type StagedRow = {
  row_number: number
  status: 'accepted' | 'rejected'
  reason: string | null
  target: Target | null
  data: Record<string, unknown> | null
}

export type ValidationResult = {
  ok: boolean
  errors: string[]
  header_row: number
  column_map: Record<string, string>
  ignored_columns: string[]
  rows: StagedRow[]
  skipped: number
  period: { start: string; end: string } | null
  total: number
}

type Values = Record<string, string | null>

// --- parsare de valori -----------------------------------------------------------------------------------------------

export function parseDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value
}

const AMBIGUOUS_NUMBER = /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+,\d+$|^\d{1,3}(,\d{3})+(\.\d+)?$/

function parseNumber(value: string, integer: boolean): { value: number } | { error: string } {
  if (AMBIGUOUS_NUMBER.test(value)) return { error: 'format numeric neacceptat (punct zecimal, fără separator de mii)' }
  if (!/^\d+(\.\d+)?$/.test(value)) return { error: 'valoare numerică invalidă (doar cifre, punct zecimal, fără semn)' }
  const n = Number(value)
  if (!Number.isFinite(n)) return { error: 'valoare numerică invalidă' }
  if (integer && !Number.isInteger(n)) return { error: 'se așteaptă un număr întreg' }
  return { value: n }
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** ISO 8601 cu offset/Z, sau data-ora locală (fără offset) în fusul declarat → ISO UTC. */
export function parseDateTime(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number]
  if (!parseDate(`${m[1]}-${m[2]}-${m[3]}`) || h > 23 || mi > 59 || s > 59) return null
  const local = Date.UTC(y, mo - 1, d, h, mi, s)
  let utc: number
  if (m[7]) {
    if (m[7] === 'Z') utc = local
    else {
      const sign = m[7][0] === '-' ? -1 : 1
      const digits = m[7].slice(1).replace(':', '')
      utc = local - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000
    }
  } else {
    utc = local - tzOffsetMs(local, timeZone)
    utc = local - tzOffsetMs(utc, timeZone) // a doua trecere, pentru zilele cu schimbarea orei
  }
  return new Date(utc).toISOString()
}

export function todayIn(now: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}`
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// --- antet -------------------------------------------------------------------------------------------------------------

const headerKey = (s: string) => normalizeHeader(s).replace(/_/g, ' ')

type Mapping = { map: Record<string, string>; byIndex: Map<number, string>; ignored: string[]; errors: string[]; headerCurrency: string | null }

function mapHeader(contract: SourceContract, cells: string[]): Mapping {
  const lookup = new Map<string, string>()
  for (const c of contract.columns) {
    lookup.set(headerKey(c.key), c.key)
    for (const a of c.aliases ?? []) lookup.set(headerKey(a), c.key)
  }
  const map: Record<string, string> = {}
  const byIndex = new Map<number, string>()
  const ignored: string[] = []
  const errors: string[] = []
  let headerCurrency: string | null = null
  cells.forEach((cell, i) => {
    const raw = cell.replace(/^﻿/, '').trim()
    if (raw === '') return
    let key = lookup.get(headerKey(raw))
    if (!key) {
      for (const p of contract.headerPatterns ?? []) {
        const m = p.pattern.exec(raw.replace(/\s+/g, ' '))
        if (m) {
          key = p.key
          if (p.currencyGroup && m[p.currencyGroup]) headerCurrency = m[p.currencyGroup]!.toUpperCase()
          break
        }
      }
    }
    if (!key) {
      ignored.push(raw)
      return
    }
    if (map[key] !== undefined) {
      errors.push(`coloane ambigue pentru „${key}”: „${map[key]}” și „${raw}”`)
      return
    }
    map[key] = raw
    byIndex.set(i, key)
  })
  return { map, byIndex, ignored, errors, headerCurrency }
}

function requiredMissing(contract: SourceContract, map: Record<string, string>): string[] {
  const missing = contract.columns.filter((c) => c.required === true && !map[c.key]).map((c) => c.key)
  if (contract.family === 'paid' && !map.campaign_id && !map.campaign_name) missing.push('campaign_id sau campaign_name')
  return missing
}

// --- rânduri -------------------------------------------------------------------------------------------------------------

type Built = { target: Target; data: Record<string, unknown>; key: string; date: string } | { reason: string }

const TEXT_MAX = 512
function text(v: string | null | undefined, max = TEXT_MAX): { value: string | null } | { error: string } {
  if (v === null || v === undefined) return { value: null }
  if (v.length > max) return { error: `text prea lung (peste ${max} de caractere)` }
  return { value: v }
}

function metric(values: Values, key: string, integer: boolean, errors: string[]): number | null {
  const v = values[key]
  if (v === null || v === undefined) return null
  const r = parseNumber(v, integer)
  if ('error' in r) {
    errors.push(`${key}: ${r.error} („${v}”)`)
    return null
  }
  return r.value
}

function buildPaid(contract: SourceContract, values: Values, declared: Declared, today: string): Built {
  const errors: string[] = []
  const dateRaw = values.date
  const date = dateRaw ? parseDate(dateRaw) : null
  if (!date) errors.push(`date: dată invalidă „${dateRaw ?? ''}” (se așteaptă YYYY-MM-DD)`)
  else if (date > today) errors.push(`date: ${date} e în viitor (azi ${today} în ${declared.timezone})`)

  const campaignId = values.campaign_id ?? (values.campaign_name ? `name:${values.campaign_name}` : null)
  if (!campaignId) errors.push('campania lipsește (campaign_id sau campaign_name)')
  const adGroupId = values.ad_group_id ?? (values.ad_group_name ? `name:${values.ad_group_name}` : '')
  const adId = values.ad_id ?? (values.ad_name ? `name:${values.ad_name}` : '')
  for (const [k, v] of [['campaign_id', campaignId], ['ad_group_id', adGroupId], ['ad_id', adId], ['account_id', values.account_id]] as const) {
    if (v && v.length > TEXT_MAX) errors.push(`${k}: text prea lung`)
  }
  for (const k of ['account_name', 'campaign_name', 'ad_group_name', 'ad_name']) {
    const t = text(values[k] ?? null)
    if ('error' in t) errors.push(`${k}: ${t.error}`)
  }

  const rowCurrency = values.currency?.toUpperCase()
  if (rowCurrency && rowCurrency !== declared.currency) {
    errors.push(`currency: moneda rândului (${rowCurrency}) diferă de cea declarată pe lot (${declared.currency})`)
  }

  const spend = metric(values, 'spend', false, errors)
  const impressions = metric(values, 'impressions', true, errors)
  const clicks = metric(values, 'clicks', true, errors)
  const conversions = metric(values, 'conversions', false, errors)
  if (errors.length === 0 && spend === null && impressions === null && clicks === null && conversions === null) {
    errors.push('rând fără nicio metrică (cost, afișări, clicks, conversii)')
  }
  const breakdown = values.breakdown ? values.breakdown.toLowerCase().slice(0, 128) : 'none'
  if (values.breakdown && values.breakdown.length > 128) errors.push('breakdown: text prea lung (peste 128 de caractere)')
  if (errors.length > 0) return { reason: errors.join('; ') }

  const attribution = declared.attribution_config ?? 'unspecified'
  const data = {
    date, account_id: values.account_id ?? '', account_name: values.account_name ?? null,
    campaign_id: campaignId, campaign_name: values.campaign_name ?? null,
    ad_group_id: adGroupId, ad_group_name: values.ad_group_name ?? null,
    ad_id: adId, ad_name: values.ad_name ?? null,
    spend, impressions, clicks, conversions,
    breakdown_signature: breakdown, attribution_config: attribution, click_type: declared.click_type ?? 'unspecified',
  }
  const key = [contract.source, data.account_id, campaignId, adGroupId, adId, date, breakdown, attribution].join('\u001f')
  return { target: 'paid_daily', data, key, date: date! }
}

function buildSocial(values: Values, declared: Declared, today: string, nowIso: string): Built {
  const errors: string[] = []
  const level = values.level
  if (level !== 'daily' && level !== 'post') return { reason: `level: „${level ?? ''}” nu e valid (daily sau post)` }
  const platform = values.platform?.toLowerCase() ?? null
  if (!platform || !/^[a-z0-9_]+$/.test(platform)) errors.push(`platform: „${values.platform ?? ''}” invalid (litere mici, cifre, underscore)`)
  const accountId = values.account_id
  if (!accountId) errors.push('account_id lipsește')
  else if (accountId.length > 256) errors.push('account_id: text prea lung')

  const metrics = {
    impressions: metric(values, 'impressions', true, errors),
    reach_not_additive: metric({ ...values, reach_not_additive: values.reach ?? null }, 'reach_not_additive', true, errors),
    engagements: metric(values, 'engagements', true, errors),
    likes: metric(values, 'likes', true, errors),
    comments: metric(values, 'comments', true, errors),
    shares: metric(values, 'shares', true, errors),
    saves: metric(values, 'saves', true, errors),
    link_clicks: metric(values, 'link_clicks', true, errors),
    video_views: metric(values, 'video_views', true, errors),
  }
  const followers = metric(values, 'followers', true, errors)
  const anyMetric = Object.values(metrics).some((v) => v !== null) || (level === 'daily' && followers !== null)

  if (level === 'daily') {
    const date = values.date ? parseDate(values.date) : null
    if (!date) errors.push(`date: dată invalidă „${values.date ?? ''}” (se așteaptă YYYY-MM-DD)`)
    else if (date > today) errors.push(`date: ${date} e în viitor`)
    if (errors.length === 0 && !anyMetric) errors.push('rând fără nicio metrică')
    if (errors.length > 0) return { reason: errors.join('; ') }
    const an = text(values.account_name)
    if ('error' in an) return { reason: `account_name: ${an.error}` }
    return {
      target: 'social_daily',
      data: { platform, account_id: accountId, account_name: values.account_name, date, followers, ...metrics },
      key: ['daily', platform, accountId, date].join('\u001f'),
      date: date!,
    }
  }

  const postId = values.post_id
  if (!postId) errors.push('post_id lipsește')
  else if (postId.length > 512) errors.push('post_id: text prea lung')
  const published = values.published_at ? parseDateTime(values.published_at, declared.timezone) : null
  if (!published) errors.push(`published_at: dată-oră invalidă „${values.published_at ?? ''}” (ISO 8601)`)
  else if (published > nowIso) errors.push('published_at: în viitor')
  const snapshot = values.snapshot_date ? parseDate(values.snapshot_date) : null
  if (!snapshot) errors.push(`snapshot_date: dată invalidă „${values.snapshot_date ?? ''}” (YYYY-MM-DD)`)
  else if (snapshot > today) errors.push('snapshot_date: în viitor')
  const scope = values.metrics_scope
  if (scope !== 'lifetime' && scope !== 'period') errors.push(`metrics_scope: „${scope ?? ''}” nu e valid (lifetime sau period)`)
  if (values.post_url && !/^https?:\/\/\S+$/.test(values.post_url)) errors.push('post_url: nu e un URL http(s)')
  if (values.post_text && values.post_text.length > 10_000) errors.push('post_text: text prea lung (peste 10.000 de caractere)')
  if (errors.length === 0 && !anyMetric) errors.push('rând fără nicio metrică')
  if (errors.length > 0) return { reason: errors.join('; ') }
  return {
    target: 'social_posts',
    data: {
      platform, account_id: accountId, post_id: postId, snapshot_date: snapshot, metrics_scope: scope, published_at: published,
      post_url: values.post_url, post_text: values.post_text, ...metrics,
    },
    key: ['post', platform, accountId, postId, snapshot, scope].join('\u001f'),
    date: published!.slice(0, 10),
  }
}

async function buildMention(values: Values, declared: Declared, nowIso: string): Promise<Built> {
  const errors: string[] = []
  const url = values.url
  if (!url) errors.push('url lipsește')
  else if (!/^https?:\/\/\S+$/.test(url)) errors.push(`url: „${url.slice(0, 80)}” nu e un URL http(s)`)
  else if (url.length > 2048) errors.push('url: peste 2048 de caractere')
  const published = values.published_at ? parseDateTime(values.published_at, declared.timezone) : null
  if (!published) errors.push(`published_at: dată-oră invalidă „${values.published_at ?? ''}” (ISO 8601)`)
  else if (published > nowIso) errors.push('published_at: în viitor')
  const sentimentRaw = values.sentiment?.toLowerCase() ?? null
  if (sentimentRaw !== null && !['positive', 'neutral', 'negative', 'unknown'].includes(sentimentRaw)) {
    errors.push(`sentiment: „${values.sentiment}” nu e valid (positive, neutral, negative, unknown)`)
  }
  if (values.language && !/^[a-z]{2,3}$/.test(values.language)) errors.push('language: cod ISO 639 în litere mici')
  if (values.country && !/^[A-Z]{2}$/.test(values.country)) errors.push('country: cod ISO 3166-1 alpha-2 în majuscule')
  if (values.text && values.text.length > 20_000) errors.push('text: peste 20.000 de caractere')
  const sn = text(values.source_name, 256)
  if ('error' in sn) errors.push(`source_name: ${sn.error}`)
  if (values.native_id && values.native_id.length > 512) errors.push('native_id: text prea lung')
  if (errors.length > 0) return { reason: errors.join('; ') }
  const nativeId = values.native_id ?? `h:${(await sha256Hex(url!)).slice(0, 32)}`
  return {
    target: 'mentions',
    data: {
      native_id: nativeId, url, source_name: values.source_name, published_at: published, text: values.text,
      sentiment: sentimentRaw ?? 'unknown', language: values.language, country: values.country,
    },
    key: nativeId,
    date: published!.slice(0, 10),
  }
}

// --- punctul de intrare ------------------------------------------------------------------------------------------------------

export const MAX_HEADER_SCAN = 15

export async function validateTable(source: SourceId, table: string[][], declared: Declared, now: Date): Promise<ValidationResult> {
  const contract = CONTRACTS[source]
  const fail = (errors: string[], headerRow = 0, extra: Partial<ValidationResult> = {}): ValidationResult => ({
    ok: false, errors, header_row: headerRow, column_map: {}, ignored_columns: [], rows: [], skipped: 0, period: null, total: 0, ...extra,
  })
  if (table.length === 0) return fail(['fișierul nu conține rânduri'])

  // Antetul: primul rând (din primele 15) care conține coloanele obligatorii.
  let headerIndex = -1
  let mapping: Mapping | null = null
  let firstMissing: string[] = []
  for (let i = 0; i < Math.min(table.length, MAX_HEADER_SCAN); i++) {
    const m = mapHeader(contract, table[i]!)
    const missing = requiredMissing(contract, m.map)
    if (i === 0) firstMissing = missing
    if (missing.length === 0) {
      headerIndex = i
      mapping = m
      break
    }
  }
  if (!mapping) return fail([`coloane obligatorii lipsă: ${firstMissing.join(', ')}`], 1)
  if (mapping.errors.length) return fail(mapping.errors, headerIndex + 1, { column_map: mapping.map, ignored_columns: mapping.ignored })
  if (mapping.headerCurrency && declared.currency && mapping.headerCurrency !== declared.currency) {
    return fail(
      [`moneda din antetul de cost (${mapping.headerCurrency}) diferă de cea declarată pe lot (${declared.currency})`],
      headerIndex + 1, { column_map: mapping.map, ignored_columns: mapping.ignored },
    )
  }

  const today = todayIn(now, declared.timezone)
  const nowIso = now.toISOString()
  const rows: StagedRow[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  let start: string | null = null
  let end: string | null = null

  for (let r = headerIndex + 1; r < table.length; r++) {
    const cells = table[r]!
    const rowNumber = r + 1
    const first = cells.find((c) => c.trim() !== '')?.trim().toLowerCase() ?? ''
    if ((contract.skipRowPrefixes ?? []).some((p) => first.startsWith(p))) {
      skipped++
      continue
    }
    const values: Values = {}
    for (const [index, key] of mapping.byIndex) {
      const v = (cells[index] ?? '').trim()
      values[key] = v === '' ? null : v
    }

    const built: Built =
      contract.family === 'paid' ? buildPaid(contract, values, declared, today)
      : contract.family === 'social' ? buildSocial(values, declared, today, nowIso)
      : await buildMention(values, declared, nowIso)

    if ('reason' in built) {
      rows.push({ row_number: rowNumber, status: 'rejected', reason: built.reason, target: null, data: null })
      continue
    }
    const previous = seen.get(built.key)
    if (previous !== undefined) {
      rows.push({ row_number: rowNumber, status: 'rejected', reason: `duplicat în fișier (aceeași cheie ca rândul ${previous})`, target: null, data: null })
      continue
    }
    seen.set(built.key, rowNumber)
    rows.push({ row_number: rowNumber, status: 'accepted', reason: null, target: built.target, data: built.data })
    if (start === null || built.date < start) start = built.date
    if (end === null || built.date > end) end = built.date
  }

  return {
    ok: true, errors: [], header_row: headerIndex + 1, column_map: mapping.map, ignored_columns: mapping.ignored,
    rows, skipped, period: start && end ? { start, end } : null, total: rows.length,
  }
}

export type { Column }
