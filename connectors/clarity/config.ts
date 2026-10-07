// Constantele conectorului Clarity. Configurarea per brand vine din source_connections (provider = 'clarity');
// tokenul e în Supabase Vault și se citește prin get_source_token (service role).

export const CLARITY_ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'
export const CLARITY_DAILY_BUDGET = 10
/** Patru apeluri pe zi (totaluri, Device, Source, URL): sub atât buget rămas, rularea nu pornește. */
export const CLARITY_MIN_BUDGET_TO_START = 4
