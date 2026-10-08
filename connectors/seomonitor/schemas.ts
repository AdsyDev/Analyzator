// Schemele Zod ale răspunsurilor SEOmonitor, tolerante: câmpurile necunoscute trec (looseObject) și se
// raportează separat (`unknownKeys`). Sursa: schemele OpenAPI din https://api-docs.seomonitor.com (2026-10-08).
//
// Unele rute au rădăcina descrisă ca obiect (un singur element) deși întorc liste: `asList` acceptă ambele.

import { z } from 'zod'

const num = z.union([z.number(), z.string(), z.null()]).optional()
const id = z.union([z.number(), z.string()])

export const CampaignSchema = z.looseObject({
  campaign_info: z.looseObject({
    id,
    name: z.string().optional(),
    company_id: id.optional(),
    domain: z.string().optional(),
    max_tracked_position_desktop: num,
    max_tracked_position_mobile: num,
  }),
})

export type Group = { group_id: number | string; name?: string; type?: string; subgroups?: Group[] }
export const GroupSchema: z.ZodType<Group> = z.lazy(() =>
  z.looseObject({
    group_id: id,
    name: z.string().optional(),
    type: z.string().optional(),
    subgroups: z.array(GroupSchema).optional(),
  }),
) as z.ZodType<Group>

const DeviceRank = z.looseObject({ rank: num, trend: num })
export const KeywordSchema = z.looseObject({
  keyword_id: id,
  keyword: z.string(),
  main_keyword_id: z.union([z.string(), z.number(), z.null()]).optional(),
  search_intent: z.string().nullable().optional(),
  labels: z.string().nullable().optional(),
  groups: z.union([z.string(), z.number(), z.array(id), z.null()]).optional(),
  search_data: z.looseObject({ search_volume: num }).nullable().optional(),
  ranking_data: z.looseObject({ desktop: DeviceRank.nullable().optional(), mobile: DeviceRank.nullable().optional() }).nullable().optional(),
  landing_pages: z
    .looseObject({
      desktop: z.looseObject({ current: z.string().nullable().optional() }).nullable().optional(),
      mobile: z.looseObject({ current: z.string().nullable().optional() }).nullable().optional(),
    })
    .nullable()
    .optional(),
  last_updated: z.string().nullable().optional(),
})

const DailyRank = z.looseObject({ date: z.string(), rank: num })
export const DailyRanksSchema = z.looseObject({
  keyword_id: id,
  keyword: z.string(),
  ranking_data: z.looseObject({
    desktop: z.array(DailyRank).nullable().optional(),
    mobile: z.array(DailyRank).nullable().optional(),
  }),
})

const DeviceNum = z.looseObject({ desktop: num, mobile: num }).nullable().optional()
export const GroupVisibilitySchema = z.looseObject({ date: z.string(), visibility: DeviceNum, avg_rank: DeviceNum })

export const AiSearchEntrySchema = z.looseObject({
  date: z.string(),
  citations: z.array(z.string()).nullable().optional(),
  content: z.string().nullable().optional(),
  raw_content: z.string().nullable().optional(),
  encoding: z.string().optional(),
  any_brand_present: z.boolean().nullable().optional(),
  my_brand_present: z.boolean().nullable().optional(),
  rank: num,
  sentiment_of_my_brand: z.string().nullable().optional(),
  era: z.string().nullable().optional(),
})
export const KeywordAisSchema = z.looseObject({ keyword_id: id, keyword: z.string(), ai_search_data: z.array(AiSearchEntrySchema).nullable().optional() })

export const DailyRanksAisSchema = z.looseObject({
  keyword_id: id,
  keyword: z.string(),
  ranking_data: z
    .array(
      z.looseObject({
        date: z.string(),
        rank: num,
        any_brand_present: z.boolean().nullable().optional(),
        my_brand_present: z.boolean().nullable().optional(),
        sentiment_of_my_brand: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
})

export const CompetitionAisSchema = z.looseObject({
  keyword_id: id,
  keyword: z.string(),
  competitors: z
    .array(
      z.looseObject({
        domain: z.string(),
        rank: num,
        rank_trend: num,
        any_brand_present: z.boolean().nullable().optional(),
        competitor_brand_present: z.boolean().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
})

export const AisMentionsSchema = z.looseObject({ date: z.string(), brand_presence_visibility: num })
export const AisCitationsSchema = z.looseObject({ date: z.string(), source_citation_visibility: num })

export const AisStatsSchema = z.looseObject({
  engines: z
    .array(
      z.looseObject({
        engine: z.string(),
        enabled: z.boolean().nullable().optional(),
        active: z.boolean().nullable().optional(),
        last_crawl_date: z.string().nullable().optional(),
        has_data: z.boolean().nullable().optional(),
      }),
    )
    .default([]),
  stats: z.record(
    z.string(),
    z.looseObject({
      presence_rate: num,
      presence_trend: num,
      source_citations: num,
      source_citations_trend: num,
      avg_position: num,
      avg_position_trend: num,
      sentiment: z.looseObject({ positive: num, neutral: num, negative: num }).nullable().optional(),
      missing_data: z.boolean().nullable().optional(),
      missing_data_reason: z.string().nullable().optional(),
      calculated_from: z.string().nullable().optional(),
    }),
  ).default({}),
})

const AioEntry = z.looseObject({
  date: z.string().optional(),
  links: z.array(z.string()).nullable().optional(),
  brand_presence: z.boolean().nullable().optional(),
  brand_presence_any: z.boolean().nullable().optional(),
  rank: num,
  content: z.string().nullable().optional(),
  raw_content: z.string().nullable().optional(),
  encoding: z.string().optional(),
})
export const AioSchema = z.looseObject({
  keyword_id: id,
  keyword: z.string(),
  sge_widget_data: z
    .looseObject({
      desktop: z.record(z.string(), AioEntry).nullable().optional(),
      mobile: z.record(z.string(), AioEntry).nullable().optional(),
    })
    .nullable()
    .optional(),
})

/** Rădăcina descrisă ca obiect în documentație, dar folosită ca listă: acceptăm ambele. */
export function asList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') return [payload]
  throw new Error(`Răspuns cu formă necunoscută (${typeof payload}).`)
}

export type ParseIssue = { code: 'invalid_item' | 'unknown_field'; route: string; detail: string }

/** Parsează elementele unei liste; elementele invalide sunt raportate și sărite, nu opresc parsarea. */
export function parseItems<T>(
  route: string,
  schema: z.ZodType<T>,
  payload: unknown,
  knownKeys: readonly string[],
): { items: T[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = []
  const items: T[] = []
  const seenUnknown = new Set<string>()
  for (const raw of asList(payload)) {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      issues.push({ code: 'invalid_item', route, detail: parsed.error.issues[0]?.message ?? 'invalid' })
      continue
    }
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(raw)) {
        if (!knownKeys.includes(key) && !seenUnknown.has(key)) {
          seenUnknown.add(key)
          issues.push({ code: 'unknown_field', route, detail: key })
        }
      }
    }
    items.push(parsed.data)
  }
  return { items, issues }
}
