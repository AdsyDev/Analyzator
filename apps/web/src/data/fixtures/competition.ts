import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import {
  failed,
  notConnected,
  ready,
  type CompetitionCell,
  type CompetitionEntity,
  type CompetitionGap,
  type CompetitionGroup,
  type CompetitionProvider,
  type CompetitionRow,
  type MentionsProvider,
  type MetricDirection,
  type MetricUnit,
  type SearchProvider,
  type SocialProvider,
} from '../../contracts'
import { daysBetween } from '../../lib/period'
import type { AiFixtures } from './ai'

const r1 = (n: number) => Math.round(n * 10) / 10
const pct = (num: number, den: number) => (den > 0 ? r1((100 * num) / den) : null)

interface Deps {
  allowed: Set<string>
  ai: AiFixtures
  search: SearchProvider
  social: SocialProvider
  mentions: MentionsProvider
}

const cell = (value: number | null, unit: MetricUnit, over: Partial<CompetitionCell> = {}): CompetitionCell => ({
  value,
  unit,
  status: value === null ? 'unavailable' : 'ok',
  coverage: null,
  reason: null,
  ...over,
})

/**
 * Matricea de Concurență din fixtures, compusă din celelalte seturi (AI, SEO, social, Listening), ca valorile să
 * se potrivească cu paginile respective. Calculele de aici sunt stand-in pentru serverul real (doar fixtures);
 * ce sursa nu oferă pentru competitori rămâne N/A cu motiv.
 */
