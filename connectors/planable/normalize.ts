// Răspunsurile Planable → rândurile din social_daily, social_posts și mentions (aceleași tabele ca importul CSV).
// Validare tolerantă (Zod, passthrough): câmpurile necunoscute nu opresc parsarea. O metrică absentă rămâne NULL, nu 0.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { calendarDateIn } from '../google/dates.ts'
import { PLANABLE_SCHEMA_VERSION } from './config.ts'

const num = z.number().finite().nullable().optional()
const metricsObject = z.record(z.string(), z.unknown()).nullable().optional()

export const PaginationSchema = z.object({ offset: z.number(), limit: z.number(), hasMore: z.boolean() }).passthrough()

export const WorkspaceSchema = z.object({ id: z.string(), name: z.string(), timezone: z.string() }).passthrough()
export const WorkspacesSchema = z.object({ data: z.array(WorkspaceSchema) }).passthrough()

export const PageSchema = z.object({ id: z.string(), name: z.string(), platform: z.string(), workspaceId: z.string(), isConnected: z.boolean() }).passthrough()
export const PagesSchema = z.object({ data: z.array(PageSchema), pagination: PaginationSchema }).passthrough()

export const PageMetricsItemSchema = z
  .object({
    pageId: z.string(),
    pageType: z.string(),
    fetchedAt: z.string(),
    partial: z.boolean(),
    facebook: metricsObject,
    instagram: metricsObject,
    linkedin: metricsObject,
    tiktok: metricsObject,
    threads: metricsObject,
    twitter: metricsObject,
    youtube: metricsObject,
    googleMyBusiness: metricsObject,
  })
  .passthrough()
export const PageMetricsSchema = z.object({ data: z.array(PageMetricsItemSchema), pagination: PaginationSchema }).passthrough()

export const PostSchema = z
  .object({
    id: z.string(),
    pageId: z.string(),
    plainText: z.string().nullable().optional(),
    scheduledAt: z.string().nullable(),
    published: z.boolean(),
    archived: z.boolean(),
    publishedPostLink: z.string().nullable().optional(),
  })
  .passthrough()
export const PostsSchema = z.object({ data: z.array(PostSchema), pagination: PaginationSchema }).passthrough()

export const PostMetricsSchema = z
  .object({ data: z.object({ postId: z.string(), pageId: z.string(), pageType: z.string(), fetchedAt: z.string(), impressions: num, engagement: num, reactions: num }).passthrough() })
  .passthrough()

export const KeywordSchema = z.object({ keywordId: z.string(), text: z.string(), type: z.string() }).passthrough()
export const KeywordsSchema = z.object({ data: z.array(KeywordSchema) }).passthrough()

export const MentionSchema = z
  .object({
    platform: z.string(), publishedAt: z.string(), url: z.string(), text: z.string().nullable().optional(), sentiment: z.string().nullable().optional(),
    // Documentat (OpenAPI 2026-10-12): author { name, username, profileImageUrl }. Nu se salvează: servește doar la „cont propriu”.
    author: z.object({ name: z.string().nullable().optional(), username: z.string().nullable().optional() }).passthrough().nullable().optional(),
  })
  .passthrough()
export const MentionsSchema = z.object({ data: z.array(MentionSchema), pagination: z.object({ nextCursor: z.number().nullable() }).passthrough() }).passthrough()

export type Page = z.infer<typeof PageSchema>
export type PageMetricsItem = z.infer<typeof PageMetricsItemSchema>
export type Post = z.infer<typeof PostSchema>
export type Mention = z.infer<typeof MentionSchema>

/** pageType → platforma din tabele (ca în contractul CSV). */
export function platformOf(pageType: string): string {
  const p = pageType.trim()
  if (p.toLowerCase() === 'twitter') return 'x'
  if (p === 'googleMyBusiness' || p.toLowerCase() === 'googlemybusiness') return 'google_business'
  return p.toLowerCase().replace(/[^a-z0-9_]+/g, '_')
}

type Metrics = {
  followers: number | null
  impressions: number | null
  reach_not_additive: number | null
  engagements: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  link_clicks: number | null
  video_views: number | null
}

