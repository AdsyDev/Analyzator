// Rapoartele TikTok (report/integrated/get, BASIC, AUCTION_CAMPAIGN, pe zi) → paid_daily, aceleași chei ca importul CSV.
// Valorile vin ca string; absente → NULL, nu 0.

import { z } from 'zod'
import { addDaysIso } from '../google/dates.ts'
import { TIKTOK_SCHEMA_VERSION, TIKTOK_SOURCE } from './config.ts'

const str = z.union([z.string(), z.number()]).nullable().optional()

export const AdvertiserInfoSchema = z.object({ list: z.array(z.object({ advertiser_id: z.union([z.string(), z.number()]).optional(), name: z.string().optional(), currency: z.string(), timezone: z.string().optional(), display_timezone: z.string().optional() }).passthrough()).min(1) }).passthrough()

export const ReportRowSchema = z
  .object({
    dimensions: z.object({ campaign_id: z.union([z.string(), z.number()]), stat_time_day: z.string() }).passthrough(),
    metrics: z.object({ spend: str, impressions: str, clicks: str, conversion: str, campaign_name: z.string().nullable().optional() }).passthrough(),
  })
  .passthrough()
export const ReportSchema = z
  .object({ list: z.array(ReportRowSchema), page_info: z.object({ page: z.number(), total_page: z.number() }).passthrough() })
  .passthrough()

export type ReportRow = z.infer<typeof ReportRowSchema>

export function advertiserId(external: string): string | null {
  const v = external.trim()
  return /^\d{5,32}$/.test(v) ? v : null
}

/** Fereastra în bucăți de cel mult `max` zile (rapoartele zilnice au interval limitat). */
export function chunks(start: string, end: string, max: number): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = []
  let s = start
  while (s <= end) {
    const e = addDaysIso(s, max - 1) < end ? addDaysIso(s, max - 1) : end
    out.push({ start: s, end: e })
    s = addDaysIso(e, 1)
  }
  return out
}

function num(v: string | number | null | undefined, key: string, integer: boolean, notes: string[]): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n))) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return n
}

export type TtProvenance = { tenant_id: string; brand_id: string; source_id: string; sync_run_id: string; collected_at: string; payload_hash: string; source_timezone: string; currency: string; account_id: string; account_name: string | null }

export function paidRow(r: ReportRow, p: TtProvenance, notes: string[]) {
  return {
    tenant_id: p.tenant_id,
    brand_id: p.brand_id,
    source: TIKTOK_SOURCE,
    account_id: p.account_id,
    campaign_id: String(r.dimensions.campaign_id),
    ad_group_id: '',
    ad_id: '',
    date: r.dimensions.stat_time_day.slice(0, 10),
    breakdown_signature: 'none',
    attribution_config: 'unspecified',
    click_type: 'all',
    account_name: p.account_name,
    campaign_name: r.metrics.campaign_name ?? null,
    ad_group_name: null,
    ad_name: null,
    spend: num(r.metrics.spend, 'spend', false, notes),
    impressions: num(r.metrics.impressions, 'impressions', true, notes),
    clicks: num(r.metrics.clicks, 'clicks', true, notes),
    // „conversion” = conversiile pentru obiectivul de optimizare al campaniei (coloana Conversions din TikTok Ads Manager).
    conversions: num(r.metrics.conversion, 'conversion', false, notes),
    currency: p.currency,
    source_id: p.source_id,
    sync_run_id: p.sync_run_id,
    import_batch_id: null,
    row_number: null,
    collected_at: p.collected_at,
    collection_method: 'api',
    payload_hash: p.payload_hash,
    source_timezone: p.source_timezone,
    schema_version: TIKTOK_SCHEMA_VERSION,
  }
}
