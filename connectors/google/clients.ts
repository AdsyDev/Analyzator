// Clienți pentru GA4 Data API și Search Console API, prin bibliotecile oficiale Google pentru Node.
// Restul codului vede doar interfețele, ca testele să ruleze cu clienți simulați și fără acces real.

import { BetaAnalyticsDataClient } from '@google-analytics/data'
import { searchconsole } from '@googleapis/searchconsole'
import { GoogleAuth } from 'google-auth-library'
import { GA4_SCOPE, GSC_SCOPE } from './config.ts'
import type { ServiceAccount } from './schemas.ts'

export type Ga4ReportRequest = {
  property: string // properties/NNN
  dimensions: string[]
  metrics: string[]
  startDate: string
  endDate: string
  limit: number
  offset: number
}

export type Ga4Compatibility = { incompatibleDimensions: string[]; incompatibleMetrics: string[] }

export interface Ga4Client {
  /** Cheamă properties.checkCompatibility; întoarce doar ce nu se poate combina. */
  checkCompatibility(req: { property: string; dimensions: string[]; metrics: string[] }): Promise<Ga4Compatibility>
  /** Răspunsul brut runReport (validat de apelant cu Ga4ReportSchema). */
  runReport(req: Ga4ReportRequest): Promise<unknown>
}

export type GscQueryRequest = {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions: string[]
  rowLimit: number
  startRow: number
  dataState: 'final' | 'all'
}

export interface GscClient {
  /** Răspunsul brut Search Analytics (validat de apelant cu GscResponseSchema). */
  query(req: GscQueryRequest): Promise<unknown>
}

export type GoogleClients = { ga4: Ga4Client; gsc: GscClient }
export type ClientFactory = (credentials: ServiceAccount) => GoogleClients

const COMPATIBILITY_INCOMPATIBLE = 2 // enum numeric: UNSPECIFIED 0, COMPATIBLE 1, INCOMPATIBLE 2

function isIncompatible(value: unknown): boolean {
  return value === 'INCOMPATIBLE' || value === COMPATIBILITY_INCOMPATIBLE
}

export const createGoogleClients: ClientFactory = (credentials) => {
  const creds = { client_email: credentials.client_email, private_key: credentials.private_key }

  const ga4Api = new BetaAnalyticsDataClient({ credentials: creds, projectId: credentials.project_id ?? undefined })
  const ga4: Ga4Client = {
    async checkCompatibility(req) {
      const [res] = await ga4Api.checkCompatibility({
        property: req.property,
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
      })
      return {
        incompatibleDimensions: (res.dimensionCompatibilities ?? [])
          .filter((c) => isIncompatible(c.compatibility))
          .map((c) => c.dimensionMetadata?.apiName ?? '(necunoscută)'),
        incompatibleMetrics: (res.metricCompatibilities ?? [])
          .filter((c) => isIncompatible(c.compatibility))
          .map((c) => c.metricMetadata?.apiName ?? '(necunoscută)'),
      }
    },
    async runReport(req) {
      const [res] = await ga4Api.runReport({
        property: req.property,
        dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
        limit: req.limit,
        offset: req.offset,
        keepEmptyRows: false,
      })
      return res
    },
  }

  const auth = new GoogleAuth({ credentials: creds, scopes: [GA4_SCOPE, GSC_SCOPE] })
  const sc = searchconsole({ version: 'v1', auth })
  const gsc: GscClient = {
    async query(req) {
      const res = await sc.searchanalytics.query({
        siteUrl: req.siteUrl,
        requestBody: {
          startDate: req.startDate,
          endDate: req.endDate,
          dimensions: req.dimensions,
          rowLimit: req.rowLimit,
          startRow: req.startRow,
          dataState: req.dataState,
          type: 'web',
        },
      })
      return res.data
    },
  }

  return { ga4, gsc }
}
