// Constantele colectorului Google Ads Transparency (deciziile Y). Contract: docs/contracts/ads-transparency.md.
//
// Ruta: setul public BigQuery `bigquery-public-data.google_ads_transparency_center` (Google nu publică un API REST pentru
// Ads Transparency Center; setul acoperă reclamele din Spațiul Economic European și Turcia). Interogarea e plătită de proiectul
// Google Cloud al service account-ului clientului (același JSON ca la GA4 și Search Console); primul 1 TB pe lună e gratuit.
// Schema oficială nu e publicată în afara consolei: colectorul o citește din INFORMATION_SCHEMA la fiecare rulare și construiește
// interogarea doar din câmpurile care există (`creativesSql`). Confirmate public: advertiser_id, creative_id.

export const BQ_DATASET = 'bigquery-public-data.google_ads_transparency_center'
export const BQ_TABLE = `${BQ_DATASET}.creative_stats`
/** Seturile publice BigQuery stau în multi-regiunea US; jobul trebuie să ruleze acolo. */
export const BQ_LOCATION = 'US'
export const BQ_BASE_URL = 'https://bigquery.googleapis.com/bigquery/v2'
/** Scope-ul BigQuery; drepturile reale le dau rolurile IAM ale service account-ului (BigQuery Job User în proiectul lui). */
export const BQ_SCOPE = 'https://www.googleapis.com/auth/bigquery'

/** Conexiunea cu service account-ul, la nivel de client (aceeași ca la Google). */
export const CREDENTIAL_PROVIDER = 'google_service_account'
/** Sursa din sync_runs (un rând pe brand) și din competitor_trackers / competitor_ads. */
export const SOURCE = 'ads_transparency'
export const TRACKER_SOURCE = 'google_ads_transparency'
export const ADS_SOURCE = 'google_ads_transparency'
export const SCHEMA_VERSION = 'bq-creative_stats-schema-citita-2026-11'
/** Plafonul pentru interogarea schemei (metadate; BigQuery facturează minimum 10 MB). */
export const SCHEMA_MAX_BYTES = 1e9

/** Regiunea colectată: doar afișările din România (spec cap. 08: valorile pe toată UE nu sunt reach România). */
export const REGION = 'RO'

/** Plafonul de bytes facturați pe interogare (implicit 100 GB); BigQuery oprește jobul înainte de a factura peste. */
export const DEFAULT_MAX_GB = 100
export const MAX_GB_ENV = 'ADS_TRANSPARENCY_MAX_GB'
/** Proiectul care plătește interogarea, dacă nu e cel din service account. */
export const BILLING_PROJECT_ENV = 'ADS_TRANSPARENCY_BILLING_PROJECT'

/** Siguranță: rânduri citite pe interogare și pagini de rezultate. Peste ele, rularea e parțială. */
export const MAX_ROWS = 50_000
export const PAGE_ROWS = 10_000
export const MAX_PAGES = 20
/** Așteptarea unui job neterminat: timeout pe cerere și numărul de reîncercări ale getQueryResults. */
export const QUERY_TIMEOUT_MS = 60_000
export const MAX_POLLS = 20
