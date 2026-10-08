// Normalizarea răspunsurilor GA4 și GSC în rânduri tipizate. Funcții pure.
// Reguli: o metrică absentă din răspuns = NULL (nu 0); "0" primit de la sursă = 0 real; nu se deduc câmpuri lipsă;
// un rând invalid se sare cu o notă, nu cu o valoare inventată.

import { createHash } from 'node:crypto'
import type { Row } from '../shared/supabase-rest.ts'
import type { Ga4Report, GscResponse } from './schemas.ts'

export type Issue = { code: string; message: string }

export type Ctx = {
  tenant_id: string
  brand_id: string
  source_id: string
  sync_run_id: string | null
  collected_at: string
  payload_hash: string
  source_timezone: string
  schema_version: string
}

export const sha256 = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const md5 = (value: string): string => createHash('md5').update(value).digest('hex')

const provenance = (ctx: Ctx, windowDays: number | null): Row => ({
  source_id: ctx.source_id,
  sync_run_id: ctx.sync_run_id,
  collected_at: ctx.collected_at,
  collection_method: 'api',
  payload_hash: ctx.payload_hash,
  ...(windowDays === null ? {} : { window_days: windowDays }),
  source_timezone: ctx.source_timezone,
  schema_version: ctx.schema_version,
})

const scope = (ctx: Ctx): Row => ({ tenant_id: ctx.tenant_id, brand_id: ctx.brand_id })

/** "20261006" → "2026-10-06"; orice altă formă → null. */
export function ga4Date(value: string | null | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso
}

function parseNumber(raw: string | null | undefined, integer: boolean): { value: number | null; bad: boolean } {
  if (raw === undefined || raw === null || raw === '') return { value: null, bad: false }
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) return { value: null, bad: true }
  return { value: n, bad: false }
}

type Columns = { dim: Map<string, number>; met: Map<string, number> }

function columns(report: Ga4Report): Columns {
  const dim = new Map<string, number>()
  const met = new Map<string, number>()
  ;(report.dimensionHeaders ?? []).forEach((h, i) => dim.set(h.name, i))
  ;(report.metricHeaders ?? []).forEach((h, i) => met.set(h.name, i))
  return { dim, met }
}

function missingHeaders(c: Columns, dims: string[]): string[] {
  return dims.filter((d) => !c.dim.has(d))
}

function metricAt(c: Columns, row: NonNullable<Ga4Report['rows']>[number], name: string, integer: boolean, issues: Issue[]): number | null {
  const idx = c.met.get(name)
  if (idx === undefined) return null // metrică ne-cerută (de ex. eliminată pentru incompatibilitate) → NULL
  const parsed = parseNumber(row.metricValues?.[idx]?.value, integer)
  if (parsed.bad) issues.push({ code: 'invalid_metric_value', message: `${name}: valoare invalidă ${JSON.stringify(row.metricValues?.[idx]?.value)} → NULL` })
  return parsed.value
}

const dimAt = (row: NonNullable<Ga4Report['rows']>[number], c: Columns, name: string): string | null => {
  const v = row.dimensionValues?.[c.dim.get(name)!]?.value
  return v === undefined || v === null || v === '' ? null : v
}

export function normalizeGa4Daily(report: Ga4Report, ctx: Ctx): { rows: Row[]; issues: Issue[] } {
  const issues: Issue[] = []
  const c = columns(report)
  const need = ['date', 'sessionDefaultChannelGroup', 'sessionSourceMedium', 'landingPagePlusQueryString']
  const missing = missingHeaders(c, need)
  if (missing.length) return { rows: [], issues: [{ code: 'missing_dimension_header', message: `lipsesc dimensiunile: ${missing.join(', ')}` }] }

  const rows: Row[] = []
  for (const r of report.rows ?? []) {
    const date = ga4Date(dimAt(r, c, 'date'))
    const channel = dimAt(r, c, 'sessionDefaultChannelGroup')
    const sourceMedium = dimAt(r, c, 'sessionSourceMedium')
    const landing = dimAt(r, c, 'landingPagePlusQueryString')
    if (!date || !channel || !sourceMedium || !landing) {
      issues.push({ code: 'invalid_row', message: 'rând fără dată sau dimensiune validă; sărit' })
      continue
    }
    if (landing.length > 4096 || sourceMedium.length > 512 || channel.length > 256) {
      issues.push({ code: 'dimension_too_long', message: `rând sărit (dimensiune prea lungă, ${date})` })
      continue
    }
    rows.push({
      ...scope(ctx),
      date,
      channel_group: channel,
      source_medium: sourceMedium,
      landing_page: landing,
      landing_page_md5: md5(landing),
      sessions: metricAt(c, r, 'sessions', true, issues),
      engaged_sessions: metricAt(c, r, 'engagedSessions', true, issues),
      key_events: metricAt(c, r, 'keyEvents', false, issues),
      active_users_not_additive: metricAt(c, r, 'activeUsers', true, issues),
      ...provenance(ctx, 1),
    })
  }
  return { rows, issues }
}

export function normalizeGa4KeyEvents(report: Ga4Report, ctx: Ctx): { rows: Row[]; issues: Issue[] } {
  const issues: Issue[] = []
  const c = columns(report)
  const missing = missingHeaders(c, ['date', 'eventName'])
  if (missing.length) return { rows: [], issues: [{ code: 'missing_dimension_header', message: `lipsesc dimensiunile: ${missing.join(', ')}` }] }
  const rows: Row[] = []
  for (const r of report.rows ?? []) {
    const date = ga4Date(dimAt(r, c, 'date'))
    const eventName = dimAt(r, c, 'eventName')
    if (!date || !eventName || eventName.length > 256) {
      issues.push({ code: 'invalid_row', message: 'rând fără dată sau eventName valid; sărit' })
      continue
    }
    rows.push({ ...scope(ctx), date, event_name: eventName, key_events: metricAt(c, r, 'keyEvents', false, issues), ...provenance(ctx, 1) })
  }
  return { rows, issues }
}

