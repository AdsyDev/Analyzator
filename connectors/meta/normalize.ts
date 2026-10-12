// Răspunsurile Meta /insights → rânduri paid_daily (aceleași chei ca importul CSV Meta Ads).
// Meta trimite valorile numerice ca string; absente → NULL, nu 0. Conversiile rămân NULL (vezi contractul: „Results”
// depinde de obiectivul campaniei; acțiunea de conversie nu se alege implicit).

import { z } from 'zod'
import { META_SCHEMA_VERSION, META_SOURCE } from './config.ts'

const str = z.string().nullable().optional()

export const AccountSchema = z.object({ id: z.string(), name: str, currency: z.string(), timezone_name: z.string() }).passthrough()

export const InsightRowSchema = z
  .object({
    date_start: z.string(),
    account_id: z.string(),
    account_name: str,
    campaign_id: str,
    campaign_name: str,
    adset_id: str,
    adset_name: str,
    ad_id: str,
    ad_name: str,
    spend: str,
    impressions: str,
    clicks: str,
    account_currency: str,
  })
  .passthrough()
export const InsightsSchema = z
  .object({ data: z.array(InsightRowSchema), paging: z.object({ next: z.string().optional() }).passthrough().optional() })
  .passthrough()

export type InsightRow = z.infer<typeof InsightRowSchema>

/** `act_123` sau `123` → `123` (forma din câmpul account_id al raportului). */
export function accountNumber(external: string): string | null {
  const m = /^(?:act_)?(\d{1,32})$/.exec(external.trim())
  return m ? m[1]! : null
}

function decimal(v: string | null | undefined, key: string, notes: string[]): number | null {
  if (v === undefined || v === null || v === '') return null
  if (!/^\d+(\.\d+)?$/.test(v)) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return Number(v)
}

function integer(v: string | null | undefined, key: string, notes: string[]): number | null {
  if (v === undefined || v === null || v === '') return null
  if (!/^\d+$/.test(v)) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return Number(v)
}

export type MetaProvenance = {
  tenant_id: string
  brand_id: string
  source_id: string
  sync_run_id: string
  collected_at: string
  payload_hash: string
  source_timezone: string
  currency: string
}

export function paidRow(r: InsightRow, p: MetaProvenance, notes: string[]) {
  const rowCurrency = r.account_currency ?? p.currency
  if (rowCurrency !== p.currency) notes.push(`moneda rândului (${rowCurrency}) diferă de moneda contului (${p.currency})`)
  return {
    tenant_id: p.tenant_id,
    brand_id: p.brand_id,
    source: META_SOURCE,
    account_id: r.account_id,
    campaign_id: r.campaign_id || `name:${r.campaign_name ?? ''}`,
    ad_group_id: r.adset_id ?? '',
    ad_id: r.ad_id ?? '',
    date: r.date_start,
    breakdown_signature: 'none',
    attribution_config: 'unspecified',
    // `clicks` din Meta = toate clickurile („Clicks (all)”), nu doar pe link.
    click_type: 'all',
    account_name: r.account_name ?? null,
    campaign_name: r.campaign_name ?? null,
    ad_group_name: r.adset_name ?? null,
    ad_name: r.ad_name ?? null,
    spend: decimal(r.spend, 'spend', notes),
    impressions: integer(r.impressions, 'impressions', notes),
    clicks: integer(r.clicks, 'clicks', notes),
    conversions: null,
    currency: p.currency,
    source_id: p.source_id,
    sync_run_id: p.sync_run_id,
    import_batch_id: null,
    row_number: null,
    collected_at: p.collected_at,
    collection_method: 'api',
    payload_hash: p.payload_hash,
    source_timezone: p.source_timezone,
    schema_version: META_SCHEMA_VERSION,
  }
}
