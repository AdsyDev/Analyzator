// Răspunsurile googleAds:search → rânduri paid_daily (aceleași chei ca importul CSV Google Ads), la nivel de campanie.
// JSON-ul REST e mapat din proto3: un câmp numeric cu valoare 0 poate lipsi din răspuns. Un câmp CERUT în interogare,
// absent dintr-un rând întors, înseamnă deci 0 (semantica documentată proto3), nu „necunoscut”; se raportează ca notă,
// ca să se poată verifica la prima rulare. Costul vine în micro-unități (cost_micros / 1.000.000).

import { z } from 'zod'
import { GOOGLE_ADS_SCHEMA_VERSION, GOOGLE_ADS_SOURCE } from './config.ts'

const int64 = z.union([z.string(), z.number()]).optional()

export const CustomerSchema = z
  .object({ results: z.array(z.object({ customer: z.object({ id: int64, descriptiveName: z.string().optional(), currencyCode: z.string(), timeZone: z.string() }).passthrough() }).passthrough()).min(1) })
  .passthrough()

export const CampaignRowSchema = z
  .object({
    segments: z.object({ date: z.string() }).passthrough(),
    campaign: z.object({ id: int64, name: z.string().optional() }).passthrough(),
    metrics: z.object({ costMicros: int64, impressions: int64, clicks: int64, conversions: z.number().optional() }).passthrough().optional(),
  })
  .passthrough()
export const SearchSchema = z.object({ results: z.array(CampaignRowSchema).optional(), nextPageToken: z.string().optional() }).passthrough()

export type CampaignRow = z.infer<typeof CampaignRowSchema>

/** `123-456-7890` sau `1234567890` → `1234567890`. */
export function customerId(external: string): string | null {
  const d = external.replace(/-/g, '').trim()
  return /^\d{10}$/.test(d) ? d : null
}

function nonNegInt(v: string | number | undefined, key: string, notes: string[]): number | null {
  if (v === undefined) {
    notes.push(`${key} absent din rând → 0 (proto3)`)
    return 0
  }
  const n = typeof v === 'number' ? v : /^\d+$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(n) || n < 0) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return n
}

export type AdsProvenance = { tenant_id: string; brand_id: string; source_id: string; sync_run_id: string; collected_at: string; payload_hash: string; source_timezone: string; currency: string; account_id: string; account_name: string | null }

export function paidRow(r: CampaignRow, p: AdsProvenance, notes: string[]) {
  const m = r.metrics ?? {}
  const micros = nonNegInt(m.costMicros, 'cost_micros', notes)
  const conversions = m.conversions === undefined ? (notes.push('conversions absent din rând → 0 (proto3)'), 0) : m.conversions >= 0 ? m.conversions : null
  return {
    tenant_id: p.tenant_id,
    brand_id: p.brand_id,
    source: GOOGLE_ADS_SOURCE,
    account_id: p.account_id,
    campaign_id: String(r.campaign.id ?? `name:${r.campaign.name ?? ''}`),
    // Nivel campanie (ca exportul CSV la nivel de campanie): grupul și reclama sunt goale.
    ad_group_id: '',
    ad_id: '',
    date: r.segments.date,
    breakdown_signature: 'none',
    attribution_config: 'unspecified',
    click_type: 'all',
    account_name: p.account_name,
    campaign_name: r.campaign.name ?? null,
    ad_group_name: null,
    ad_name: null,
    spend: micros === null ? null : micros / 1_000_000,
    impressions: nonNegInt(m.impressions, 'impressions', notes),
    clicks: nonNegInt(m.clicks, 'clicks', notes),
    // „Conversions” din Google Ads = conversiile principale, după setările contului.
    conversions,
    currency: p.currency,
    source_id: p.source_id,
    sync_run_id: p.sync_run_id,
    import_batch_id: null,
    row_number: null,
    collected_at: p.collected_at,
    collection_method: 'api',
    payload_hash: p.payload_hash,
    source_timezone: p.source_timezone,
    schema_version: GOOGLE_ADS_SCHEMA_VERSION,
  }
}
