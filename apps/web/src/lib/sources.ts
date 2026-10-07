import type { SourceProviderId } from '../contracts'

/** Numele și monograma surselor. Cheile sunt `provider` din conexiuni și `primary_source` din registru. */
export const PROVIDER_LABELS: Record<SourceProviderId, { name: string; mono: string }> = {
  seomonitor: { name: 'SEOmonitor', mono: 'SM' },
  ga4: { name: 'Google Analytics 4', mono: 'GA' },
  gsc: { name: 'Search Console', mono: 'SC' },
  clarity: { name: 'Microsoft Clarity', mono: 'CL' },
  planable: { name: 'Planable', mono: 'PL' },
  google_ads: { name: 'Google Ads', mono: 'GAd' },
  meta_ads: { name: 'Meta Ads', mono: 'MA' },
  csv_import: { name: 'Import CSV', mono: 'CSV' },
}

/** Numele afișat pentru o cheie de sursă; o cheie necunoscută se afișează ca atare, nu se ghicește. */
export function sourceName(key: string): string {
  return (PROVIDER_LABELS as Record<string, { name: string } | undefined>)[key]?.name ?? key
}
