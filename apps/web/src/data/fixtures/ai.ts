import aiFile from '../../../../../tests/fixtures/ui/ai.json'
import brandsFile from '../../../../../tests/fixtures/ui/brands.json'
import {
  AI_ENGINES,
  VALID_OUTCOMES,
  failed,
  notConnected,
  ready,
  type AiAnswerDetail,
  type AiCitation,
  type AiCitedSource,
  type AiEngine,
  type AiEngineStat,
  type AiEngineTrend,
  type AiFilters,
  type AiMatrixCell,
  type AiMatrixEntity,
  type AiTopicMatrix,
  type AiVisibilityProvider,
  type AnswerOutcome,
  type AnswerSegment,
  type PvFlag,
} from '../../contracts'
import { addDays, daysBetween, lastCompleteDay } from '../../lib/period'
import { unit } from './rng'

interface QuestionDef {
  group: string
  text: string
}
interface BrandAi {
  questions: QuestionDef[]
  forced: Record<string, AnswerOutcome>
}

const ai = aiFile.brands as unknown as Record<string, BrandAi>
const THIRD_PARTY = aiFile.third_party_domains
const COLLECTION_NOTES: Partial<Record<AiEngine, string>> = {
  gemini: 'Furnizorul numește suprafața „Gemini AI Mode”; ruta de colectare e în curs de clarificare.',
  aio: 'Suprafață AI Overviews, colectată din rezultatele Google.',
}

/** Prima literă mică, restul neschimbat: „Prevenție ITU" devine „prevenție ITU", nu „prevenție itu". */
const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const pct = (num: number, den: number) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null)

function entitiesFor(brandId: string): AiMatrixEntity[] {
  const brand = brandsFile.brands.find((b) => b.id === brandId)
  const set = (brandsFile.competitor_sets as Record<string, { competitors: Array<{ id: string; name: string; label: string }> }>)[brandId]
  if (!brand || !set) return []
  return [{ id: brand.id, name: brand.name, kind: 'brand', label: brand.name }, ...set.competitors.map<AiMatrixEntity>((c) => ({ id: c.id, name: c.name, kind: 'competitor', label: c.label }))]
}

/**
 * Răspunsurile fictive ale unui brand: determinist, din întrebările din `ai.json`. Ratele, matricea și
 * sursele citate se calculează apoi din aceste răspunsuri, ca să poată fi reproduse din ce se afișează
 * (spec cap. 13, acceptare). Calculul stă aici, în fixtures, nu în componente (regula 4).
 */
function buildAnswers(brandId: string, to: string): AiAnswerDetail[] {
  const def = ai[brandId]
  const entities = entitiesFor(brandId)
  const brand = entities[0]
  const comps = entities.slice(1)
  if (!def || !brand) return []
  const brandDomain = brandsFile.brands.find((b) => b.id === brandId)?.domain ?? ''
  const out: AiAnswerDetail[] = []

  def.questions.forEach((q, qi) => {
    AI_ENGINES.forEach((engine, ei) => {
      const key = `${brandId}:${qi}:${engine}`
      const forced = def.forced[`${qi}:${engine}`]
      const r = unit(`${key}:o`)
      const outcome: AnswerOutcome = forced ?? (r < 0.28 ? 'recommended' : r < 0.6 ? 'mentioned' : 'not_mentioned')
      const valid = VALID_OUTCOMES.has(outcome)
      const idx = qi * AI_ENGINES.length + ei
      const base = {
        id: `ans-${brandId}-${qi}-${engine}`,
        question: q.text,
        engine,
        group: q.group,
        collected_at: `${addDays(to, -(idx % 21))}T03:30:00Z`,
        outcome,
        pv_flag: null,
        collection_note: COLLECTION_NOTES[engine] ?? null,
      }
      if (!valid) {
        out.push({ ...base, segments: [], citations: [], entities_present: [], entities_recommended: [] })
        return
      }

      const present = comps.filter((c) => unit(`${key}:c:${c.label}`) < 0.5)
      if (outcome === 'not_mentioned' && present.length === 0 && comps[0]) present.push(comps[0])
      const brandIn = outcome !== 'not_mentioned'
      const recommended = [...(outcome === 'recommended' ? [brand.id] : []), ...(present[0] && unit(`${key}:rc`) < 0.3 ? [present[0].id] : [])]

      const citations: AiCitation[] = []
      const pool = [...THIRD_PARTY].sort((a, b) => unit(`${key}:${a}`) - unit(`${key}:${b}`))
      const withOwned = brandIn && unit(`${key}:own`) < 0.5
      if (withOwned) citations.push({ n: 1, domain: brandDomain, title: `${brand.name}: pagina produsului`, url: `https://${brandDomain}/produse`, owned: true })
      for (const d of pool) {
        if (citations.length >= 3) break
        const n = citations.length + 1
        citations.push({ n, domain: d, title: `Articol despre ${lcFirst(q.group)}`, url: unit(`${key}:${d}:u`) < 0.05 ? null : `https://${d}/${slug(q.group)}`, owned: false })
      }

      const topic = lcFirst(q.group)
      const segs: AnswerSegment[] = [{ kind: 'text', text: `Pentru ${topic}, primul pas este o discuție cu medicul, mai ales dacă simptomele revin. ` }, { kind: 'cite', n: 1 }]
      if (brandIn) {
        segs.push({ kind: 'text', text: outcome === 'recommended' ? ' Ca sprijin, mulți farmaciști recomandă ' : ' Printre produsele disponibile în farmacii se numără ' })
        segs.push({ kind: 'brand', text: brand.name, entity_id: brand.id })
      } else {
        segs.push({ kind: 'text', text: ' Printre opțiunile disponibile în farmacii se numără ' })
        const first = present[0]
        if (first) segs.push({ kind: 'brand', text: first.name, entity_id: first.id })
      }
      const others = brandIn ? present : present.slice(1)
      others.forEach((c, i) => {
        segs.push({ kind: 'text', text: i === 0 ? ', alături de ' : ' și ' })
        segs.push({ kind: 'brand', text: c.name, entity_id: c.id })
      })
      segs.push({ kind: 'cite', n: 2 })
      segs.push({ kind: 'text', text: '. Hidratarea și un stil de viață echilibrat contează la fel de mult ca suplimentul ales ' })
      segs.push({ kind: 'cite', n: 3 })
      segs.push({ kind: 'text', text: '.' })

      out.push({
        ...base,
        segments: segs,
        citations,
        entities_present: [...(brandIn ? [brand.id] : []), ...present.map((c) => c.id)],
        entities_recommended: recommended,
      })
    })
  })
  return out
}