const EMPTY: Metrics = { followers: null, impressions: null, reach_not_additive: null, engagements: null, likes: null, comments: null, shares: null, saves: null, link_clicks: null, video_views: null }

/** Doar întregi nenegativi (coloanele sunt bigint ≥ 0); orice altceva → NULL, cu notă. */
function count(o: Record<string, unknown> | null | undefined, key: string, notes: string[]): number | null {
  const v = o?.[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    notes.push(`valoare invalidă pentru ${key}: ${JSON.stringify(v)}`)
    return null
  }
  return Math.round(v)
}

/** Maparea câmpurilor documentate pe platformă (docs/contracts/planable.md, „Maparea metricilor de pagină”). */
const PAGE_MAP: Record<string, { block: keyof PageMetricsItem; fields: Partial<Record<keyof Metrics, string>> }> = {
  facebook: { block: 'facebook', fields: { followers: 'totalFollowers', impressions: 'views', engagements: 'engagement', likes: 'reactions' } },
  instagram: { block: 'instagram', fields: { followers: 'totalFollowers', impressions: 'impressions', reach_not_additive: 'reach', engagements: 'engagement', video_views: 'views' } },
  linkedin: { block: 'linkedin', fields: { followers: 'totalFollowers', impressions: 'impressions', engagements: 'engagement', likes: 'reactions', comments: 'comments', shares: 'reshares' } },
  tiktok: { block: 'tiktok', fields: { followers: 'followers_count', engagements: 'engagement', likes: 'likes', comments: 'comments', shares: 'shares', video_views: 'video_views' } },
  threads: { block: 'threads', fields: { impressions: 'views', likes: 'likes', comments: 'replies', shares: 'reposts' } },
  x: { block: 'twitter', fields: { followers: 'totalFollowers', impressions: 'impressions', engagements: 'engagement', likes: 'reactions' } },
  youtube: { block: 'youtube', fields: { followers: 'totalSubscribers', engagements: 'engagement', likes: 'likes', comments: 'comments', shares: 'shares', video_views: 'views' } },
  google_business: { block: 'googleMyBusiness', fields: { impressions: 'impressions', engagements: 'engagement' } },
}

export function pageMetrics(item: PageMetricsItem, notes: string[]): { platform: string; metrics: Metrics } {
  const platform = platformOf(item.pageType)
  const map = PAGE_MAP[platform]
  if (!map) {
    notes.push(`platformă necunoscută: ${item.pageType}`)
    return { platform, metrics: { ...EMPTY } }
  }
  const block = item[map.block] as Record<string, unknown> | null | undefined
  const metrics = { ...EMPTY }
  for (const [col, key] of Object.entries(map.fields) as Array<[keyof Metrics, string]>) metrics[col] = count(block, key, notes)
  return { platform, metrics }
}

export type Provenance = {
  tenant_id: string
  brand_id: string
  source_id: string
  sync_run_id: string
  collected_at: string
  payload_hash: string
  source_timezone: string
}

const common = (p: Provenance) => ({
  tenant_id: p.tenant_id,
  brand_id: p.brand_id,
  source_id: p.source_id,
  sync_run_id: p.sync_run_id,
  collected_at: p.collected_at,
  collection_method: 'api',
  // Explicit NULL: un rând importat anterior din CSV cu aceeași cheie devine rând API (CHECK de proveniență).
  import_batch_id: null,
  row_number: null,
  payload_hash: p.payload_hash,
  source_timezone: p.source_timezone,
  schema_version: PLANABLE_SCHEMA_VERSION,
})

