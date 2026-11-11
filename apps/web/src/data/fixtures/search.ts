import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import searchFile from '../../../../../tests/fixtures/ui/search.json'
import { failed, notConnected, ready, type ContentGap, type IndexState, type IndexedUrl, type LandingPage, type PriorityUrl, type SearchKeyword, type SearchProvider } from '../../contracts'
import { addDays, daysBetween, lastCompleteDay } from '../../lib/period'
import { unit } from './rng'

interface KwDef {
  keyword: string
  url: string
  volume: number | null
  rank_mobile: number | null
  rank_desktop: number | null
  change_mobile: number | null
  is_brand: boolean
  competitor: { label: string; position: number } | null
  shared: boolean
}
interface PageDef {
  url: string
  base_clicks: number
  impressions_per_click: number
  position: number
  key_events_per_click: number | null
  shared: boolean
}
interface GapDef {
  keyword: string
  volume: number
  competitor: string
  position: number
}
const data = searchFile.brands as unknown as Record<string, { keywords: KwDef[]; pages: PageDef[]; gaps: GapDef[] }>

export function createSearchFixtures(allowed: Set<string>): SearchProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  /** Lista prioritară din sesiunea de previzualizare (doar în memorie); pornește cu prima pagină a brandului. */
  const priority = new Map<string, PriorityUrl[]>()
  let seq = 0
  const domainOf = (brandId: string) => (brandsFile.brands as Array<{ id: string; domain: string }>).find((b) => b.id === brandId)?.domain ?? 'exemplu.test'
  const absolute = (brandId: string, path: string) => (/^https?:\/\//.test(path) ? path : `https://${domainOf(brandId)}${path.startsWith('/') ? path : `/${path}`}`)
  const priorityOf = (brandId: string): PriorityUrl[] => {
    if (!priority.has(brandId)) priority.set(brandId, (data[brandId]?.pages ?? []).slice(0, 1).map((p) => ({ id: `idx-${brandId}-0`, url: absolute(brandId, p.url), inspected: true })))
    return priority.get(brandId)!
  }
  const competitorName = (brandId: string, label: string) => (brandsFile.competitor_sets as Record<string, { competitors: Array<{ name: string; label: string }> }>)[brandId]?.competitors.find((c) => c.label === label)?.name ?? label

  return {
    keywords: async (ctx, f) => {
      if (!allowed.has(ctx.brandId)) return denied
      return ready(
        (data[ctx.brandId]?.keywords ?? [])
          .filter((k) => (f.keywordType === 'brand' ? k.is_brand : f.keywordType === 'nonbrand' ? !k.is_brand : true))
          .map<SearchKeyword>((k, i) => ({
            id: `kw-${ctx.brandId}-${i}`,
            keyword: k.keyword,
            url: k.url,
            volume: k.volume,
            volume_as_of: k.volume === null ? null : ctx.period.to,
            rank_mobile: k.rank_mobile,
            rank_desktop: k.rank_desktop,
            change_mobile: k.change_mobile,
            is_brand: k.is_brand,
            competitor: k.competitor ? { label: k.competitor.label, name: competitorName(ctx.brandId, k.competitor.label), position: k.competitor.position } : null,
            shared: k.shared,
          })),
      )
    },

    landingPages: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const days = daysBetween(ctx.period.from, ctx.period.to) + 1
      return ready(
        (data[ctx.brandId]?.pages ?? []).map<LandingPage>((p) => {
          const clicks = Math.round(((p.base_clicks * days) / 28) * (0.85 + 0.3 * unit(`${ctx.brandId}:${p.url}:${ctx.period.to}`)))
          const impressions = clicks * p.impressions_per_click
          return {
            url: p.url,
            clicks,
            impressions,
            // Stand-in pentru CTR-ul calculat de server din totaluri (doar fixtures).
            ctr: Math.round((1000 * clicks) / impressions) / 10,
            position: p.position,
            key_events: p.key_events_per_click === null ? null : Math.round(clicks * p.key_events_per_click),
            shared: p.shared,
          }
        }),
      )
    },

    contentGaps: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      return ready((data[ctx.brandId]?.gaps ?? []).map<ContentGap>((g, i) => ({ id: `gap-${ctx.brandId}-${i}`, keyword: g.keyword, volume: g.volume, competitor: { label: g.competitor, name: competitorName(ctx.brandId, g.competitor) }, position: g.position })))
    },

    // Stările sunt fictive și deterministe (doar pentru previzualizare): fiecare pagină din fixture primește o stare stabilă.
    indexStatus: async (brandId) => {
      if (!allowed.has(brandId)) return denied
      const pages = data[brandId]?.pages
      if (!pages) return notConnected('Search Console nu este conectat pentru acest brand.')
      const day = addDays(lastCompleteDay(), -1)
      const list = priorityOf(brandId)
      const urls = pages.map<IndexedUrl>((p) => {
        const url = absolute(brandId, p.url)
        const r = unit(`${brandId}:index:${p.url}`)
        const state: IndexState = r < 0.7 ? 'indexed' : r < 0.9 ? 'not_indexed' : 'unknown'
        const mismatch = state === 'indexed' && unit(`${brandId}:canonical:${p.url}`) < 0.15
        return {
          url, priority: list.some((u) => u.url === url), state,
          verdict: state === 'indexed' ? 'PASS' : state === 'not_indexed' ? 'NEUTRAL' : null,
          coverage_state: state === 'indexed' ? 'Trimisă și indexată' : state === 'not_indexed' ? 'Accesată cu crawlere, momentan neindexată' : null,
          indexing_state: state === 'unknown' ? null : 'INDEXING_ALLOWED', robots_txt_state: state === 'unknown' ? null : 'ALLOWED', page_fetch_state: state === 'unknown' ? null : 'SUCCESSFUL',
          crawled_as: state === 'unknown' ? null : 'MOBILE', last_crawl_time: state === 'unknown' ? null : `${addDays(day, -Math.round(r * 10))}T04:12:00+00:00`,
          google_canonical: state === 'unknown' ? null : mismatch ? `${url}?ref=canonic` : url, user_canonical: state === 'unknown' ? null : url,
          canonical_matches: state === 'unknown' ? null : !mismatch, inspected_on: day,
        }
      })
      const known = new Set(urls.map((u) => u.url))
      const count = (s: IndexState) => urls.filter((u) => u.state === s).length
      return ready({
        inspected_on: urls.length ? day : null,
        summary: { total: urls.length, indexed: count('indexed'), not_indexed: count('not_indexed'), unknown: count('unknown'), canonical_mismatch: urls.filter((u) => u.canonical_matches === false).length },
        urls,
        priority_urls: list.map((u) => ({ ...u, inspected: known.has(u.url) })),
      })
    },

    addIndexUrl: async (brand, url) => {
      if (!allowed.has(brand.id)) return denied
      const list = priorityOf(brand.id)
      if (!/^https?:\/\/\S+$/.test(url.trim())) return failed('Adresa trebuie să înceapă cu http:// sau https:// și să nu conțină spații.')
      if (list.some((u) => u.url === url.trim())) return failed('URL-ul e deja în listă.')
      list.push({ id: `idx-${brand.id}-${++seq}`, url: url.trim(), inspected: false })
      return ready(null)
    },

    removeIndexUrl: async (id) => {
      for (const [brandId, list] of priority) priority.set(brandId, list.filter((u) => u.id !== id))
      return ready(null)
    },
  }
}