export const answerPlainText = (a: AiAnswerDetail): string => a.segments.map((s) => (s.kind === 'cite' ? `[${s.n}]` : s.text)).join('')

/** Numărători pe entitate, din răspunsurile generate (pentru matricea de Concurență). */
export interface AiEntityRates {
  entities: AiMatrixEntity[]
  total: number
  valid: number
  mentioned: Record<string, number>
  recommended: Record<string, number>
  /** Răspunsuri valide cu cel puțin o citare owned a brandului. */
  ownedCited: number
}

export interface AiFixtures {
  provider: AiVisibilityProvider
  rates: (brandId: string, to: string) => AiEntityRates
  /** Textul sanitizat al unui răspuns, pentru previzualizarea marcării PV. */
  plainText: (brandId: string, id: string) => string | null
}

export function createAiFixtures({ allowed, flags, now }: { allowed: Set<string>; flags: Map<string, PvFlag>; now: () => Date }): AiFixtures {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const cache = new Map<string, AiAnswerDetail[]>()
  // Ultima zi cerută la listare, ca detaliul unui răspuns să afișeze aceeași dată de colectare.
  const lastTo = new Map<string, string>()
  const toFor = (brandId: string) => lastTo.get(brandId) ?? lastCompleteDay(now())
  const answersFor = (brandId: string, to: string): AiAnswerDetail[] => {
    lastTo.set(brandId, to)
    const k = `${brandId}:${to}`
    let list = cache.get(k)
    if (!list) cache.set(k, (list = buildAnswers(brandId, to)))
    return list.map((a) => ({ ...a, pv_flag: flags.get(`ai_answer:${a.id}`) ?? null }))
  }
  const byGroup = (list: AiAnswerDetail[], f: AiFilters) => (f.group ? list.filter((a) => a.group === f.group) : list)
  const scoped = (list: AiAnswerDetail[], f: AiFilters) => byGroup(list, f).filter((a) => !f.engine || a.engine === f.engine)

  const provider: AiVisibilityProvider = {
    groups: async (brandId) => (allowed.has(brandId) ? ready([...new Set((ai[brandId]?.questions ?? []).map((q) => q.group))]) : denied),

    engines: async (ctx, f) => {
      if (!allowed.has(ctx.brandId)) return denied
      const list = byGroup(answersFor(ctx.brandId, ctx.period.to), f)
      return ready(
        AI_ENGINES.map<AiEngineStat>((engine) => {
          const mine = list.filter((a) => a.engine === engine)
          const valid = mine.filter((a) => VALID_OUTCOMES.has(a.outcome))
          const hits = valid.filter((a) => a.outcome !== 'not_mentioned').length
          const rate = pct(hits, valid.length)
          return {
            engine,
            mention_rate: rate,
            // Variația fictivă, deterministă: stand-in pentru comparația calculată de server.
            delta_pp: rate === null ? null : Math.round((unit(`${ctx.brandId}:${engine}:d`) - 0.5) * 100) / 10,
            valid_answers: valid.length,
            total_answers: mine.length,
            status: valid.length === 0 ? 'unavailable' : valid.length < mine.length ? 'partial' : 'ok',
          }
        }),
      )
    },

    trends: async (ctx, f) => {
      if (!allowed.has(ctx.brandId)) return denied
      const stats = await provider.engines(ctx, f)
      if (stats.kind !== 'ready') return stats
      const days = daysBetween(ctx.period.from, ctx.period.to) + 1
      return ready(
        stats.data.map<AiEngineTrend>((s) => ({
          engine: s.engine,
          status: s.status,
          points:
            s.mention_rate === null
              ? []
              : Array.from({ length: days }, (_, i) => {
                  const date = addDays(ctx.period.from, i)
                  // Gemini are zile necolectate: gol în serie, nu zero.
                  if (s.engine === 'gemini' && i % 9 === 4) return { date, value: null }
                  const v = (s.mention_rate ?? 0) + (unit(`${ctx.brandId}:${s.engine}:${date}`) - 0.5) * 8
                  return { date, value: Math.round(Math.min(100, Math.max(0, v)) * 10) / 10 }
                }),
        })),
      )
    },

    topicMatrix: async (ctx, f) => {
      if (!allowed.has(ctx.brandId)) return denied
      const list = scoped(answersFor(ctx.brandId, ctx.period.to), f)
      const entities = entitiesFor(ctx.brandId)
      const groups = [...new Set((ai[ctx.brandId]?.questions ?? []).map((q) => q.group))].filter((g) => !f.group || g === f.group)
      const cells: Record<string, Record<string, AiMatrixCell>> = {}
      const topics = groups.map((g) => {
        const mine = list.filter((a) => a.group === g)
        const valid = mine.filter((a) => VALID_OUTCOMES.has(a.outcome))
        cells[g] = Object.fromEntries(
          entities.map((e) => {
            const num = valid.filter((a) => a.entities_present.includes(e.id)).length
            const value = pct(num, valid.length)
            return [e.id, { value, numerator: valid.length ? num : null, denominator: valid.length || null, status: valid.length === 0 ? 'unavailable' : valid.length < mine.length ? 'partial' : 'ok' } as AiMatrixCell]
          }),
        )
        return { topic: g, group: g, n: valid.length, coverage: mine.length ? valid.length / mine.length : null }
      })
      const matrix: AiTopicMatrix = { entities, topics, cells }
      return ready(matrix)
    },

    citedSources: async (ctx, f) => {
      if (!allowed.has(ctx.brandId)) return denied
      const valid = scoped(answersFor(ctx.brandId, ctx.period.to), f).filter((a) => VALID_OUTCOMES.has(a.outcome))
      const counts = new Map<string, AiCitedSource>()
      for (const a of valid) {
        for (const c of a.citations) {
          const cur = counts.get(c.domain) ?? { domain: c.domain, kind: c.owned ? 'owned' : 'third_party', count: 0, brand_id: c.owned ? ctx.brandId : null }
          cur.count += 1
          counts.set(c.domain, cur)
        }
      }
      return ready([...counts.values()].sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 8))
    },

    answers: async (ctx, f, { page, page_size }) => {
      if (!allowed.has(ctx.brandId)) return denied
      const list = scoped(answersFor(ctx.brandId, ctx.period.to), f).sort((a, b) => b.collected_at.localeCompare(a.collected_at) || a.id.localeCompare(b.id))
      const start = (page - 1) * page_size
      const items = list.slice(start, start + page_size).map(({ segments: _s, citations: _c, entities_present: _p, entities_recommended: _r, collection_note: _n, ...summary }) => summary)
      return ready({ items, total: list.length, page, page_size })
    },

    answer: async (brandId, id) => {
      if (!allowed.has(brandId)) return denied
      // `to` nu contează pentru conținut; data de colectare e relativă la ziua cerută la listare.
      const found = answersFor(brandId, toFor(brandId)).find((a) => a.id === id)
      return found ? ready(found) : notConnected('Răspunsul nu a fost găsit.')
    },
  }

  return {
    provider,
    rates: (brandId, to) => {
      const answers = answersFor(brandId, to)
      const valid = answers.filter((a) => VALID_OUTCOMES.has(a.outcome))
      const entities = entitiesFor(brandId)
      return {
        entities,
        total: answers.length,
        valid: valid.length,
        mentioned: Object.fromEntries(entities.map((e) => [e.id, valid.filter((a) => a.entities_present.includes(e.id)).length])),
        recommended: Object.fromEntries(entities.map((e) => [e.id, valid.filter((a) => a.entities_recommended.includes(e.id)).length])),
        ownedCited: valid.filter((a) => a.citations.some((c) => c.owned)).length,
      }
    },
    plainText: (brandId, id) => {
      const a = answersFor(brandId, toFor(brandId)).find((x) => x.id === id)
      return a && a.segments.length > 0 ? answerPlainText(a) : null
    },
  }
}
