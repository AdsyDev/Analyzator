import type { KpiSlot } from '../shared/slots'

/** KPI-urile din spec cap. 14. Toate cheile sunt în registru. Visibility folosește „ultima observație", ca pe cardul KPI din registru. */
export const SEO_KPI_SLOTS: readonly KpiSlot[] = [
  { key: 'gsc_clicks', label: 'Clicks (Search Console)' },
  { key: 'gsc_impressions', label: 'Impressions (Search Console)' },
  { key: 'gsc_ctr', label: 'CTR (Search Console)' },
  { key: 'seomonitor_visibility_latest', label: 'Visibility SEOmonitor' },
  { key: 'seomonitor_keywords_top3', label: 'Keywords în Top 3' },
  { key: 'seomonitor_keywords_top10', label: 'Keywords în Top 10' },
]

export const SEO_KPI_KEYS: readonly string[] = SEO_KPI_SLOTS.map((s) => s.key)
