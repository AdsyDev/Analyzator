// Parserul răspunsului Clarity Data Export API (project-live-insights) → rânduri clarity_daily.
//
// Sursa formei: documentația Microsoft (actualizată 2025-12-05). Documentația dă numele câmpurilor doar pentru
// blocul „Traffic". Pentru celelalte metrici listate, maparea rămâne goală până la un payload real: valorile
// rămân NULL, iar câmpurile întâlnite se loghează (note `unconfirmed_field`), ca să poată fi mapate atunci.
// Schema e tolerantă: câmpuri sau blocuri necunoscute nu opresc parsarea; doar forma de bază invalidă aruncă.

import { z } from 'zod'
import type { ClarityParser, ParseContext, ParseNote, ParseResult } from './collect-core.ts'

export const CLARITY_SCHEMA_VERSION = 'docs-2025-12-05'

/** Coloanele de metrici din clarity_daily. */
export const METRIC_COLUMNS = [
  'sessions',
  'bot_sessions',
  'distinct_users',
  'pages_per_session',
  'scroll_depth',
  'engagement_time',
  'dead_click_count',
  'rage_click_count',
  'quickback_click',
  'excessive_scroll',
  'script_error_count',
  'error_click_count',
] as const
export type MetricColumn = (typeof METRIC_COLUMNS)[number]

/**
 * metricName → { câmp din `information[]` → coloană }. Doar câmpuri documentate.
 * Blocurile listate în documentație dar fără câmpuri documentate au maparea goală (rămân NULL).
 */
export const FIELD_MAP: Record<string, Partial<Record<string, MetricColumn>>> = {
  Traffic: {
    totalSessionCount: 'sessions',
    totalBotSessionCount: 'bot_sessions',
    distantUserCount: 'distinct_users',
    // Pe payload real (12 oct 2026): „distinctUserCount” (documentația: „distantUserCount”).
    distinctUserCount: 'distinct_users',
    PagesPerSessionPercentage: 'pages_per_session',
  },
  'Scroll Depth': {},
  'Engagement Time': {},
  'Dead Click Count': {},
  'Rage Click Count': {},
  'Quickback Click': {},
  'Excessive Scroll': {},
  'Script Error Count': {},
  'Error Click Count': {},
}

/** Blocuri listate în documentație care sunt defalcări (liste), nu metrici numerice pe rând. Se ignoră explicit. */
export const BREAKDOWN_BLOCKS = new Set([
  'Popular Pages',
  'Browser',
  'Device',
  'OS',
  'Country/Region',
  'Page Title',
  'Referrer URL',
])

/**
 * Pe payload real (12 oct 2026) numele vin altfel decât în documentație: blocurile fără spații („RageClickCount”),
 * câmpurile și dimensiunile cu altă capitalizare („pagesPerSessionPercentage”, „Url”). Potrivirea ignoră spațiile și
 * majusculele; numele originale rămân în note.
 */
const canon = (name: string) => name.replace(/\s+/g, '').toLowerCase()
const FIELD_MAP_BY_CANON = new Map(Object.entries(FIELD_MAP).map(([k, v]) => [canon(k), v]))
const BREAKDOWN_BY_CANON = new Set([...BREAKDOWN_BLOCKS].map(canon))
const columnFor = (mapping: Partial<Record<string, MetricColumn>>, field: string): MetricColumn | undefined =>
  mapping[field] ?? Object.entries(mapping).find(([k]) => canon(k) === canon(field))?.[1]
const dimensionValue = (info: Record<string, unknown>, key: string): { field: string; raw: unknown } | null => {
  const field = Object.keys(info).find((k) => canon(k) === canon(key))
  return field === undefined ? null : { field, raw: info[field] }
}

/** Coloana `dimension` → cheia din rânduri (numele dimensiunii din documentație). */
const DIMENSION_KEY: Record<string, string | null> = { all: null, device: 'Device', source: 'Source', page: 'URL' }

const InformationRow = z.record(z.string(), z.unknown())
const Block = z.looseObject({ metricName: z.string().min(1), information: z.array(InformationRow) })
const Payload = z.array(Block)

export type ClarityDailyRow = {
  tenant_id: string
  brand_id: string
  date: string
  dimension: 'all' | 'device' | 'source' | 'page'
  dimension_value: string
  source_id: string
  sync_run_id: string
  collected_at: string
  collection_method: 'api'
  payload_hash: string
  window_days: 1 | 2 | 3
  schema_version: string
} & Record<MetricColumn, number | null>

