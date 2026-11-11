/**
 * Indicatorii din raportul de perioadă, pe grupuri. Doar chei din registru: numele vin din definiții, valorile și
 * variațiile din `brand_metrics`. O cheie fără definiție sau fără sursă apare cu starea ei, nu dispare din raport.
 */
export interface ReportGroup {
  id: string
  title: string
  keys: readonly string[]
}

export const REPORT_GROUPS: readonly ReportGroup[] = [
  { id: 'ai', title: 'Vizibilitate AI', keys: ['ai_mention_rate', 'ai_owned_citation_rate', 'ai_sov', 'ai_overviews_mention_rate'] },
  { id: 'seo', title: 'SEO și Search', keys: ['seomonitor_visibility_latest', 'seomonitor_keywords_top3', 'seomonitor_keywords_top10', 'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position'] },
  { id: 'traffic', title: 'Trafic și conversii', keys: ['ga4_sessions', 'ga4_engaged_sessions', 'ga4_key_events'] },
  { id: 'listening', title: 'Listening', keys: ['mentions_count'] },
  { id: 'paid', title: 'Paid Media', keys: ['google_ads_spend', 'meta_ads_spend', 'tiktok_ads_spend'] },
]

export const REPORT_KEYS: readonly string[] = REPORT_GROUPS.flatMap((g) => g.keys)
