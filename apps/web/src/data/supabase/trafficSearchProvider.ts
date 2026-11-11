import { DEVICES, failed, INDEX_STATES, METRIC_STATUSES, notConnected, ready, type AiReferrals, type ClarityDevices, type Device, type IndexState, type IndexStatus, type IndexedUrl, type LandingPage, type SearchKeyword, type SearchProvider, type TrackingCheck, type TrackingQuality, type TrackingStatus, type TrafficChannels, type TrafficProvider } from '../../contracts'
import { formatDate, formatMetricValue } from '../../lib/format'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const rpcError = (e: { code?: string } | null) => (e?.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

const GA4_OFF = 'Google Analytics 4 nu este conectat pentru acest brand.'
const TRACKING_STATUSES: readonly TrackingStatus[] = ['ok', 'warning', 'problem', 'unknown']
const pct = (v: unknown) => formatMetricValue(num(v), 'percent') ?? 'necunoscut'
const days = (n: number) => (n === 1 ? '1 zi' : `${n} ${n % 100 === 0 || n % 100 >= 20 ? 'de ' : ''}zile`)

/**
 * Textul fiecărei verificări. Starea și pragurile vin de pe server (`brand_tracking_quality`); aici se alege doar
 * formularea în română. O verificare necunoscută oprește ecranul, ca la orice răspuns în afara contractului.
 */
function trackingCheck(c: Record<string, unknown>): TrackingCheck {
  const status = c.status as TrackingStatus
  if (!TRACKING_STATUSES.includes(status)) throw new Error(CONTRACT)
  const id = String(c.id)
  switch (id) {
    case 'key_events': {
      const n = num(c.event_names) ?? 0
      return {
        id, status, title: 'Evenimente cheie (key events)',
        note: n > 0 ? `${n === 1 ? 'Un eveniment cheie a' : `${n} evenimente cheie au`} înregistrat date în perioadă.` : 'Niciun eveniment cheie cu date în perioadă: conversiile din GA4 nu pot fi măsurate până sunt definite key events în proprietate.',
      }
    }
    case 'daily_coverage': {
      const covered = num(c.covered_days) ?? 0
      const expected = num(c.expected_days) ?? 0
      const note =
        status === 'unknown' ? 'Perioada aleasă nu are încă zile colectate din GA4.'
        : status === 'ok' ? `Toate cele ${days(expected)} colectate au sesiuni.`
        : `${days(expected - covered)} din ${expected} fără nicio sesiune: fie nu a existat trafic, fie tagul GA4 nu a trimis date în acele zile.`
      return { id, status, title: 'Zile cu sesiuni înregistrate', note }
    }
    case 'reconciliation': {
      const range = typeof c.period_start === 'string' && typeof c.period_end === 'string' ? ` (${formatDate(c.period_start)} - ${formatDate(c.period_end)})` : ''
      const note =
        status === 'unknown' ? 'Nu există o reconciliere a sesiunilor pentru perioada aleasă.'
        : status === 'ok' ? `Totalul nostru de sesiuni se potrivește cu cel raportat de GA4${range}, în toleranța de ${pct(c.tolerance_pct)}.`
        : `Totalul nostru de sesiuni diferă cu ${pct(Math.abs(num(c.difference_pct) ?? 0))} de cel raportat de GA4${range}, peste toleranța de ${pct(c.tolerance_pct)}.`
      return { id, status, title: 'Reconciliere cu totalul GA4', note }
    }
    case 'unassigned':
      return {
        id, status, title: 'Trafic fără canal (Unassigned)',
        note: status === 'unknown' ? 'Fără sesiuni în perioadă.' : `${pct(c.share_pct)} din sesiuni nu au canal atribuit (prag de avertizare: ${pct(c.threshold_pct)}). Cauza obișnuită: linkuri de campanie fără parametri UTM corecți.`,
      }
    case 'landing_not_set':
      return {
        id, status, title: 'Sesiuni fără landing page',
        note: status === 'unknown' ? 'Fără sesiuni în perioadă.' : `${pct(c.share_pct)} din sesiuni nu au landing page (prag de avertizare: ${pct(c.threshold_pct)}). Apar când GA4 primește evenimente fără nicio afișare de pagină.`,
      }
    default:
      throw new Error(CONTRACT)
  }
}

/** Trafic din SQL (D-14): canale GA4 și Clarity pe device; RPC INVOKER, formule în `metrics`. */
export function createSupabaseTraffic(client: DataClient): TrafficProvider {
  return {
    async channels(ctx, device) {
      // GA4 nu e colectat pe device: nu arătăm canale nefiltrate sub un filtru de device.
      if (device) return notConnected('Defalcarea pe device nu e colectată din GA4; canalele sunt disponibile doar pentru toate device-urile.')
      const { data, error } = await client.rpc('brand_traffic_channels', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset, ctx.comparison) })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; channels?: Array<Record<string, unknown>>; data_as_of?: string | null } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected(GA4_OFF)
      const out: TrafficChannels = {
        device: null,
        data_as_of: d.data_as_of ?? null,
        channels: (d.channels ?? []).map((c) => ({
          channel: String(c.channel), sessions: num(c.sessions), share_pct: num(c.share_pct), change_pct: num(c.change_pct),
          engagement_rate: num(c.engagement_rate), key_events: num(c.key_events),
        })),
      }
      return ready(out)
    },

    // Regulile de clasificare sunt versionate pe server (`metrics.ai_referral_rule_list`, J-1); aici doar se citesc.
    async aiReferrals(ctx) {
      const { data, error } = await client.rpc('brand_ai_referrals', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; sources?: Array<Record<string, unknown>>; rules_version?: unknown; rules_effective_from?: unknown; data_as_of?: string | null } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected(GA4_OFF)
      if (typeof d.rules_version !== 'string' || typeof d.rules_effective_from !== 'string') return failed(CONTRACT)
      const out: AiReferrals = {
        sources: (d.sources ?? []).map((r) => ({ domain: String(r.domain), sessions: num(r.sessions), key_events: num(r.key_events), conversion_rate: num(r.conversion_rate) })),
        rules_version: d.rules_version,
        rules_effective_from: d.rules_effective_from,
        data_as_of: d.data_as_of ?? null,
      }
      return ready(out)
    },

    async clarityDevices(ctx) {
      const { data, error } = await client.rpc('brand_clarity_devices', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; rows?: Array<{ metric_key: string; cells: Record<string, { value: unknown; status: unknown }> }>; data_as_of?: string | null } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected('Microsoft Clarity nu este conectat pentru acest brand.')
      try {
        const out: ClarityDevices = {
          data_as_of: d.data_as_of ?? null,
          rows: (d.rows ?? []).map((r) => ({
            metric_key: r.metric_key,
            cells: Object.fromEntries(
              DEVICES.map((dev: Device) => {
                const c = r.cells[dev]
                if (!c || !(METRIC_STATUSES as readonly string[]).includes(String(c.status))) throw new Error(CONTRACT)
                return [dev, { value: num(c.value), status: c.status as ClarityDevices['rows'][number]['cells'][Device]['status'] }]
              }),
            ) as Record<Device, ClarityDevices['rows'][number]['cells'][Device]>,
          })),
        }
        return ready(out)
      } catch {
        return failed(CONTRACT)
      }
    },

    // Stările și pragurile vin din `brand_tracking_quality` (J-2, J-3); fără nicio colectare GA4 nu există verificări.
    async trackingQuality(ctx) {
      const { data, error } = await client.rpc('brand_tracking_quality', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; checked_at?: string | null; checks?: Array<Record<string, unknown>> } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected(GA4_OFF)
      if (!d.checked_at || !Array.isArray(d.checks) || d.checks.length === 0) return notConnected('Google Analytics 4 e conectat, dar nu are încă nicio colectare: verificările apar după prima sincronizare.')
      try {
        const out: TrackingQuality = { checks: d.checks.map(trackingCheck), checked_at: d.checked_at }
        return ready(out)
      } catch {
        return failed(CONTRACT)
      }
    },
  }
}

