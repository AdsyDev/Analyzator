import trafficFile from '../../../../../tests/fixtures/ui/traffic.json'
import { DEVICES, failed, notConnected, ready, type ClarityDeviceRow, type Device, type QueryContext, type TrafficProvider, type TrafficChannel } from '../../contracts'
import { fixtureMetrics } from './metrics'

interface Check {
  id: string
  title: string
  note: string
  status: 'ok' | 'warning' | 'problem' | 'unknown'
}
const checks = trafficFile.checks as unknown as Record<string, Check[]>
const factors = trafficFile.clarity_device_factors as Record<string, Record<Device, number>>
const deviceShare = trafficFile.device_share as Record<Device, number>

const NO_SESSIONS = 'Sursa Google Analytics 4 nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.'

export function createTrafficFixtures({ allowed, now }: { allowed: Set<string>; now: () => Date }): TrafficProvider {
  const denied = failed<never>('Acces refuzat la acest spațiu de brand.')
  const sessions = (ctx: QueryContext) => fixtureMetrics(ctx, ['ga4_sessions'], now()).items[0]

  return {
    channels: async (ctx, device) => {
      if (!allowed.has(ctx.brandId)) return denied
      const s = sessions(ctx)
      if (!s || s.value === null) return notConnected(NO_SESSIONS)
      const total = s.value
      const factor = device ? deviceShare[device] : 1
      const channels = trafficFile.channels.map<TrafficChannel>((c) => {
        const n = Math.round(total * c.share * factor)
        return {
          channel: c.channel,
          sessions: n,
          // Cota și variația sunt stand-in pentru calculul serverului (doar fixtures).
          share_pct: Math.round(c.share * 1000) / 10,
          change_pct: c.change_pct,
          engagement_rate: c.engagement,
          key_events: Math.round(n * c.ke_rate),
        }
      })
      return ready({ channels, device, data_as_of: s.data_as_of })
    },

    aiReferrals: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const s = sessions(ctx)
      if (!s || s.value === null) return notConnected(NO_SESSIONS)
      const ai = trafficFile.channels.find((c) => c.channel === 'AI referrals')?.share ?? 0
      return ready({
        sources: trafficFile.ai_referrals.domains.map((d) => {
          const n = Math.round((s.value ?? 0) * ai * d.share)
          const ke = Math.round(n * d.ke_rate)
          return { domain: d.domain, sessions: n, key_events: ke, conversion_rate: n > 0 ? Math.round((1000 * ke) / n) / 10 : null }
        }),
        rules_version: trafficFile.ai_referrals.rules_version,
        rules_effective_from: trafficFile.ai_referrals.rules_effective_from,
        data_as_of: s.data_as_of,
      })
    },

    clarityDevices: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const keys = Object.keys(factors)
      const { items } = fixtureMetrics(ctx, keys, now())
      if (items.every((i) => i.status === 'not_connected')) return notConnected('Sursa Microsoft Clarity nu este conectată pentru acest brand. Nu afișăm valori estimate până la conectare.')
      const rows = items.map<ClarityDeviceRow>((i) => ({
        metric_key: i.metric_key,
        cells: Object.fromEntries(
          DEVICES.map((d) => {
            const f = factors[i.metric_key]?.[d] ?? 0
            // Defalcarea pe device: stand-in determinist (doar fixtures). Fără valoare în registru, fără valoare pe device.
            const value = i.value === null ? null : i.unit === 'count' ? Math.round(i.value * f) : Math.round(i.value * f * 10) / 10
            return [d, { value, status: i.status }]
          }),
        ) as ClarityDeviceRow['cells'],
      }))
      const dates = items.map((i) => i.data_as_of).filter((d): d is string => !!d).sort()
      return ready({ rows, data_as_of: dates[0] ?? null })
    },

    trackingQuality: async (ctx) => {
      if (!allowed.has(ctx.brandId)) return denied
      const list = checks[ctx.brandId]
      return list ? ready({ checks: list, checked_at: now().toISOString() }) : notConnected('Verificările de tracking nu sunt configurate pentru acest brand.')
    },
  }
}
