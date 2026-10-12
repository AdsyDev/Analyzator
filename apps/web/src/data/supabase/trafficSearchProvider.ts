import { DEVICES, failed, METRIC_STATUSES, notConnected, ready, type ClarityDevices, type Device, type LandingPage, type SearchKeyword, type SearchProvider, type TrafficChannels, type TrafficProvider } from '../../contracts'
import { serverPeriodKind } from '../../lib/period'
import type { DataClient } from './dataClient'
import { QUERY_FAILED } from './dataClient'

const CONTRACT = 'Răspunsul serverului nu respectă contractul așteptat. Reîncearcă sau anunță echipa tehnică.'
const rpcError = (e: { code?: string } | null) => (e?.code === '42501' ? 'Nu ai acces la acest spațiu de brand.' : QUERY_FAILED)
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Trafic din SQL (D-14): canale GA4 și Clarity pe device; RPC INVOKER, formule în `metrics`. */
export function createSupabaseTraffic(client: DataClient): TrafficProvider {
  return {
    async channels(ctx, device) {
      // GA4 nu e colectat pe device: nu arătăm canale nefiltrate sub un filtru de device.
      if (device) return notConnected('Defalcarea pe device nu e colectată din GA4; canalele sunt disponibile doar pentru toate device-urile.')
      const { data, error } = await client.rpc('brand_traffic_channels', { p_brand_id: ctx.brandId, p_start: ctx.period.from, p_end: ctx.period.to, p_kind: serverPeriodKind(ctx.period.preset) })
      if (error) return failed(rpcError(error))
      const d = data as { connected?: boolean; channels?: Array<Record<string, unknown>>; data_as_of?: string | null } | null
      if (!d || typeof d.connected !== 'boolean') return failed(CONTRACT)
      if (!d.connected) return notConnected('Google Analytics 4 nu este conectat pentru acest brand.')
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

    // Regulile de clasificare a referral-urilor AI trebuie versionate (spec cap. 16); nu există încă.
    aiReferrals: async () => notConnected('Regulile de clasificare a referral-urilor AI nu sunt încă definite; secțiunea apare după publicarea primei versiuni.'),

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

    // Verificările de calitate a tracking-ului nu au încă definiții (ce e „ok” / „problemă”); nu le inventăm.
    trackingQuality: async () => notConnected('Verificările de calitate a tracking-ului nu sunt încă definite pentru acest brand.'),
  }
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
  }
}