/** Valorile numerice vin ca string ("9554") sau număr (1.0931). Orice altceva → null + notă. */
function toNumber(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : 'invalid'
  if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim())
  return 'invalid'
}

export function parseClarityPayload(payload: unknown, ctx: ParseContext): ParseResult<ClarityDailyRow> {
  const parsed = Payload.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`Payload Clarity cu formă necunoscută: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }

  const dimension = ctx.call.key
  const dimensionKey = DIMENSION_KEY[dimension]
  if (dimensionKey === undefined) throw new Error(`Dimensiune necunoscută: ${dimension}`)

  const notes: ParseNote[] = []
  const noted = new Set<string>()
  const note = (n: ParseNote) => {
    const key = `${n.code}|${n.metric_name ?? ''}|${n.field ?? ''}`
    if (noted.has(key)) return
    noted.add(key)
    notes.push(n)
  }

  const byValue = new Map<string, ClarityDailyRow>()
  const rowFor = (value: string): ClarityDailyRow => {
    let row = byValue.get(value)
    if (!row) {
      row = {
        tenant_id: ctx.tenant_id,
        brand_id: ctx.brand_id,
        date: ctx.date,
        dimension,
        dimension_value: value,
        source_id: ctx.source_id,
        sync_run_id: ctx.sync_run_id,
        collected_at: ctx.collected_at,
        collection_method: 'api',
        payload_hash: ctx.payload_hash,
        window_days: ctx.window_days,
        schema_version: CLARITY_SCHEMA_VERSION,
        ...(Object.fromEntries(METRIC_COLUMNS.map((c) => [c, null])) as Record<MetricColumn, null>),
      }
      byValue.set(value, row)
    }
    return row
  }

  for (const block of parsed.data) {
    const extraBlockKeys = Object.keys(block).filter((k) => k !== 'metricName' && k !== 'information')
    for (const key of extraBlockKeys) {
      note({ code: 'unknown_block_key', metric_name: block.metricName, field: key, message: `cheie necunoscută „${key}" în blocul „${block.metricName}"` })
    }

    if (BREAKDOWN_BY_CANON.has(canon(block.metricName))) {
      note({ code: 'ignored_breakdown_block', metric_name: block.metricName, message: `bloc de defalcare „${block.metricName}" ignorat` })
      continue
    }
    const mapping = FIELD_MAP_BY_CANON.get(canon(block.metricName))
    if (!mapping) {
      note({ code: 'unknown_block', metric_name: block.metricName, message: `bloc necunoscut „${block.metricName}"` })
      continue
    }

    const seenValues = new Set<string>()
    for (const info of block.information) {
      let value = 'all'
      if (dimensionKey) {
        const raw = dimensionValue(info, dimensionKey)?.raw
        value = typeof raw === 'string' && raw.trim() !== '' ? raw.trim().slice(0, 2048) : '(unknown)'
        if (value === '(unknown)') {
          note({ code: 'missing_dimension_value', metric_name: block.metricName, field: dimensionKey, message: `rând fără „${dimensionKey}" → „(unknown)"` })
        }
      }
      if (seenValues.has(value)) {
        // Aceeași valoare de dimensiune de două ori în același bloc: nu adunăm, păstrăm primul rând.
        note({ code: 'duplicate_dimension_value', metric_name: block.metricName, field: value, message: `„${value}" apare de mai multe ori în „${block.metricName}"; păstrat primul rând` })
        continue
      }
      seenValues.add(value)
      const row = rowFor(value)

      const dimField = dimensionKey ? dimensionValue(info, dimensionKey)?.field : undefined
      for (const [field, raw] of Object.entries(info)) {
        if (field === dimField) continue
        const column = columnFor(mapping, field)
        if (!column) {
          note({
            code: Object.keys(mapping).length === 0 ? 'unconfirmed_field' : 'unknown_field',
            metric_name: block.metricName,
            field,
            message: `câmp nemapat „${field}" în „${block.metricName}" (rămâne neînregistrat)`,
          })
          continue
        }
        const num = toNumber(raw)
        if (num === 'invalid') {
          note({ code: 'invalid_value', metric_name: block.metricName, field, message: `valoare nenumerică pentru „${field}"` })
          continue
        }
        row[column] = num
      }
    }
  }

  return { rows: [...byValue.values()], notes }
}

export const clarityParser: ClarityParser<ClarityDailyRow> = { parse: parseClarityPayload }