/** Raport fără dimensiuni pe un interval: o singură valoare. Zero rânduri = necunoscut (nu zero). */
export function normalizeGa4ActiveUsers(
  report: Ga4Report,
  ctx: Ctx,
  interval: { start: string; end: string },
): { rows: Row[]; issues: Issue[] } {
  const issues: Issue[] = []
  const c = columns(report)
  if (!c.met.has('activeUsers')) return { rows: [], issues: [{ code: 'missing_metric_header', message: 'lipsește activeUsers' }] }
  const rows = report.rows ?? []
  if (rows.length === 0) return { rows: [], issues: [{ code: 'empty_report', message: `fără rânduri pentru ${interval.start}..${interval.end}: valoarea rămâne necunoscută` }] }
  if (rows.length > 1) issues.push({ code: 'unexpected_rows', message: `${rows.length} rânduri la un raport fără dimensiuni; se folosește primul` })
  const value = metricAt(c, rows[0]!, 'activeUsers', true, issues)
  return {
    rows: [{ ...scope(ctx), interval_start: interval.start, interval_end: interval.end, active_users: value, ...provenance(ctx, null) }],
    issues,
  }
}

/** Totaluri raportate de sursă pe un interval (raport fără dimensiuni). */
export function parseGa4Totals(report: Ga4Report, names: string[]): { totals: Record<string, number | null>; issues: Issue[] } {
  const issues: Issue[] = []
  const c = columns(report)
  const row = report.rows?.[0]
  const totals: Record<string, number | null> = {}
  for (const n of names) {
    if (!row || !c.met.has(n)) totals[n] = null
    else totals[n] = metricAt(c, row, n, false, issues)
  }
  return { totals, issues }
}

// --- Search Console -------------------------------------------------------------------------------------

const DEVICES = new Set(['DESKTOP', 'MOBILE', 'TABLET'])

function gscMetrics(r: NonNullable<GscResponse['rows']>[number], issues: Issue[]): { clicks: number | null; impressions: number | null; ctr_reported: number | null; position: number | null } {
  const nonNeg = (v: number | null | undefined, name: string, max = Infinity) => {
    if (v === undefined || v === null) return null
    if (!Number.isFinite(v) || v < 0 || v > max) {
      issues.push({ code: 'invalid_metric_value', message: `${name}: ${v} → NULL` })
      return null
    }
    return v
  }
  return {
    clicks: nonNeg(r.clicks, 'clicks'),
    impressions: nonNeg(r.impressions, 'impressions'),
    ctr_reported: nonNeg(r.ctr, 'ctr', 1),
    position: nonNeg(r.position, 'position'),
  }
}

const isoDate = (v: string | undefined): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

export function normalizeGscDaily(res: GscResponse, ctx: Ctx, dataState: 'final' | 'all'): { rows: Row[]; issues: Issue[] } {
  const issues: Issue[] = []
  const rows: Row[] = []
  for (const r of res.rows ?? []) {
    const date = isoDate(r.keys?.[0])
    const device = r.keys?.[1]?.toUpperCase()
    if (!date || !device || !DEVICES.has(device) || (r.keys?.length ?? 0) !== 2) {
      issues.push({ code: 'invalid_row', message: `rând cu chei invalide ${JSON.stringify(r.keys)}; sărit` })
      continue
    }
    rows.push({ ...scope(ctx), date, device, ...gscMetrics(r, issues), data_state: dataState, ...provenance(ctx, 1) })
  }
  return { rows, issues }
}

export function normalizeGscQueries(res: GscResponse, ctx: Ctx, dataState: 'final' | 'all'): { rows: Row[]; issues: Issue[] } {
  const issues: Issue[] = []
  const rows: Row[] = []
  for (const r of res.rows ?? []) {
    const [k0, query, page, k3] = r.keys ?? []
    const date = isoDate(k0)
    const device = k3?.toUpperCase()
    if (!date || !query || !page || !device || !DEVICES.has(device) || (r.keys?.length ?? 0) !== 4 || query.length > 4096 || page.length > 4096) {
      issues.push({ code: 'invalid_row', message: 'rând query/page cu chei invalide; sărit' })
      continue
    }
    rows.push({
      ...scope(ctx), date, device, query, query_md5: md5(query), page, page_md5: md5(page),
      ...gscMetrics(r, issues), data_state: dataState, ...provenance(ctx, 1),
    })
  }
  return { rows, issues }
}

/** Totaluri pe zi (dimensiunea date, fără query): referința pentru reconciliere. */
export function parseGscDateTotals(res: GscResponse): { byDate: Map<string, { clicks: number | null; impressions: number | null }>; issues: Issue[] } {
  const issues: Issue[] = []
  const byDate = new Map<string, { clicks: number | null; impressions: number | null }>()
  for (const r of res.rows ?? []) {
    const date = isoDate(r.keys?.[0])
    if (!date || (r.keys?.length ?? 0) !== 1) {
      issues.push({ code: 'invalid_row', message: 'rând de totaluri cu cheie invalidă; sărit' })
      continue
    }
    const m = gscMetrics(r, issues)
    byDate.set(date, { clicks: m.clicks, impressions: m.impressions })
  }
  return { byDate, issues }
}