export function createCompetitionFixtures({ allowed, ai, search, social, mentions }: Deps): CompetitionProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const setFor = (brandId: string) => (brandsFile.competitor_sets as Record<string, { version: number; effective_from: string; competitors: Array<{ id: string; name: string; label: string }> }>)[brandId]

  const entitiesFor = (brandId: string): CompetitionEntity[] => {
    const brand = brandsFile.brands.find((b) => b.id === brandId)
    const set = setFor(brandId)
    if (!brand || !set) return []
    return [{ id: brand.id, name: brand.name, kind: 'brand', label: brand.name }, ...set.competitors.map<CompetitionEntity>((c) => ({ id: c.id, name: c.name, kind: 'competitor', label: c.label }))]
  }

  return {
    matrix: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const set = setFor(ctx.brandId)
      const entities = entitiesFor(ctx.brandId)
      const brand = entities[0]
      if (!set || !brand) return notConnected('Setul de competitori nu e configurat pentru acest brand.')
      const row = (key: string, label: string, definition: string, direction: MetricDirection, cells: Record<string, CompetitionCell>): CompetitionRow => ({ key, label, definition, direction, cells })
      const all = (f: (e: CompetitionEntity) => CompetitionCell) => Object.fromEntries(entities.map((e) => [e.id, f(e)]))
      const groups: CompetitionGroup[] = []

      // AI: aceleași întrebări și engine-uri pentru toate entitățile (panelul e comun).
      const rates = ai.rates(ctx.brandId, ctx.period.to)
      const cov = rates.total ? rates.valid / rates.total : null
      const aiStatus = cov !== null && cov < 1 ? ('partial' as const) : ('ok' as const)
      groups.push({
        dimension: 'ai',
        title: 'AI',
        source: 'SEOmonitor',
        rows: [
          row('ai_mention', 'Mention Rate', 'Procentul de răspunsuri valide în care apare entitatea, pe aceleași întrebări și engine-uri.', 'higher_is_better', all((e) => cell(pct(rates.mentioned[e.id] ?? 0, rates.valid), 'percent', { status: aiStatus, coverage: cov }))),
          row('ai_recommendation', 'Recommendation Rate', 'Procentul de răspunsuri valide care recomandă explicit entitatea.', 'higher_is_better', all((e) => cell(pct(rates.recommended[e.id] ?? 0, rates.valid), 'percent', { status: aiStatus, coverage: cov }))),
          row('ai_owned_citation', 'Owned Citation Rate', 'Procentul de răspunsuri valide cu cel puțin o citare a domeniului propriu. Pentru competitori, domeniile nu sunt confirmate.', 'higher_is_better', all((e) => (e.kind === 'brand' ? cell(pct(rates.ownedCited, rates.valid), 'percent', { status: aiStatus, coverage: cov }) : cell(null, 'percent', { reason: 'Domeniile competitorilor nu sunt confirmate; nu putem recunoaște citările lor owned.' })))),
        ],
      })

      // SEO: pe keywords urmărite; competitorii apar doar acolo unde sunt observați.
      const kw = await search.keywords(ctx, { keywordType: null })
      if (kw.kind === 'ready') {
        const partial = 'Pentru competitori se observă doar keywordurile urmărite în care apar în rezultate.'
        const own = kw.data.filter((k) => k.rank_mobile !== null)
        const ownPos = own.length ? own.reduce((a, k) => a + (k.rank_mobile ?? 0), 0) / own.length : null
        const of = (label: string) => kw.data.filter((k) => k.competitor?.label === label)
        groups.push({
          dimension: 'seo',
          title: 'SEO',
          source: 'SEOmonitor',
          rows: [
            row('seo_top10', 'Keywords în Top 10', 'Numărul de keywords urmărite în care entitatea e pe pozițiile 1-10 (mobil).', 'higher_is_better', all((e) => (e.kind === 'brand' ? cell(own.filter((k) => (k.rank_mobile ?? 99) <= 10).length, 'count') : cell(of(e.label).filter((k) => (k.competitor?.position ?? 99) <= 10).length, 'count', { status: 'partial', reason: partial })))),
            row('seo_position', 'Poziție medie', 'Poziția medie pe keywords în care entitatea apare. O valoare mai mică e mai bună.', 'lower_is_better', all((e) => {
              if (e.kind === 'brand') return cell(ownPos === null ? null : r1(ownPos), 'position')
              const mine = of(e.label)
              return cell(mine.length ? r1(mine.reduce((a, k) => a + (k.competitor?.position ?? 0), 0) / mine.length) : null, 'position', { status: mine.length ? 'partial' : 'unavailable', reason: mine.length ? partial : 'Competitorul nu apare în keywordurile urmărite.' })
            })),
          ],
        })
      }

      // Social public: aceleași date publice pentru toate entitățile, doar cu import.
      const sSum = await social.summary(ctx, { platform: null, format: null })
      const sPosts = await social.posts(ctx, { platform: null, format: null })
      const sComp = await social.competitors(ctx)
      if (sSum.kind === 'ready' && sPosts.kind === 'ready' && sComp.kind === 'ready') {
        const weeks = (daysBetween(ctx.period.from, ctx.period.to) + 1) / 7
        const withPerf = sPosts.data.filter((p) => p.interactions !== null)
        const followers = sSum.data.kpis.find((k) => k.key === 'followers')?.value ?? null
        const byLabel = new Map(sComp.data.map((c) => [c.label, c]))
        const none = 'Nu avem date publice pentru acest competitor.'
        const comp = (e: CompetitionEntity) => byLabel.get(e.label)
        groups.push({
          dimension: 'social',
          title: 'Social public',
          source: 'Date publice, Planable',
          rows: [
            row('social_cadence', 'Postări / săptămână', 'Ritmul de publicare observat pe profilurile publice.', 'higher_is_better', all((e) => (e.kind === 'brand' ? cell(r1(sPosts.data.length / weeks), 'count') : cell(comp(e)?.posts_per_week ?? null, 'count', { reason: none })))),
            row('social_followers', 'Followers', 'Followers observați la data ultimei observații publice.', 'higher_is_better', all((e) => (e.kind === 'brand' ? cell(followers, 'count') : cell(comp(e)?.followers ?? null, 'count', { reason: none })))),
            row('social_interactions', 'Interacțiuni publice pe postare', 'Interacțiunile publice pe postare; reach-ul nu e public pentru competitori.', 'higher_is_better', all((e) => (e.kind === 'brand' ? cell(withPerf.length ? Math.round(withPerf.reduce((a, p) => a + (p.interactions ?? 0), 0) / withPerf.length) : null, 'count') : cell(comp(e)?.public_interactions_per_post ?? null, 'count', { reason: none })))),
          ],
        })
      } else {
        const reason = 'Nu există date sociale importate pentru acest brand, deci nici comparația publică.'
        groups.push({
          dimension: 'social',
          title: 'Social public',
          source: 'Date publice, Planable',
          rows: [row('social_cadence', 'Postări / săptămână', 'Ritmul de publicare observat pe profilurile publice.', 'higher_is_better', all(() => cell(null, 'count', { status: 'not_connected', reason })))],
        })
      }

      // Listening: doar brandul are sursă; competitorii rămân N/A.
      const dist = await mentions.sentiment(ctx)
      if (dist.kind === 'ready') {
        const noComp = 'Pentru competitori nu există sursă de Listening conectată.'
        groups.push({
          dimension: 'listening',
          title: 'Listening',
          source: null,
          rows: [
            row('listening_mentions', 'Mențiuni eligibile', 'Numărul de mențiuni eligibile în perioadă, în aceleași surse.', 'neutral', all((e) => (e.kind === 'brand' ? cell(dist.data.total + dist.data.unreviewed, 'count') : cell(null, 'count', { status: 'not_connected', reason: noComp })))),
            row('listening_negative', 'Pondere negative', 'Procentul de mențiuni cu sentiment negativ revizuit, din mențiunile revizuite.', 'lower_is_better', all((e) => (e.kind === 'brand' ? cell(dist.data.shares.negative, 'percent') : cell(null, 'percent', { status: 'not_connected', reason: noComp })))),
          ],
        })
      }

      return ready({ entities, groups, set_version: set.version, effective_from: set.effective_from, data_as_of: ctx.period.to })
    },

    gaps: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const out: CompetitionGap[] = []
      const set = setFor(ctx.brandId)
      const name = (label: string) => set?.competitors.find((c) => c.label === label)?.name ?? label

      const gaps = await search.contentGaps(ctx)
      if (gaps.kind === 'ready') {
        for (const g of gaps.data) out.push({ id: `gap-seo-${g.id}`, dimension: 'seo', subject: g.keyword, competitors: [{ label: g.competitor.label, name: g.competitor.name, detail: `poziția ${g.position}` }], brand: 'Fără pagină pentru această căutare' })
      }
      const kw = await search.keywords(ctx, { keywordType: null })
      if (kw.kind === 'ready') {
        for (const k of kw.data.filter((x) => x.rank_mobile === null && x.competitor)) {
          out.push({ id: `gap-rank-${k.id}`, dimension: 'seo', subject: k.keyword, competitors: [{ label: k.competitor!.label, name: name(k.competitor!.label), detail: `poziția ${k.competitor!.position}` }], brand: k.rank_desktop === null ? 'Fără rank pe mobil și desktop' : `Fără rank pe mobil (desktop: ${k.rank_desktop})` })
        }
      }
      const m = await ai.provider.topicMatrix(ctx, { engine: null, group: null })
      if (m.kind === 'ready') {
        const brand = m.data.entities[0]
        for (const t of m.data.topics) {
          const own = brand ? m.data.cells[t.topic]?.[brand.id]?.value ?? null : null
          const ahead = m.data.entities.slice(1).flatMap((e) => {
            const v = m.data.cells[t.topic]?.[e.id]?.value ?? null
            return v !== null && (own === null || v > own) ? [{ label: e.label, name: e.name, detail: `${v.toLocaleString('ro-RO')} % din răspunsuri` }] : []
          })
          if (ahead.length) out.push({ id: `gap-ai-${t.topic}`, dimension: 'ai', subject: t.topic, competitors: ahead, brand: own === null ? 'Fără răspunsuri valide' : `${own.toLocaleString('ro-RO')} % din răspunsuri` })
        }
      }
      return ready(out)
    },
  }
}
