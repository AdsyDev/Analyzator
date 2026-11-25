import type { AutoSentiment, ListeningCompetition, ListeningOverview, Mention, QueryContext } from '../../contracts'
import { addDays, daysBetween } from '../../lib/period'
import { unit } from './rng'

/** Competitorii unui brand din fixtures (`brands.json`). */
export interface FixtureSet {
  version: number
  effective_from: string
  competitors: Array<{ id: string; name: string; label: string }>
}

const r1 = (n: number) => Math.round(n * 10) / 10
const pct = (num: number, den: number) => (den > 0 ? r1((100 * num) / den) : null)

function sentimentOf(values: Array<'positive' | 'neutral' | 'negative' | 'unknown'>, owned = 0): AutoSentiment {
  const count = (s: string) => values.filter((v) => v === s).length
  const [pos, neu, neg] = [count('positive'), count('neutral'), count('negative')]
  const total = pos + neu + neg
  return { total, positive: pos, neutral: neu, negative: neg, unknown: count('unknown'), owned_excluded: owned, shares: { positive: pct(pos, total), neutral: pct(neu, total), negative: pct(neg, total) }, net: pct(pos - neg, total) }
}

/**
 * Ecranul Listening din fixtures (doar preview și teste): agregările sunt stand-in pentru `brand_listening_overview`. Mențiunile
 * fictive nu au interacțiuni (lipsă, nu zero); sentimentul automat folosește eticheta fictivă, unde există. Competitorii au
 * volume deterministe, ca secțiunea să se poată vedea; toate zilele sunt considerate citite.
 */
export function fixtureListeningOverview(ctx: QueryContext, mentions: Mention[], brandName: string, set: FixtureSet | undefined): ListeningOverview {
  const n = daysBetween(ctx.period.from, ctx.period.to) + 1
  const days = Array.from({ length: n }, (_, i) => addDays(ctx.period.from, i))
  const dayOf = (m: Mention) => m.published_at.slice(0, 10)
  const inRange = mentions.filter((m) => dayOf(m) >= ctx.period.from && dayOf(m) <= ctx.period.to)
  const external = inRange.filter((m) => m.owned_account !== true)
  const platformNames = [...new Set(inRange.map((m) => m.source_name))]
  const platforms = platformNames
    .map((p) => {
      const of = inRange.filter((m) => m.source_name === p)
      return { platform: p, mentions: of.length, share: pct(of.length, inRange.length), values: days.map((d) => of.filter((m) => dayOf(m) === d).length) }
    })
    .sort((a, b) => b.mentions - a.mentions || a.platform.localeCompare(b.platform))
  const brandSentiment = sentimentOf(external.map((m) => m.sentiment ?? 'unknown'), inRange.length - external.length)
  const voices = new Map<string, { name: string; platform: string; mentions: number }>()
  for (const m of external) {
    if (!m.author) continue
    const k = `${m.source_name}|${m.author.toLowerCase()}`
    const v = voices.get(k) ?? { name: m.author, platform: m.source_name, mentions: 0 }
    v.mentions++
    voices.set(k, v)
  }

  let competition: ListeningCompetition | null = null
  if (set) {
    const brandId = ctx.brandId
    const competitorCounts = set.competitors.map((c) => Math.round(inRange.length * (0.4 + unit(`${c.id}:${ctx.period.to}`) * 0.9)))
    const all = inRange.length + competitorCounts.reduce((s, v) => s + v, 0)
    const counts: Record<string, Record<string, number>> = { [brandId]: Object.fromEntries(platforms.map((p) => [p.platform, p.mentions])) }
    set.competitors.forEach((c, i) => {
      const total = competitorCounts[i] ?? 0
      const first = Math.round(total * 0.6)
      counts[c.id] = Object.fromEntries(platformNames.length ? [[platformNames[0]!, first], ...(platformNames[1] ? [[platformNames[1], total - first]] : [])] : [])
    })
    const cell = (value: number, unit: 'count' | 'percent') => ({ value, unit, status: 'ok' as const, coverage: 1, reason: null })
    competition = {
      set_version: set.version,
      effective_from: set.effective_from,
      entities: [
        { id: brandId, name: brandName, label: brandName, kind: 'brand', mentions: cell(inRange.length, 'count'), share_of_voice: cell(pct(inRange.length, all) ?? 0, 'percent'), sentiment: brandSentiment, tracked: true },
        ...set.competitors.map((c, i) => {
          const total = competitorCounts[i] ?? 0
          const pos = Math.round(total * (0.2 + unit(`${c.id}:pos`) * 0.3))
          const neg = Math.round(total * unit(`${c.id}:neg`) * 0.15)
          const values = [...Array(pos).fill('positive'), ...Array(neg).fill('negative'), ...Array(Math.max(0, total - pos - neg)).fill('neutral')] as Array<'positive' | 'neutral' | 'negative'>
          return { id: c.id, name: c.name, label: c.label, kind: 'competitor' as const, mentions: cell(total, 'count'), share_of_voice: cell(pct(total, all) ?? 0, 'percent'), sentiment: sentimentOf(values), tracked: true }
        }),
      ],
      platforms: platformNames.map((p) => {
        const byEntity = Object.fromEntries(Object.entries(counts).map(([id, c]) => [id, c[p] ?? 0]))
        const total = Object.values(byEntity).reduce((s, v) => s + v, 0)
        return { platform: p, counts: byEntity, total, brand_share: pct(byEntity[brandId] ?? 0, total) }
      }),
    }
  }

  return {
    days,
    total: inRange.length,
    series: days.map((d) => inRange.filter((m) => dayOf(m) === d).length),
    platforms,
    engagement: { value: null, mentions_with_value: 0, mentions: inRange.length, comparison: { start: addDays(ctx.period.from, -n), end: addDays(ctx.period.from, -1), value: null }, change: { relative_change: null, absolute_change: null, base_zero: false } },
    auto_sentiment: brandSentiment,
    top_voices: [...voices.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)).slice(0, 10).map((v) => ({ name: v.name, username: null, platform: v.platform, mentions: v.mentions, engagement: null })),
    voices_basis: { external: external.length, with_author: external.filter((m) => !!m.author).length },
    topics: [],
    topics_tracked: false,
    competition,
  }
}