/** Refuzul RLS și regulile listei prioritare, în română; restul erorilor nu își arată detaliile. */
function indexWriteError(e: { code?: string; message?: string }, fallback: string): string {
  if (e.code === '42501') return 'Nu ai dreptul să modifici lista de URL-uri a acestui brand.'
  if (e.code === '23505') return 'URL-ul e deja în listă.'
  if (e.code === '23514') return /150/.test(e.message ?? '') ? 'Lista are deja 150 de URL-uri prioritare. Șterge unul ca să adaugi altul.' : 'Adresa trebuie să înceapă cu http:// sau https:// și să nu conțină spații.'
  return fallback
}

/** SEO din SQL (D-14): keywords SEOmonitor și landing pages Search Console. */
export function createSupabaseSearch(client: DataClient): SearchProvider {
  return {
    async keywords(ctx, f) {
      const { data, error } = await client.rpc('brand_search_keywords', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_keyword_type: f.keywordType })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; keywords?: Array<Record<string, unknown>> } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected('SEOmonitor nu este conectat (sau grupurile nu sunt mapate) pentru acest brand.')
      return ready(
        (d.keywords ?? []).map<SearchKeyword>((k) => ({
          id: String(k.id), keyword: String(k.keyword), url: String(k.url ?? ''), volume: num(k.volume),
          volume_as_of: typeof k.volume_as_of === 'string' ? k.volume_as_of : null,
          rank_mobile: num(k.rank_mobile), rank_desktop: num(k.rank_desktop), change_mobile: num(k.change_mobile),
          is_brand: k.is_brand === true, competitor: null, shared: k.shared === true,
        })),
      )
    },

    async landingPages(ctx) {
      const { data, error } = await client.rpc('brand_landing_pages', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; pages?: Array<Record<string, unknown>> } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected('Search Console nu este conectat pentru acest brand.')
      return ready(
        (d.pages ?? []).map<LandingPage>((p) => ({
          url: String(p.url), clicks: num(p.clicks), impressions: num(p.impressions), ctr: num(p.ctr), position: num(p.position), key_events: num(p.key_events), shared: p.shared === true,
        })),
      )
    },

    // SEOmonitor nu dă pozițiile organice ale concurenților (doar în AI Search): golurile nu se pot calcula încă.
    contentGaps: async () => notConnected('Pozițiile organice ale concurenților nu sunt colectate; golurile de conținut apar după adăugarea lor.'),

    // Indexare (L): starea și numărul de URL-uri vin clasificate de `brand_index_status`.
    async indexStatus(brandId) {
      const { data, error } = await client.rpc('brand_index_status', { p_brand_id: brandId })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; inspected_on?: string | null; summary?: Record<string, unknown>; urls?: Array<Record<string, unknown>>; priority_urls?: Array<Record<string, unknown>> } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected('Search Console nu este conectat pentru acest brand.')
      const s = d.summary
      if (!s || !Array.isArray(d.urls) || !Array.isArray(d.priority_urls)) return failed(CONTRACT)
      const count = (k: string) => num(s[k])
      const summary = { total: count('total'), indexed: count('indexed'), not_indexed: count('not_indexed'), unknown: count('unknown'), canonical_mismatch: count('canonical_mismatch') }
      if (Object.values(summary).some((v) => v === null)) return failed(CONTRACT)
      const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
      try {
        const out: IndexStatus = {
          inspected_on: str(d.inspected_on),
          summary: summary as IndexStatus['summary'],
          urls: d.urls.map((u): IndexedUrl => {
            if (typeof u.url !== 'string' || typeof u.inspected_on !== 'string' || !(INDEX_STATES as readonly string[]).includes(String(u.state))) throw new Error(CONTRACT)
            return {
              url: u.url, priority: u.priority === true, state: u.state as IndexState,
              verdict: str(u.verdict), coverage_state: str(u.coverage_state), indexing_state: str(u.indexing_state), robots_txt_state: str(u.robots_txt_state),
              page_fetch_state: str(u.page_fetch_state), crawled_as: str(u.crawled_as), last_crawl_time: str(u.last_crawl_time),
              google_canonical: str(u.google_canonical), user_canonical: str(u.user_canonical),
              canonical_matches: typeof u.canonical_matches === 'boolean' ? u.canonical_matches : null, inspected_on: u.inspected_on,
            }
          }),
          priority_urls: d.priority_urls.map((p) => {
            if (typeof p.id !== 'string' || typeof p.url !== 'string') throw new Error(CONTRACT)
            return { id: p.id, url: p.url, inspected: p.inspected === true }
          }),
        }
        return ready(out)
      } catch {
        return failed(CONTRACT)
      }
    },

    async addIndexUrl(brand, url) {
      const { data: auth } = await client.auth.getSession()
      const me = auth.session?.user.id
      if (!me) return failed('Sesiunea a expirat. Autentifică-te din nou.')
      const { error } = await client.from('index_urls').insert({ tenant_id: brand.tenant_id, brand_id: brand.id, url: url.trim(), created_by: me })
      return error ? failed(indexWriteError(error, 'URL-ul nu a putut fi adăugat. Reîncearcă.')) : ready(null)
    },

    async removeIndexUrl(id) {
      const { error } = await client.from('index_urls').delete().eq('id', id)
      return error ? failed(indexWriteError(error, 'URL-ul nu a putut fi șters. Reîncearcă.')) : ready(null)
    },
  }
}
