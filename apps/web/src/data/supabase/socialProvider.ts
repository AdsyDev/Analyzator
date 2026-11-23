import { failed, notConnected, ready, SOCIAL_PLATFORMS, type ProviderResult, type QueryContext, type SocialCompetitor, type SocialFilters, type SocialKpi, type SocialKpiKey, type SocialPlatform, type SocialPost, type SocialProvider } from '../../contracts'
import { METRIC_STATUSES } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'

const NO_SOURCE = 'Nu există date sociale pentru acest brand: Planable nu a rulat încă și nu există niciun import.'
const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const NO_FORMAT_TOPIC = 'Planable nu trimite formatul și subiectul postărilor, deci gruparea pe format și pe subiect nu se poate calcula.'
const NO_SET = 'Brandul nu are încă un set de competitori în vigoare; comparația apare după configurarea lui.'
const NO_PROFILES = 'Competitorii din set nu au profiluri sociale din Planable. Adaugă-le într-o versiune nouă a setului (Administrare → Configurare → Competitori).'
const SOCIAL_KEYS = { posts_per_week: 'social_cadence', followers: 'social_followers', public_interactions_per_post: 'social_interactions_per_post' } as const

type CompetitionCellRaw = { value?: unknown; status?: unknown; reason?: unknown }
type CompetitionRaw = {
  has_set?: unknown
  entities?: Array<{ id?: unknown; name?: unknown; kind?: unknown; label?: unknown }>
  groups?: Array<{ dimension?: unknown; rows?: Array<{ key?: unknown; cells?: Record<string, CompetitionCellRaw> }> }>
  social_as_of?: Record<string, unknown>
}

/**
 * Concurența publică din matricea de Concurență (`brand_competition`, grupul social): aceleași valori și aceleași reguli ca
 * în ecranul Concurență. O celulă fără date (N/A, neconectată) devine `null`, nu 0.
 */
export function socialCompetitors(raw: unknown): ProviderResult<SocialCompetitor[]> {
  const d = raw as CompetitionRaw | null
  if (!d || typeof d.has_set !== 'boolean') return failed(CONTRACT)
  if (!d.has_set) return notConnected(NO_SET)
  const social = d.groups?.find((g) => g.dimension === 'social')
  if (!social || !Array.isArray(social.rows) || !Array.isArray(d.entities)) return failed(CONTRACT)
  const cellOf = (key: string, id: string): CompetitionCellRaw | undefined => social.rows!.find((r) => r.key === key)?.cells?.[id]
  const competitors = d.entities.filter((e) => e.kind === 'competitor')
  if (!competitors.every((e) => typeof e.id === 'string' && typeof e.name === 'string' && typeof e.label === 'string')) return failed(CONTRACT)
  const value = (key: string, id: string) => {
    const c = cellOf(key, id)
    if (c === undefined || !(METRIC_STATUSES as readonly string[]).includes(String(c.status))) throw new Error(CONTRACT)
    return c.status === 'ok' || c.status === 'partial' ? num(c.value) : null
  }
  try {
    const rows = competitors.map<SocialCompetitor>((e) => {
      const id = e.id as string
      const asOf = d.social_as_of?.[id]
      return {
        label: e.label as string,
        name: e.name as string,
        posts_per_week: value(SOCIAL_KEYS.posts_per_week, id),
        followers: value(SOCIAL_KEYS.followers, id),
        public_interactions_per_post: value(SOCIAL_KEYS.public_interactions_per_post, id),
        as_of: typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null,
      }
    })
    // Niciun competitor nu are profiluri sociale: legătura cu datele Planable lipsește, nu datele.
    const unlinked = competitors.every((e) => String(cellOf(SOCIAL_KEYS.posts_per_week, e.id as string)?.reason ?? '').includes('nu are profiluri sociale'))
    if (competitors.length === 0 || unlinked) return notConnected(NO_PROFILES)
    return ready(rows)
  } catch {
    return failed(CONTRACT)
  }
}

/** Textele cardurilor (descrieri, nu formule: valorile vin din SQL). */
const KPI_TEXT: Record<SocialKpiKey, { label: string; definition: string; note: string | null }> = {
  posts: { label: 'Postări', definition: 'Postările publicate în perioadă pe conturile brandului din Planable.', note: null },
  followers: { label: 'Urmăritori', definition: 'Suma urmăritorilor conturilor, la ultima observație din perioadă.', note: null },
  net_growth: { label: 'Creștere netă', definition: 'Pe fiecare cont: ultima minus prima observație de urmăritori din perioadă, însumat. Lipsește dacă un cont are o singură observație.', note: null },
  interactions: { label: 'Interacțiuni', definition: 'Interacțiunile zilnice raportate de Planable, însumate pe perioadă.', note: null },
  reach: { label: 'Reach', definition: 'Persoane unice care au văzut conținutul.', note: 'Reach-ul zilnic nu se poate aduna între zile, iar Planable nu dă un total pe perioadă.' },
}

