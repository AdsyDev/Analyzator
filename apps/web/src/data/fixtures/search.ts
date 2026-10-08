import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import searchFile from '../../../../../tests/fixtures/ui/search.json'
import { failed, ready, type ContentGap, type LandingPage, type SearchKeyword, type SearchProvider } from '../../contracts'
import { daysBetween } from '../../lib/period'
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
  }
}
