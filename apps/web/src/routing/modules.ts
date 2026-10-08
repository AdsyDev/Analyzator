import type { DataProviders, SourceProviderId } from '../contracts'
import { AI_ENGINES } from '../contracts'
import { AI_ENGINE_LABELS } from '../lib/ai'
import type { FilterDef } from '../lib/period'

/** Filtru ale cărui opțiuni depind de brand (de ex. grupurile de întrebări AI). Opțiunile se încarcă prin provider. */
export interface DynamicFilter {
  key: string
  label: string
  allLabel: string
  /** `null` când opțiunile nu sunt disponibile (sursă neconectată sau eroare): filtrul nu apare. */
  load: (providers: DataProviders, brandId: string) => Promise<string[] | null>
}

export interface BrandModule {
  segment: string
  title: string
  subtitle: (brandName: string) => string
  /** Sursele de care depinde modulul; când toate lipsesc, modulul afișează „Sursă neconectată". */
  sources: readonly SourceProviderId[]
  filters: readonly FilterDef[]
  dynamicFilter?: DynamicFilter
  /** Textul pentru modulul fără sursă conectată, din design. */
  disconnected?: (brandName: string) => string
  /** Sursa pe care o conectează acțiunea „Conectează …" (doar agency_admin). */
  connectLabel?: string
}

export const DEVICE_FILTER: FilterDef = {
  key: 'device',
  label: 'Device',
  defaultValue: 'all',
  options: [
    { value: 'all', label: 'Toate' },
    { value: 'desktop', label: 'Desktop' },
    { value: 'mobile', label: 'Mobil' },
    { value: 'tablet', label: 'Tabletă' },
  ],
}

export const ENGINE_FILTER: FilterDef = {
  key: 'engine',
  label: 'Engine',
  defaultValue: 'all',
  options: [{ value: 'all', label: 'Toate engine-urile' }, ...AI_ENGINES.map((e) => ({ value: e, label: AI_ENGINE_LABELS[e] }))],
}

export const KEYWORD_TYPE_FILTER: FilterDef = {
  key: 'kw',
  label: 'Keywords',
  defaultValue: 'all',
  options: [
    { value: 'all', label: 'Toate' },
    { value: 'brand', label: 'Brand' },
    { value: 'nonbrand', label: 'Nonbrand' },
  ],
}

const AI_GROUPS: DynamicFilter = {
  key: 'group',
  label: 'Grup',
  allLabel: 'Toate grupurile',
  load: async (providers, brandId) => {
    const r = await providers.ai.groups(brandId)
    return r.kind === 'ready' ? r.data : null
  },
}

/** Titlurile și subtitlurile din design (`PAGES`). Filtrele sunt allowlist-ul cheilor din URL pentru fiecare modul. */
export const BRAND_MODULES: Record<string, BrandModule> = {
  overview: { segment: 'overview', title: 'Overview', subtitle: () => 'Starea brandului pe toate sursele. Apasă pe orice indicator ca să vezi înregistrările din spatele lui.', sources: ['ga4', 'gsc', 'seomonitor'], filters: [] },
  ai: { segment: 'ai', title: 'AI Visibility', subtitle: () => 'Cum apare brandul în răspunsurile asistenților AI, pe aceleași întrebări rulate zilnic.', sources: ['seomonitor'], filters: [ENGINE_FILTER], dynamicFilter: AI_GROUPS },
  seo: { segment: 'seo', title: 'SEO și Search', subtitle: () => 'Prezența în Google: clicks, poziții și subiectele pe care competitorii le acoperă înaintea ta.', sources: ['seomonitor', 'gsc'], filters: [KEYWORD_TYPE_FILTER] },
  traffic: { segment: 'traffic', title: 'Trafic și conversii', subtitle: () => 'Ce se întâmplă după click: vizite, acțiuni importante și calitatea măsurării.', sources: ['ga4', 'clarity'], filters: [DEVICE_FILTER] },
  paid: {
    segment: 'paid',
    title: 'Paid Media',
    subtitle: () => '',
    sources: ['google_ads', 'meta_ads'],
    filters: [],
    connectLabel: 'Conectează Google Ads',
    disconnected: (b) => `Google Ads și Meta Ads nu sunt conectate pentru ${b}. Până la conectare nu afișăm cifre, nici estimate.`,
  },
  social: {
    segment: 'social',
    title: 'Social',
    subtitle: () => '',
    sources: ['planable'],
    filters: [],
    connectLabel: 'Conectează Planable',
    disconnected: (b) => `Datele despre postările ${b} vin din Planable, care nu e încă conectat. Pentru comparația publică cu competitorii, vezi Concurență.`,
  },
  listening: { segment: 'listening', title: 'Listening', subtitle: () => 'Mențiunile publice despre brand, cu sentiment revizuit de echipa AdSymphony.', sources: [], filters: [] },
  competition: { segment: 'competition', title: 'Concurență', subtitle: () => 'Brandul față de setul de competitori, pe aceleași surse și aceeași perioadă.', sources: [], filters: [] },
  insights: { segment: 'insights', title: 'Analize și acțiuni', subtitle: () => 'Interpretările echipei AdSymphony și acțiunile care decurg din ele.', sources: [], filters: [] },
}

export interface AdminModule {
  segment: string
  title: string
  subtitle: (brandName: string | null) => string
}

export const ADMIN_MODULES: Record<string, AdminModule> = {
  clients: { segment: 'clients', title: 'Clienți și site-uri', subtitle: () => 'Fiecare client are unul sau mai multe spații de brand. Un spațiu înseamnă un site, setul lui de competitori și sursele de date.' },
  sources: { segment: 'sources', title: 'Surse', subtitle: (b) => (b ? `Conexiunile de date ale spațiului ${b} și istoricul sincronizărilor.` : 'Conexiunile de date și istoricul sincronizărilor.') },
  users: { segment: 'users', title: 'Utilizatori', subtitle: () => 'Persoanele cu acces la spațiile de brand.' },
  config: { segment: 'config', title: 'Configurare', subtitle: () => '' },
}
