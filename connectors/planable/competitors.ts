// Competitorii urmăriți în Planable (Analytics → Competitors) → competitor_social_daily și competitor_social_posts (Y-6).
// Rutele (specificația OpenAPI publică, citită 2026-11-23; neconfirmate pe un cont real):
//   GET /pages/{id}/competitors                → profilurile urmărite pe o pagină a brandului
//   GET /pages/{id}/competitors/metrics        → seriile zilnice (urmăritori, engagement) pentru pagină și competitori
//   GET /pages/{id}/competitors/top-posts      → postările competitorilor, cel mult 100 pe cerere
// Doar Instagram, Facebook, YouTube, TikTok și LinkedIn au analiza competitorilor. O metrică absentă rămâne NULL, nu 0.

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { calendarDateIn } from '../google/dates.ts'
import type { SyncRunError } from '../shared/sync-runs.ts'
import type { Row } from '../shared/supabase-rest.ts'
import type { GetResult, PlanableClient } from './client.ts'
import { PLANABLE_COMPETITORS_SCHEMA_VERSION, PLANABLE_TOP_POSTS_LIMIT } from './config.ts'
import { platformOf, type Page } from './normalize.ts'

export const COMPETITOR_PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin'] as const

export const COMPETITOR_KEYS = {
  competitor_social_daily: ['tenant_id', 'brand_id', 'platform', 'handle', 'date'],
  competitor_social_posts: ['tenant_id', 'brand_id', 'platform', 'handle', 'post_key'],
} as const

const num = z.number().finite().nullable().optional()

export const TrackedCompetitorsSchema = z
  .object({ data: z.array(z.object({ scrapedPageId: z.string().nullable(), handle: z.string(), displayName: z.string(), platform: z.string() }).passthrough()) })
  .passthrough()