/** Un rând social_daily per pagină și zi; mai multe snapshoturi în aceeași zi → ultimul (după fetchedAt). */
export function socialDailyRows(page: Page, items: PageMetricsItem[], timeZone: string, p: Omit<Provenance, 'payload_hash'> & { hashes: Map<PageMetricsItem, string> }, notes: string[]) {
  const latest = new Map<string, PageMetricsItem>()
  for (const item of items) {
    const t = Date.parse(item.fetchedAt)
    if (Number.isNaN(t)) {
      notes.push(`fetchedAt invalid pe pagina ${page.id}`)
      continue
    }
    const date = calendarDateIn(new Date(t), timeZone)
    const prev = latest.get(date)
    if (!prev || Date.parse(prev.fetchedAt) < t) latest.set(date, item)
  }
  return [...latest.entries()].map(([date, item]) => {
    const { platform, metrics } = pageMetrics(item, notes)
    return {
      ...common({ ...p, payload_hash: p.hashes.get(item) ?? '' }),
      platform,
      account_id: page.id,
      account_name: page.name,
      date,
      ...metrics,
    }
  })
}

export function socialPostRow(post: Post, metrics: z.infer<typeof PostMetricsSchema>['data'], timeZone: string, p: Provenance, notes: string[]) {
  const n = (v: number | null | undefined, key: string) => count({ [key]: v ?? null }, key, notes)
  return {
    ...common(p),
    platform: platformOf(metrics.pageType),
    account_id: post.pageId,
    post_id: post.id,
    snapshot_date: calendarDateIn(new Date(Date.parse(metrics.fetchedAt)), timeZone),
    metrics_scope: 'lifetime',
    published_at: post.scheduledAt,
    post_url: post.publishedPostLink ?? null,
    post_text: post.plainText ? post.plainText.slice(0, 10_000) : null,
    impressions: n(metrics.impressions, 'impressions'),
    reach_not_additive: null,
    engagements: n(metrics.engagement, 'engagement'),
    likes: n(metrics.reactions, 'reactions'),
    comments: null,
    shares: null,
    saves: null,
    link_clicks: null,
    video_views: null,
  }
}

/** Același native_id ca importul CSV fără ID: aceeași mențiune nu se dublează între CSV și API. */
export function mentionNativeId(url: string): string {
  return `h:${createHash('sha256').update(url).digest('hex').slice(0, 32)}`
}

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const

/** Nume comparabil: fără diacritice, majuscule, spații și semne („Minimarțieni România” = „minimartieniromania”). */
export const accountKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Conturile proprii ale workspace-ului, pe platformă: cheile numelor paginilor Planable. */
export type OwnAccounts = Map<string, Set<string>>
export function ownAccounts(pages: Array<{ name: string; platform: string }>): OwnAccounts {
  const out: OwnAccounts = new Map()
  for (const pg of pages) {
    const key = accountKey(pg.name)
    if (!key) continue
    const platform = platformOf(pg.platform)
    if (!out.has(platform)) out.set(platform, new Set())
    out.get(platform)!.add(key)
  }
  return out
}

/**
 * „Cont propriu” (D-22): autorul mențiunii are numele sau username-ul unei pagini Planable a brandului, pe aceeași platformă.
 * `null` = nu se știe (fără autor în payload sau fără paginile workspace-ului); `false` = autor extern.
 */
export function authorIsOwned(m: Mention, own: OwnAccounts | null): boolean | null {
  if (!own || !m.author) return null
  const keys = [m.author.name, m.author.username].filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(accountKey).filter(Boolean)
  if (keys.length === 0) return null
  const set = own.get(platformOf(m.platform))
  return set ? keys.some((k) => set.has(k)) : false
}

/**
 * De ce nu se poate scrie o mențiune: URL care nu e http(s) sau dată invalidă. Lista goală = mențiune validă. `url_missing`
 * apare doar alături de `date_invalid`: o mențiune fără link, dar cu dată, se scrie cu o cheie construită (deciziile R).
 */
export type MentionSkipReason = 'url_missing' | 'url_not_http' | 'date_invalid'

export const MENTION_SKIP_LABELS: Record<MentionSkipReason, string> = {
  url_missing: 'fără URL',
  url_not_http: 'URL care nu începe cu http(s)',
  date_invalid: 'fără dată de publicare validă',
}

/** Sursa nu a trimis linkul mențiunii (mențiunile web din Planable). Lipsa nu se înlocuiește cu nimic: `url` rămâne NULL. */
export const hasNoLink = (m: Mention): boolean => m.url.trim() === ''

