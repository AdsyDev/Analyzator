// Rândurile BigQuery (o reclamă × o regiune) → rândurile din competitor_ads. Nimic nu se deduce: un câmp absent rămâne NULL,
// iar un rând fără identificatori valizi se sare cu motiv (regula 8).

import { createHash } from 'node:crypto'
import { ADS_SOURCE, BQ_TABLE, SCHEMA_VERSION } from './config.ts'

/**
 * Interogarea: doar coloanele folosite (costul BigQuery depinde de coloanele citite), regiunea ca JSON ca să nu depindem
 * de numele exacte ale câmpurilor din `region_stats` (citite tolerant în `regionFields`).
 */
export const CREATIVES_SQL = `
SELECT
  cs.advertiser_id,
  cs.advertiser_disclosed_name,
  cs.creative_id,
  cs.ad_format_type,
  cs.creative_page_url,
  rs.region_code,
  TO_JSON_STRING(rs) AS region_stats
FROM \`${BQ_TABLE}\` AS cs, UNNEST(cs.region_stats) AS rs
WHERE cs.advertiser_id IN UNNEST(@advertiser_ids) AND rs.region_code = @region
`.trim()

export const ADVERTISER_ID = /^AR[0-9]{5,40}$/
const CREATIVE_ID = /^[A-Za-z0-9_-]{1,128}$/
const REGION = /^[A-Z]{2}$/

export type AdSkipReason = 'advertiser_id' | 'creative_id' | 'region' | 'shown_interval'
export const AD_SKIP_LABELS: Record<AdSkipReason, string> = {
  advertiser_id: 'ID de advertiser lipsă sau invalid',
  creative_id: 'ID de reclamă lipsă sau invalid',
  region: 'regiune lipsă sau invalidă',
  shown_interval: 'prima afișare după ultima',
}

/** O dată calendaristică din DATE sau TIMESTAMP serializat („2026-11-02”, „2026-11-02T00:00:00”, „2026-11-02 00:00:00+00”). */
export function isoDateOf(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return m && !Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`)) ? m[1]! : null
}

/** Un număr întreg ≥ 0 (INT64 poate veni ca număr sau ca text). Orice altceva = NULL, nu 0. */
export function countOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : NaN
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

/** Câmpurile din `region_stats` (JSON), citite tolerant: un nume absent dă NULL. */
export function regionFields(json: string | null): { first_shown: string | null; last_shown: string | null; lower: number | null; upper: number | null } {
  let r: Record<string, unknown> = {}
  try {
    const parsed: unknown = json ? JSON.parse(json) : {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) r = parsed as Record<string, unknown>
  } catch {
    r = {}
  }
  const lower = countOf(r.times_shown_lower_bound)
  const upper = countOf(r.times_shown_upper_bound)
  const consistent = lower === null || upper === null || lower <= upper
  return { first_shown: isoDateOf(r.first_shown), last_shown: isoDateOf(r.last_shown), lower: consistent ? lower : null, upper: consistent ? upper : null }
}

export function formatOf(v: string | null): 'text' | 'image' | 'video' | 'unknown' {
  const f = (v ?? '').trim().toLowerCase()
  return f === 'text' || f === 'image' || f === 'video' ? f : 'unknown'
}

export type AdProvenance = { tenant_id: string; brand_id: string; source_id: string; sync_run_id: string; collected_at: string }
export type BqRecord = Record<string, string | null>

/** Rândurile brute pe nume de coloană (ordinea coloanelor vine din schema răspunsului, nu se presupune). */
export function recordsOf(fields: string[], rows: Array<Array<string | null>>): BqRecord[] {
  return rows.map((cells) => Object.fromEntries(fields.map((f, i) => [f, cells[i] ?? null])))
}

export function adRow(rec: BqRecord, p: AdProvenance): { ok: true; row: Record<string, unknown> } | { ok: false; reason: AdSkipReason } {
  const advertiser = (rec.advertiser_id ?? '').trim()
  const creative = (rec.creative_id ?? '').trim()
  const region = (rec.region_code ?? '').trim()
  if (!ADVERTISER_ID.test(advertiser)) return { ok: false, reason: 'advertiser_id' }
  if (!CREATIVE_ID.test(creative)) return { ok: false, reason: 'creative_id' }
  if (!REGION.test(region)) return { ok: false, reason: 'region' }
  const shown = regionFields(rec.region_stats ?? null)
  if (shown.first_shown && shown.last_shown && shown.first_shown > shown.last_shown) return { ok: false, reason: 'shown_interval' }
  const url = (rec.creative_page_url ?? '').trim()
  const name = (rec.advertiser_disclosed_name ?? '').trim()
  return {
    ok: true,
    row: {
      tenant_id: p.tenant_id,
      brand_id: p.brand_id,
      source: ADS_SOURCE,
      advertiser_id: advertiser,
      advertiser_name: name ? name.slice(0, 512) : null,
      native_ad_id: creative,
      region_code: region,
      format: formatOf(rec.ad_format_type ?? null),
      first_shown: shown.first_shown,
      last_shown: shown.last_shown,
      times_shown_lower: shown.lower,
      times_shown_upper: shown.upper,
      source_url: /^https:\/\/adstransparency\.google\.com\//.test(url) && url.length <= 2048 ? url : null,
      last_seen: p.collected_at,
      source_id: p.source_id,
      sync_run_id: p.sync_run_id,
      collected_at: p.collected_at,
      payload_hash: createHash('sha256').update(JSON.stringify(rec)).digest('hex'),
      schema_version: SCHEMA_VERSION,
    },
  }
}
