// Scheme Zod pentru răspunsurile GA4 runReport și Search Analytics. Tolerante la câmpuri necunoscute.
import { z } from 'zod'

const DimensionValue = z.object({ value: z.string().nullish() }).loose()
const MetricValue = z.object({ value: z.string().nullish() }).loose()
const Row = z
  .object({
    dimensionValues: z.array(DimensionValue).nullish(),
    metricValues: z.array(MetricValue).nullish(),
  })
  .loose()

export const Ga4ReportSchema = z
  .object({
    dimensionHeaders: z.array(z.object({ name: z.string() }).loose()).nullish(),
    metricHeaders: z.array(z.object({ name: z.string() }).loose()).nullish(),
    rows: z.array(Row).nullish(),
    rowCount: z.number().nullish(),
    metadata: z
      .object({
        dataLossFromOtherRow: z.boolean().nullish(),
        currencyCode: z.string().nullish(),
        timeZone: z.string().nullish(),
        emptyReason: z.string().nullish(),
        subjectToThresholding: z.boolean().nullish(),
        samplingMetadatas: z.array(z.unknown()).nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose()
export type Ga4Report = z.infer<typeof Ga4ReportSchema>

const GscRow = z
  .object({
    keys: z.array(z.string()).nullish(),
    clicks: z.number().nullish(),
    impressions: z.number().nullish(),
    ctr: z.number().nullish(),
    position: z.number().nullish(),
  })
  .loose()

export const GscResponseSchema = z
  .object({
    rows: z.array(GscRow).nullish(),
    responseAggregationType: z.string().nullish(),
    metadata: z.object({ first_incomplete_date: z.string().nullish() }).loose().nullish(),
  })
  .loose()
export type GscResponse = z.infer<typeof GscResponseSchema>

/** Service account JSON: doar câmpurile folosite; restul se ignoră. Cheia privată nu se loghează. */
export const ServiceAccountSchema = z
  .object({
    type: z.literal('service_account'),
    client_email: z.string().email(),
    private_key: z.string().min(1),
    project_id: z.string().nullish(),
  })
  .loose()
export type ServiceAccount = z.infer<typeof ServiceAccountSchema>
