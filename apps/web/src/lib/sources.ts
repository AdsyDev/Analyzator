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

/** Ce aduce fiecare sursă, în română; folosit în pagina de status și în Administrare → Surse. */
export const PROVIDER_DESCRIPTIONS: Record<SourceProviderId, string> = {
  seomonitor: 'Vizibilitate SEO, poziții în Google și prezența în răspunsurile AI.',
  ga4: 'Sesiuni, utilizatori și evenimente cheie din site.',
  gsc: 'Clickuri, afișări, CTR și poziție medie din Google Search.',
  clarity: 'Comportament pe site: rage clicks, dead clicks, quick backs, scroll depth.',
  planable: 'Postările sociale ale brandului și performanța lor.',
  google_ads: 'Cheltuieli și performanță din Google Ads.',
  meta_ads: 'Cheltuieli și performanță din Meta Ads.',
  csv_import: 'Date importate din fișiere CSV (Paid Media și Social).',
}

/** Sursele din grila Administrare → Surse, în ordinea din spec. */
export const ADMIN_SOURCE_GRID = ['seomonitor', 'ga4', 'gsc', 'clarity', 'planable', 'csv_import'] as const satisfies readonly SourceProviderId[]
