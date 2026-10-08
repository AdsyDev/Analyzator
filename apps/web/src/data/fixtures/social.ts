import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import socialFile from '../../../../../tests/fixtures/ui/social.json'
import { failed, notConnected, ready, type QueryContext, type SocialCalendarItem, type SocialGroupStat, type SocialKpi, type SocialPlatform, type SocialFormat, type SocialPost, type SocialProvider } from '../../contracts'
import { addDays, daysBetween, lastCompleteDay } from '../../lib/period'

interface PostDef {
  days_ago: number
  platform: SocialPlatform
  format: SocialFormat
  topic: string | null
  label: string | null
  excerpt: string
  reach: number | null
  interactions: number | null
}
interface BrandSocial {
  imported_days_ago: number
  followers_end: number
  followers_start: number
  reach_interval: number
  posts: PostDef[]
  competitors: Array<{ label: string; name: string; posts_per_week: number | null; followers: number | null; public_interactions_per_post: number | null; as_of_days_ago: number | null }>
}
const data = socialFile.brands as unknown as Record<string, BrandSocial>
const NO_IMPORT = 'Nu există date sociale importate pentru acest brand.'
const MATURITY_DAYS = 7

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? null) : (((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2)
}

export function createSocialFixtures({ allowed, now }: { allowed: Set<string>; now: () => Date }): SocialProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const asOf = () => lastCompleteDay(now())
  const need = (ctx: QueryContext) => (allowed.has(ctx.brandId) ? (data[ctx.brandId] ?? null) : undefined)

  const postsFor = (ctx: QueryContext, b: BrandSocial, platform: string | null, format: string | null): SocialPost[] =>
    b.posts
      .map<SocialPost>((p, i) => {
        const date = addDays(asOf(), -p.days_ago)
        return {
          id: `post-${ctx.brandId}-${i}`,
          published_at: `${date}T10:00:00+03:00`,
          platform: p.platform,
          format: p.format,
          topic: p.topic,
          label: p.label,
          excerpt: p.excerpt,
          permalink: `https://${p.platform}.example/p/${ctx.brandId}-${i}`,
          age_days: p.days_ago,
          mature: p.days_ago >= MATURITY_DAYS,
          reach: p.reach,
          interactions: p.interactions,
        }
      })
      .filter((p) => p.published_at.slice(0, 10) >= ctx.period.from && p.published_at.slice(0, 10) <= ctx.period.to)
      .filter((p) => (!platform || p.platform === platform) && (!format || p.format === format))
      .sort((x, y) => y.published_at.localeCompare(x.published_at))

  return {
    summary: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      const posts = postsFor(ctx, b, f.platform, f.format)
      const withPerf = posts.filter((p) => p.interactions !== null)
      const kpi = (key: SocialKpi['key'], label: string, value: number | null, definition: string, note: string | null = null): SocialKpi => ({ key, label, value, change: null, status: value === null ? 'unavailable' : note ? 'partial' : 'ok', definition, note })
      return ready({
        kpis: [
          kpi('posts', 'Postări publicate', posts.length, 'Numărul de postări publicate în perioadă, pe profilurile conectate.'),
          kpi('followers', 'Followers', b.followers_end, 'Followers la sfârșitul intervalului (ultima observație validă), nu o sumă pe zile.'),
          kpi('net_growth', 'Creștere netă', b.followers_end - b.followers_start, 'Followers la sfârșit minus followers la început; pierderile sunt incluse.'),
          kpi('interactions', 'Interacțiuni', withPerf.length ? withPerf.reduce((a, p) => a + (p.interactions ?? 0), 0) : null, 'Interacțiunile publice ale postărilor cu date de performanță.', withPerf.length < posts.length ? `${posts.length - withPerf.length} postări fără date de performanță nu sunt incluse.` : null),
          kpi('reach', 'Reach valid', b.reach_interval, 'Reach din raportul pe intervalul întreg; zilele și postările nu se însumează.'),
        ],
        imported_at: `${addDays(asOf(), -(b.imported_days_ago - 1))}T06:00:00+03:00`,
        data_as_of: addDays(asOf(), -(b.imported_days_ago - 1)),
      })
    },

    posts: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      return ready(postsFor(ctx, b, f.platform, f.format))
    },

    groups: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      // Doar postările mature intră în median: nu clasăm o postare de ieri împotriva uneia de acum o lună (spec cap. 17).
      const posts = postsFor(ctx, b, f.platform, f.format)
      const weeks = (daysBetween(ctx.period.from, ctx.period.to) + 1) / 7
      const stat = (group: string, mine: SocialPost[]): SocialGroupStat => {
        const mature = mine.filter((p) => p.mature && p.interactions !== null)
        return { group, n: mature.length, posts_per_week: Math.round((mine.length / weeks) * 10) / 10, median_interactions: median(mature.map((p) => p.interactions ?? 0)) }
      }
      const groupBy = (key: 'topic' | 'format') => [...new Set(posts.map((p) => p[key] ?? 'Fără topic'))].map((g) => stat(g, posts.filter((p) => (p[key] ?? 'Fără topic') === g)))
      return ready({ by_topic: groupBy('topic'), by_format: groupBy('format'), observed: { from: ctx.period.from, to: ctx.period.to } })
    },

    calendar: async (ctx, f) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      return ready(postsFor(ctx, b, f.platform, f.format).map<SocialCalendarItem>((p) => ({ date: p.published_at.slice(0, 10), post_id: p.id, platform: p.platform, label: p.label, has_performance: p.interactions !== null })))
    },

    competitors: async (ctx) => {
      const b = need(ctx)
      if (b === undefined) return denied
      if (!b) return notConnected(NO_IMPORT)
      const names = (brandsFile.competitor_sets as Record<string, { competitors: Array<{ label: string; name: string }> }>)[ctx.brandId]?.competitors ?? []
      return ready(b.competitors.map((c) => ({ label: c.label, name: names.find((n) => n.label === c.label)?.name ?? c.name, posts_per_week: c.posts_per_week, followers: c.followers, public_interactions_per_post: c.public_interactions_per_post, as_of: c.as_of_days_ago === null ? null : addDays(asOf(), -c.as_of_days_ago) })))
    },
  }
}