type Report = {
  connected: boolean
  kpis: Array<Record<string, unknown>>
  posts: Array<Record<string, unknown>>
  data_as_of: string | null
  imported_at: string | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

function kpi(o: Record<string, unknown>): SocialKpi {
  const key = o.key as SocialKpiKey
  if (!(key in KPI_TEXT) || !(METRIC_STATUSES as readonly string[]).includes(String(o.status))) throw new Error(CONTRACT)
  return { key, ...KPI_TEXT[key], value: num(o.value), change: num(o.change), status: o.status as SocialKpi['status'] }
}

function post(o: Record<string, unknown>): SocialPost {
  if (typeof o.id !== 'string' || typeof o.published_at !== 'string' || !(SOCIAL_PLATFORMS as readonly string[]).includes(String(o.platform))) throw new Error(CONTRACT)
  return {
    id: o.id,
    published_at: o.published_at,
    platform: o.platform as SocialPlatform,
    format: null,
    topic: null,
    label: null,
    excerpt: typeof o.excerpt === 'string' ? o.excerpt : '',
    permalink: typeof o.permalink === 'string' ? o.permalink : null,
    age_days: num(o.age_days) ?? 0,
    mature: o.mature === true,
    reach: num(o.reach),
    impressions: num(o.impressions),
    interactions: num(o.interactions),
  }
}

/**
 * Social din SQL (`brand_social`, SECURITY INVOKER, D-23): indicatorii și postările calculate pe server (regula 4).
 * Un singur apel per context și platformă; KPI-urile, postările și calendarul îl împart.
 */
export function createSupabaseSocial(client: DataClient): SocialProvider {
  const cache = new Map<string, Promise<ProviderResult<Report>>>()
  function report(ctx: QueryContext, f: SocialFilters): Promise<ProviderResult<Report>> {
    const key = [ctx.brandId, ctx.period.from, ctx.period.to, ctx.period.preset, f.platform ?? 'all'].join('|')
    let p = cache.get(key)
    if (!p) {
      p = (async () => {
        const { data, error } = await client.rpc('brand_social', {
          p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset, ctx.comparison),
          p_platform: f.platform && (SOCIAL_PLATFORMS as readonly string[]).includes(f.platform) ? f.platform : null,
        })
        if (error) return failed<Report>(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Datele sociale nu au putut fi citite. Reîncearcă.')
        const r = data as Report | null
        if (!r || typeof r.connected !== 'boolean') return failed<Report>(CONTRACT)
        if (!r.connected) return notConnected<Report>(NO_SOURCE)
        if (!Array.isArray(r.kpis) || !Array.isArray(r.posts)) return failed<Report>(CONTRACT)
        return ready(r)
      })()
      cache.set(key, p)
      void p.finally(() => setTimeout(() => cache.delete(key), 30_000))
    }
    return p
  }
  const guarded = async <T,>(r: ProviderResult<Report>, map: (d: Report) => T): Promise<ProviderResult<T>> => {
    if (r.kind !== 'ready') return r
    try {
      return ready(map(r.data))
    } catch {
      return failed(CONTRACT)
    }
  }

  return {
    async summary(ctx, f) {
      return guarded(await report(ctx, f), (d) => ({ kpis: d.kpis.map(kpi), imported_at: d.imported_at ?? '', data_as_of: d.data_as_of ?? '' }))
    },
    async posts(ctx, f) {
      return guarded(await report(ctx, f), (d) => d.posts.map(post))
    },
    async calendar(ctx, f) {
      return guarded(await report(ctx, f), (d) =>
        d.posts.map(post).map((p) => ({
          // Ziua publicării în Europe/Bucharest (regula 9).
          date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date(p.published_at)),
          post_id: p.id,
          platform: p.platform,
          label: null,
          has_performance: p.interactions !== null || p.impressions !== null || p.reach !== null,
        })),
      )
    },
    groups: async () => notConnected(NO_FORMAT_TOPIC),
    async competitors(ctx) {
      const { data, error } = await client.rpc('brand_competition', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset, ctx.comparison) })
      if (error) return failed(error.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : 'Datele concurenței nu au putut fi citite. Reîncearcă.')
      return socialCompetitors(data)
    },
  }
}
