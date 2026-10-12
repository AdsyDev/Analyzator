import { failed, notConnected, ready, SOCIAL_PLATFORMS, type ProviderResult, type QueryContext, type SocialFilters, type SocialKpi, type SocialKpiKey, type SocialPlatform, type SocialPost, type SocialProvider } from '../../contracts'
import { METRIC_STATUSES } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'

const NO_SOURCE = 'Nu există date sociale pentru acest brand: Planable nu a rulat încă și nu există niciun import.'
const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const NO_FORMAT_TOPIC = 'Planable nu trimite formatul și subiectul postărilor, deci gruparea pe format și pe subiect nu se poate calcula.'
const NO_COMPETITORS = 'Conturile sociale ale competitorilor nu se colectează încă; comparația apare după ce sunt adăugate.'

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
          p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset),
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
    competitors: async () => notConnected(NO_COMPETITORS),
  }
}