/**
 * Motivele pentru care o mențiune e sărită. Data e obligatorie în `mentions` și nu se deduce (regula 8); un URL care nu e
 * http(s) nu e un link și nici o lipsă curată, deci rândul nu se scrie.
 */
export function mentionSkipReasons(m: Mention): MentionSkipReason[] {
  const reasons: MentionSkipReason[] = []
  const dateInvalid = Number.isNaN(Date.parse(m.publishedAt))
  if (hasNoLink(m)) {
    if (dateInvalid) reasons.push('url_missing')
  } else if (!/^https?:\/\//.test(m.url)) reasons.push('url_not_http')
  if (dateInvalid) reasons.push('date_invalid')
  return reasons
}

/**
 * Identitatea unei mențiuni fără link: rețeaua, autorul, momentul publicării și textul, dacă există. E tot ce trimite sursa
 * despre ea. Autorul și textul intră doar în hash: numele autorului nu se salvează nicăieri (D-22).
 */
export function builtMentionIdentity(m: Mention): string {
  const author = [m.author?.name, m.author?.username].map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')).join('\u0001')
  const text = typeof m.text === 'string' && m.text.trim() !== '' ? createHash('sha256').update(m.text.trim()).digest('hex') : ''
  return [m.platform.trim().toLowerCase(), author, new Date(m.publishedAt).toISOString(), text].join('\u0000')
}

/**
 * Cheia construită pentru o mențiune fără link. `n` deosebește mențiunile cu aceeași identitate (același site, în aceeași
 * secundă): a doua primește 2, ca numărul lor să nu scadă. Prefixul `s:` o separă de cheile din URL (`h:`).
 */
export function builtMentionNativeId(identity: string, n: number): string {
  return `s:${createHash('sha256').update(`${identity}\u0000${n}`).digest('hex').slice(0, 32)}`
}

/** Numele câmpurilor unei mențiuni, pe trei categorii. Doar nume: valorile nu ies niciodată de aici. */
export type MentionFieldShape = { filled: string[]; empty: string[]; links: string[] }

const FIELD_NAME = /[^A-Za-z0-9_.]+/g
const isEmptyValue = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

/**
 * Ce câmpuri are o mențiune în răspunsul Planable (inclusiv cele nedescrise în schemă): cu valoare, goale și cele al căror
 * text începe cu http(s). Obiectele se deschid un singur nivel (`author.name`). Servește la diagnostic, când `url` vine gol:
 * arată dacă linkul stă în alt câmp, fără să scrie vreo valoare în jurnal.
 */
export function mentionFieldShape(m: Record<string, unknown>): MentionFieldShape {
  const shape: MentionFieldShape = { filled: [], empty: [], links: [] }
  const visit = (name: string, v: unknown, nested: boolean) => {
    const clean = name.replace(FIELD_NAME, '_').slice(0, 48)
    if (isEmptyValue(v)) return void shape.empty.push(clean)
    if (!nested && typeof v === 'object' && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>)
      if (entries.length === 0) return void shape.empty.push(clean)
      for (const [k, inner] of entries) visit(`${name}.${k}`, inner, true)
      return
    }
    shape.filled.push(clean)
    if (typeof v === 'string' && /^https?:\/\//.test(v.trim())) shape.links.push(clean)
  }
  for (const [k, v] of Object.entries(m)) visit(k, v, false)
  return shape
}

/** `builtKey` = cheia construită, pentru o mențiune fără link; altfel cheia e hash-ul URL-ului. */
export function mentionRow(m: Mention, p: Provenance, own: OwnAccounts | null = null, builtKey: string | null = null) {
  const s = (m.sentiment ?? '').toLowerCase()
  return {
    ...common(p),
    native_id: builtKey ?? mentionNativeId(m.url),
    url: builtKey ? null : m.url.slice(0, 2048),
    source_name: m.platform.slice(0, 256),
    published_at: m.publishedAt,
    text: m.text ? m.text.slice(0, 20_000) : null,
    sentiment: (SENTIMENTS as readonly string[]).includes(s) ? s : 'unknown',
    author_is_owned: authorIsOwned(m, own),
    language: null,
    country: null,
  }
}
