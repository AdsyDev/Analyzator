import type { IsoDate, IsoDateTime } from './common'
import type { MetricStatus } from './metric'

/**
 * Trafic și conversii: seturile de date ale ecranului în afara metricilor din registru (spec cap. 16).
 * Nu există încă un contract de server; tipurile sunt cerințele UI-ului (`docs/design/ui-data-needs.md`).
 * Cotele, ratele și variațiile vin calculate de server.
 */
export const DEVICES = ['desktop', 'mobile', 'tablet'] as const
export type Device = (typeof DEVICES)[number]

export interface TrafficChannel {
  /** Grupul de canale GA4 (Organic Search, Direct, Paid Search, Referral, Organic Social, Email, AI referrals). */
  channel: string
  sessions: number | null
  /** Cota în totalul filtrat, în procente. */
  share_pct: number | null
  /** Variația relativă a sesiunilor față de comparație, în procente; `null` fără comparație. */
  change_pct: number | null
  /** Procent; `null` când GA4 nu îl raportează. */
  engagement_rate: number | null
  key_events: number | null
}

export interface TrafficChannels {
  channels: TrafficChannel[]
  /** `null` = toate device-urile. */
  device: Device | null
  data_as_of: IsoDate | null
}

export interface AiReferralSource {
  domain: string
  sessions: number | null
  key_events: number | null
  /** Procent calculat de server: key events / sessions pentru aceeași sursă. */
  conversion_rate: number | null
}

export interface AiReferrals {
  sources: AiReferralSource[]
  /** Lista de domenii și regulile UTM sunt versionate (spec cap. 16). */
  rules_version: string
  rules_effective_from: IsoDate
  data_as_of: IsoDate | null
}

/** Valorile Clarity pe device pentru o metrică din registru. `value: null` = lipsă, nu zero. */
export interface DeviceCell {
  value: number | null
  status: MetricStatus
}

export interface ClarityDeviceRow {
  metric_key: string
  cells: Record<Device, DeviceCell>
}

export interface ClarityDevices {
  rows: ClarityDeviceRow[]
  data_as_of: IsoDate | null
}

export type TrackingStatus = 'ok' | 'warning' | 'problem' | 'unknown'

export interface TrackingCheck {
  id: string
  title: string
  note: string
  status: TrackingStatus
}

export interface TrackingQuality {
  checks: TrackingCheck[]
  checked_at: IsoDateTime
}