export const CompetitorMetricsSchema = z
  .object({
    data: z.array(
      z
        .object({
          isOwn: z.boolean(),
          handle: z.string(),
          displayName: z.string(),
          platform: z.string(),
          points: z.array(z.object({ date: z.string(), followers: num, engagement: num }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough()
export const TopPostsSchema = z
  .object({
    data: z.array(
      z
        .object({ scrapedPageId: z.string(), handle: z.string(), url: z.string(), postedAt: z.string(), mediaType: z.string().nullable().optional(), likes: num, comments: num, shares: num, views: num })
        .passthrough(),
    ),
  })
  .passthrough()

export type CompetitorProvenance = { tenant_id: string; brand_id: string; source_id: string; sync_run_id: string; collected_at: string }

/** Handle-ul cum se salvează și cum se potrivește cu profilurile din set: litere mici, fără „@”. */
export function normalizeHandle(handle: string): string | null {
  const h = handle.trim().replace(/^@+/, '').toLowerCase()
  return /^[^\s/?#@]{1,100}$/.test(h) ? h : null
}

export const isCompetitorPlatform = (platform: string) => (COMPETITOR_PLATFORMS as readonly string[]).includes(platform)

const postKey = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 32)

/** Întreg ≥ 0 sau NULL (cu notă pentru o valoare invalidă). */
function count(v: number | null | undefined, field: string, notes: string[]): number | null {
  if (v === undefined || v === null) return null
  if (!Number.isFinite(v) || v < 0) {
    notes.push(`competitori: valoare invalidă pentru ${field}: ${JSON.stringify(v)}`)
    return null
  }
  return Math.round(v)
}

function nonNegative(v: number | null | undefined, field: string, notes: string[]): number | null {
  if (v === undefined || v === null) return null
  if (!Number.isFinite(v) || v < 0) {
    notes.push(`competitori: valoare invalidă pentru ${field}: ${JSON.stringify(v)}`)
    return null
  }
  return v
}

const common = (p: CompetitorProvenance, payloadHash: string) => ({
  tenant_id: p.tenant_id,
  brand_id: p.brand_id,
  source_id: p.source_id,
  sync_run_id: p.sync_run_id,
  collected_at: p.collected_at,
  payload_hash: payloadHash,
  schema_version: PLANABLE_COMPETITORS_SCHEMA_VERSION,
})

/** Rândurile zilnice ale competitorilor (fără pagina proprie); mai multe puncte în aceeași zi → ultimul. */
export function competitorDailyRows(payload: z.infer<typeof CompetitorMetricsSchema>, pagePlatform: string, timeZone: string, p: CompetitorProvenance, payloadHash: string, notes: string[]): Row[] {
  const rows = new Map<string, Row & { _t: number }>()
  for (const series of payload.data) {
    if (series.isOwn) continue
    const platform = platformOf(series.platform || pagePlatform)
    const handle = normalizeHandle(series.handle)
    if (!isCompetitorPlatform(platform) || !handle) {
      notes.push(`competitori: profil ignorat (${series.platform} ${JSON.stringify(series.handle)})`)
      continue
    }
    for (const point of series.points) {
      const t = Date.parse(point.date)
      if (Number.isNaN(t)) {
        notes.push(`competitori: dată invalidă în seria ${platform} @${handle}`)
        continue
      }
      const date = calendarDateIn(new Date(t), timeZone)
      const key = `${platform}|${handle}|${date}`
      const prev = rows.get(key)
      if (prev && prev._t > t) continue
      rows.set(key, {
        ...common(p, payloadHash),
        platform,
        handle,
        display_name: series.displayName.trim().slice(0, 200) || null,
        date,
        followers: count(point.followers, 'followers', notes),
        engagement: nonNegative(point.engagement, 'engagement', notes),
        _t: t,
      })
    }
  }
  return [...rows.values()].map(({ _t, ...r }) => r)
}

export function competitorPostRows(payload: z.infer<typeof TopPostsSchema>, pagePlatform: string, p: CompetitorProvenance, payloadHash: string, notes: string[]): Row[] {
  const rows: Row[] = []
  for (const post of payload.data) {
    const handle = normalizeHandle(post.handle)
    const t = Date.parse(post.postedAt)
    if (!handle || Number.isNaN(t) || !/^https?:\/\//i.test(post.url) || post.url.length > 2048) {
      notes.push(`competitori: postare ignorată (handle, dată sau link invalid)`)
      continue
    }
    rows.push({
      ...common(p, payloadHash),
      platform: pagePlatform,
      handle,
      post_key: postKey(post.url),
      post_url: post.url,
      posted_at: new Date(t).toISOString(),
      media_type: post.mediaType ? post.mediaType.slice(0, 64) : null,
      likes: count(post.likes, 'likes', notes),
      comments: count(post.comments, 'comments', notes),
      shares: count(post.shares, 'shares', notes),
      views: count(post.views, 'views', notes),
    })
  }
  return rows
}

const httpError = (r: Extract<GetResult, { ok: false }>, dimension: string): SyncRunError => ({ code: r.kind, status: r.status, dimension, message: r.message })
const invalid = (dimension: string): SyncRunError => ({ code: 'invalid_payload', status: null, dimension, message: `Forma răspunsului ${dimension} s-a schimbat.` })

const DAY_MS = 86_400_000
/** Ferestre de cel mult 7 zile, pentru când o cerere atinge limita de postări. */
function weeks(start: string, end: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = []
  for (let s = Date.parse(`${start}T00:00:00Z`); s <= Date.parse(`${end}T00:00:00Z`); s += 7 * DAY_MS) {
    const e = Math.min(s + 6 * DAY_MS, Date.parse(`${end}T00:00:00Z`))
    out.push({ start: new Date(s).toISOString().slice(0, 10), end: new Date(e).toISOString().slice(0, 10) })
  }
  return out
}

/**
 * Competitorii unei pagini a brandului. Rețeaua fără analiza competitorilor (400) și add-on-ul inactiv sau pagina fără acces
 * (403) sunt note: nu schimbă statusul rulării sociale a brandului. Celelalte eșecuri sunt erori (rularea devine parțială).
 */
export async function collectPageCompetitors(
  client: PlanableClient,
  page: Page,
  window: { start: string; end: string },
  timeZone: string,
  p: CompetitorProvenance,
  notes: string[],
): Promise<{ daily: Row[]; posts: Row[]; errors: SyncRunError[] }> {
  const platform = platformOf(page.platform)
  const out = { daily: [] as Row[], posts: [] as Row[], errors: [] as SyncRunError[] }
  if (!isCompetitorPlatform(platform)) return out
  const id = encodeURIComponent(page.id)
  const soft = (r: Extract<GetResult, { ok: false }>, dimension: string) => {
    if (r.status === 400) return true
    if (r.status === 403) {
      notes.push(`competitori: pagina ${page.id} (${platform}): tokenul nu are acces sau add-on-ul Analytics e inactiv`)
      return true
    }
    out.errors.push(httpError(r, dimension))
    return false
  }

  const tracked = await client.get(`/pages/${id}/competitors`)
  if (!tracked.ok) {
    soft(tracked, `competitors:${page.id}`)
    return out
  }
  const list = TrackedCompetitorsSchema.safeParse(tracked.payload)
  if (!list.success) {
    out.errors.push(invalid(`competitors:${page.id}`))
    return out
  }
  if (list.data.data.length === 0) return out

  const range = { startDate: `${window.start}T00:00:00.000Z`, endDate: `${window.end}T23:59:59.999Z` }
  const metrics = await client.get(`/pages/${id}/competitors/metrics`, range)
  if (!metrics.ok) soft(metrics, `competitors_metrics:${page.id}`)
  else {
    const parsed = CompetitorMetricsSchema.safeParse(metrics.payload)
    if (parsed.success) out.daily.push(...competitorDailyRows(parsed.data, platform, timeZone, p, metrics.payloadHash, notes))
    else out.errors.push(invalid(`competitors_metrics:${page.id}`))
  }

  // Postările, pe fiecare competitor. O cerere care atinge limita poate fi trunchiată: se reia pe săptămâni.
  for (const c of list.data.data) {
    if (!c.scrapedPageId) {
      notes.push(`competitori: ${platform} @${c.handle} nu are încă date în Planable`)
      continue
    }
    const dimension = `competitors_posts:${page.id}:${c.scrapedPageId}`
    const fetchPosts = async (w: { start: string; end: string }) =>
      client.get(`/pages/${id}/competitors/top-posts`, {
        sortBy: 'likes',
        limit: PLANABLE_TOP_POSTS_LIMIT,
        scrapedPageIds: c.scrapedPageId!,
        startDate: `${w.start}T00:00:00.000Z`,
        endDate: `${w.end}T23:59:59.999Z`,
      })
    const take = (r: GetResult): z.infer<typeof TopPostsSchema>['data'] | null => {
      if (!r.ok) {
        soft(r, dimension)
        return null
      }
      const parsed = TopPostsSchema.safeParse(r.payload)
      if (!parsed.success) {
        out.errors.push(invalid(dimension))
        return null
      }
      out.posts.push(...competitorPostRows(parsed.data, platform, p, r.payloadHash, notes))
      return parsed.data.data
    }
    const whole = await fetchPosts(window)
    const first = take(whole)
    if (!first || first.length < PLANABLE_TOP_POSTS_LIMIT) continue
    for (const w of weeks(window.start, window.end)) {
      const week = take(await fetchPosts(w))
      if (week && week.length >= PLANABLE_TOP_POSTS_LIMIT) notes.push(`competitori: ${platform} @${c.handle}: peste ${PLANABLE_TOP_POSTS_LIMIT} postări în săptămâna din ${w.start}; ritmul poate fi subestimat`)
    }
  }
  return out
}
