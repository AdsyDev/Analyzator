// Contractele de import CSV: sursa unică pentru validare, șabloane și documentele docs/contracts/csv-*.md.
// Câmpurile sunt cele pe care le vor folosi și conectorii direcți. Nicio denumire de coloană a platformelor nu
// e documentată oficial: alias-urile de mai jos vin din ghiduri terțe și sunt marcate „neconfirmate".

export const SOURCES = ['google_ads', 'meta_ads', 'tiktok_ads', 'planable_analytics', 'planable_listening'] as const
export type SourceId = (typeof SOURCES)[number]
export type Family = 'paid' | 'social' | 'mentions'
export type ColType = 'date' | 'datetime' | 'text' | 'integer' | 'decimal' | 'enum' | 'url'

export type Column = {
  key: string
  type: ColType
  /** true = obligatorie; 'conditional' = depinde de alt câmp (vezi description). */
  required: boolean | 'conditional'
  description: string
  example: string
  /** Denumiri de coloană din exporturile platformei (comparație fără majuscule, spații normalizate). Neconfirmate. */
  aliases?: string[]
  values?: readonly string[]
}

export type SourceContract = {
  source: SourceId
  family: Family
  title: string
  /** Starea formatului nativ al platformei. */
  platform_format: string
  /** Declarații pe lot, cerute la încărcare. */
  declares: Array<'currency' | 'timezone' | 'attribution_config' | 'click_type'>
  columns: Column[]
  /** Anteturi cu parametru (de ex. „Amount spent (RON)”): cheia canonică și grupul de monedă. */
  headerPatterns?: Array<{ pattern: RegExp; key: string; currencyGroup?: number }>
  /** Rânduri ignorate (nu respinse): de ex. rândul „Total” din exporturile Google Ads. */
  skipRowPrefixes?: string[]
  /** Cheia naturală (upsert): reimportul aceleiași chei înlocuiește rândul. */
  natural_key: string[]
  notes: string[]
}

const PAID_COLUMNS = (alias: {
  date?: string[]; account_id?: string[]; account_name?: string[]; campaign_id?: string[]; campaign_name?: string[]
  ad_group_id?: string[]; ad_group_name?: string[]; ad_id?: string[]; ad_name?: string[]
  spend?: string[]; impressions?: string[]; clicks?: string[]; conversions?: string[]; currency?: string[]
}): Column[] => [
  { key: 'date', type: 'date', required: true, description: 'Ziua (YYYY-MM-DD), în fusul declarat pe lot.', example: '2026-10-05', aliases: alias.date },
  { key: 'account_id', type: 'text', required: false, description: 'ID-ul contului de ads. Recomandat: face parte din cheia naturală.', example: '123-456-7890', aliases: alias.account_id },
  { key: 'account_name', type: 'text', required: false, description: 'Numele contului.', example: 'Cont Brand A', aliases: alias.account_name },
  { key: 'campaign_id', type: 'text', required: 'conditional', description: 'ID-ul campaniei. Obligatoriu dacă lipsește campaign_name; dacă lipsește, ID-ul devine `name:<campaign_name>`.', example: '98765', aliases: alias.campaign_id },
  { key: 'campaign_name', type: 'text', required: 'conditional', description: 'Numele campaniei. Obligatoriu dacă lipsește campaign_id.', example: 'Toamna 2026', aliases: alias.campaign_name },
  { key: 'ad_group_id', type: 'text', required: false, description: 'ID-ul grupului de reclame / ad set. Gol = export la nivel de campanie.', example: '55501', aliases: alias.ad_group_id },
  { key: 'ad_group_name', type: 'text', required: false, description: 'Numele grupului de reclame / ad set.', example: 'Audiență 25-44', aliases: alias.ad_group_name },
  { key: 'ad_id', type: 'text', required: false, description: 'ID-ul reclamei. Gol = export la nivel de grup.', example: '777001', aliases: alias.ad_id },
  { key: 'ad_name', type: 'text', required: false, description: 'Numele reclamei.', example: 'Banner 1', aliases: alias.ad_name },
  { key: 'spend', type: 'decimal', required: true, description: 'Costul zilei, în moneda declarată pe lot. Punct zecimal, fără separator de mii.', example: '152.40', aliases: alias.spend },
  { key: 'impressions', type: 'integer', required: false, description: 'Afișări. Gol = necunoscut (NULL), nu 0.', example: '10450', aliases: alias.impressions },
  { key: 'clicks', type: 'integer', required: false, description: 'Clicks; tipul de click se declară pe lot (click_type) și trebuie să fie același între perioade comparate.', example: '312', aliases: alias.clicks },
  { key: 'conversions', type: 'decimal', required: false, description: 'Conversii pentru acțiunea și fereastra de atribuire declarate pe lot. Gol = necunoscut (NULL), nu 0.', example: '14', aliases: alias.conversions },
  { key: 'currency', type: 'text', required: false, description: 'Codul monedei (ISO 4217) al rândului. Dacă există, trebuie să coincidă cu moneda declarată pe lot.', example: 'RON', aliases: alias.currency },
  { key: 'breakdown', type: 'text', required: false, description: 'Defalcarea rândului (de ex. `device=mobile`). Gol = fără defalcare (`none`). Rândurile cu defalcare nu intră în totaluri.', example: '' },
]

const PAID_NOTES = [
  'Moneda și fusul orar se declară la încărcare (nu se deduc din fișier). Un fișier fără monedă declarată e refuzat.',
  'Numere: punct zecimal, fără separator de mii (`1234.56`). Formele `1.234,56` și `1,234.56` sunt respinse, ca să nu se interpreteze greșit.',
  'Un rând cu aceeași cheie naturală de două ori în fișier: primul se păstrează, următoarele se resping ca duplicate.',
  'Un reimport al aceleiași chei înlocuiește rândul existent (upsert). Un fișier identic (același hash) nu se importă de două ori.',
  'Un rând fără nicio metrică (cost, afișări, clicks, conversii) se respinge.',
  'O dată în viitor (în fusul declarat) se respinge.',
]

export const CONTRACTS: Record<SourceId, SourceContract> = {
  google_ads: {
    source: 'google_ads',
    family: 'paid',
    title: 'Google Ads',
    platform_format:
      'Formatul nativ nu e documentat oficial. Alias-urile (`Day`, `Campaign`, `Ad group`, `Cost`, `Impr.`, `Clicks`, `Conversions`) vin din ghiduri terțe și sunt neconfirmate. Exportul din UI are de obicei rânduri introductive și un rând „Total”; acestea se ignoră. Exporturile pot fi UTF-16 cu TAB (detectat automat).',
    declares: ['currency', 'timezone', 'attribution_config', 'click_type'],
    columns: PAID_COLUMNS({
      date: ['Day'], account_id: ['Customer ID'], account_name: ['Account'], campaign_id: ['Campaign ID'], campaign_name: ['Campaign'],
      ad_group_id: ['Ad group ID'], ad_group_name: ['Ad group'], ad_id: ['Ad ID'], ad_name: ['Ad name'],
      spend: ['Cost'], impressions: ['Impr.'], clicks: ['Clicks'], conversions: ['Conversions'], currency: ['Currency code'],
    }),
    skipRowPrefixes: ['total'],
    natural_key: ['account_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date', 'breakdown', 'attribution_config'],
    notes: [...PAID_NOTES, 'Rândurile al căror prim câmp începe cu „Total” (rândul de total din export) se ignoră, nu se resping.'],
  },
  meta_ads: {
    source: 'meta_ads',
    family: 'paid',
    title: 'Meta Ads',
    platform_format:
      'Formatul nativ nu e documentat oficial. Alias-urile (`Reporting starts`, `Campaign name`, `Ad set name`, `Amount spent (<MONEDĂ>)`, `Impressions`, `Clicks (all)`, `Link clicks`) vin din ghiduri terțe și sunt neconfirmate. Exportul trebuie făcut cu defalcare zilnică. Coloana `Results` NU e mapată: depinde de obiectivul campaniei și amestecă acțiuni diferite; completează `conversions` explicit.',
    declares: ['currency', 'timezone', 'attribution_config', 'click_type'],
    columns: PAID_COLUMNS({
      date: ['Reporting starts'], account_id: ['Account ID'], account_name: ['Account name'], campaign_id: ['Campaign ID'], campaign_name: ['Campaign name'],
      ad_group_id: ['Ad set ID'], ad_group_name: ['Ad set name'], ad_id: ['Ad ID'], ad_name: ['Ad name'],
      impressions: ['Impressions'], clicks: ['Clicks (all)', 'Link clicks'],
    }),
    headerPatterns: [{ pattern: /^amount spent \(([a-z]{3})\)$/i, key: 'spend', currencyGroup: 1 }],
    natural_key: ['account_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date', 'breakdown', 'attribution_config'],
    notes: [
      ...PAID_NOTES,
      'Dacă antetul de cost conține moneda (`Amount spent (RON)`), aceasta trebuie să coincidă cu moneda declarată pe lot.',
      '`Clicks (all)` și `Link clicks` sunt măsuri diferite: dacă fișierul le conține pe amândouă, e respins ca ambiguu. Declară `click_type` pe lot.',
    ],
  },
  tiktok_ads: {
    source: 'tiktok_ads',
    family: 'paid',
    title: 'TikTok Ads',
    platform_format:
      'Nicio documentație publică a denumirilor de coloane din exportul TikTok Ads Manager. Contractul e un **șablon propriu**: redenumește coloanele exportului după șablon înainte de încărcare. Nu există alias-uri.',
    declares: ['currency', 'timezone', 'attribution_config', 'click_type'],
    columns: PAID_COLUMNS({}),
    natural_key: ['account_id', 'campaign_id', 'ad_group_id', 'ad_id', 'date', 'breakdown', 'attribution_config'],
    notes: PAID_NOTES,
  },
  planable_analytics: {
    source: 'planable_analytics',
    family: 'social',
    title: 'Planable Analytics (social propriu)',
    platform_format:
      'Documentația Planable descrie exportul de postări (CSV), nu și coloanele lui, și nu documentează un export de analytics. Contractul e un **șablon propriu**, cu un singur fișier pentru două niveluri (`level` = `daily` sau `post`). Nu există alias-uri.',
    declares: ['timezone'],
    columns: [
      { key: 'level', type: 'enum', required: true, description: '`daily` = cont × zi; `post` = o postare (snapshot de metrici).', example: 'daily', values: ['daily', 'post'] },
      { key: 'platform', type: 'text', required: true, description: 'Platforma (`facebook`, `instagram`, `linkedin`, `tiktok`, `x`, `youtube`…). Litere mici, cifre, underscore.', example: 'instagram' },
      { key: 'account_id', type: 'text', required: true, description: 'ID-ul contului social.', example: '17841400000000000' },
      { key: 'account_name', type: 'text', required: false, description: 'Numele contului.', example: 'Brand A' },
      { key: 'date', type: 'date', required: 'conditional', description: 'Ziua (YYYY-MM-DD). Obligatorie la `level = daily`.', example: '2026-10-05' },
      { key: 'post_id', type: 'text', required: 'conditional', description: 'ID-ul nativ al postării. Obligatoriu la `level = post`.', example: '18000000000000000' },
      { key: 'published_at', type: 'datetime', required: 'conditional', description: 'Momentul publicării (ISO 8601; fără offset = fusul declarat). Obligatoriu la `level = post`.', example: '2026-10-05T09:30:00+03:00' },
      { key: 'snapshot_date', type: 'date', required: 'conditional', description: 'Ziua în care s-au citit metricile postării. Obligatorie la `level = post`.', example: '2026-10-07' },
      { key: 'metrics_scope', type: 'enum', required: 'conditional', description: '`lifetime` (cumulat de la publicare) sau `period` (doar în interval). Obligatoriu la `level = post`; nu se amestecă.', example: 'lifetime', values: ['lifetime', 'period'] },
      { key: 'post_url', type: 'url', required: false, description: 'Linkul postării.', example: 'https://www.instagram.com/p/XXXX/' },
      { key: 'post_text', type: 'text', required: false, description: 'Textul postării.', example: '' },
      { key: 'followers', type: 'integer', required: false, description: 'Urmăritori (snapshot, `level = daily`). Nu se însumează.', example: '5230' },
      { key: 'impressions', type: 'integer', required: false, description: 'Afișări.', example: '8400' },
      { key: 'reach', type: 'integer', required: false, description: 'Reach. Se stochează ca nesumabil (`reach_not_additive`): nu se adună pe zile sau platforme.', example: '6100' },
      { key: 'engagements', type: 'integer', required: false, description: 'Interacțiuni totale, dacă sursa le dă ca total.', example: '410' },
      { key: 'likes', type: 'integer', required: false, description: 'Aprecieri / reacții.', example: '300' },
      { key: 'comments', type: 'integer', required: false, description: 'Comentarii.', example: '40' },
      { key: 'shares', type: 'integer', required: false, description: 'Distribuiri.', example: '30' },
      { key: 'saves', type: 'integer', required: false, description: 'Salvări.', example: '40' },
      { key: 'link_clicks', type: 'integer', required: false, description: 'Clicks pe link.', example: '25' },
      { key: 'video_views', type: 'integer', required: false, description: 'Vizualizări video (definiția diferă între platforme; nu se compară ca aceeași măsură).', example: '' },
    ],
    natural_key: ['level', 'platform', 'account_id', 'date | post_id + snapshot_date + metrics_scope'],
    notes: [
      'Fusul orar se declară la încărcare. Moneda nu se aplică.',
      'O metrică lipsă e NULL, nu 0 (spec 2.7).',
      'Performanța obținută în interval și cea cumulată a postărilor publicate în interval sunt rapoarte diferite; `metrics_scope` le separă în cheie.',
      'Un rând duplicat în fișier (aceeași cheie): primul se păstrează, restul se resping.',
    ],
  },
  planable_listening: {
    source: 'planable_listening',
    family: 'mentions',
    title: 'Planable Listening (mențiuni)',
    platform_format:
      'Niciun format de export Listening nu e documentat public. Contractul e un **șablon propriu**. Fără câmp de autor (date personale minime). Nu există alias-uri.',
    declares: ['timezone'],
    columns: [
      { key: 'native_id', type: 'text', required: false, description: 'ID-ul mențiunii la sursă. Dacă lipsește, se folosește un hash al URL-ului.', example: 'm-100234' },
      { key: 'url', type: 'url', required: true, description: 'Linkul mențiunii (http/https).', example: 'https://exemplu.ro/articol' },
      { key: 'source_name', type: 'text', required: false, description: 'Site-ul sau platforma sursă.', example: 'exemplu.ro' },
      { key: 'published_at', type: 'datetime', required: true, description: 'Momentul publicării (ISO 8601; fără offset = fusul declarat).', example: '2026-10-05T12:00:00+03:00' },
      { key: 'text', type: 'text', required: false, description: 'Textul mențiunii (extras).', example: '' },
      { key: 'sentiment', type: 'enum', required: false, description: 'Sentimentul furnizorului față de **brand**. Gol = `unknown`. Se suprascrie la reimport doar dacă nu a fost revizuit de un om.', example: 'neutral', values: ['positive', 'neutral', 'negative', 'unknown'] },
      { key: 'language', type: 'text', required: false, description: 'Limba (ISO 639, litere mici).', example: 'ro' },
      { key: 'country', type: 'text', required: false, description: 'Țara (ISO 3166-1 alpha-2, majuscule). Limba română nu dovedește localizarea în România.', example: 'RO' },
    ],
    natural_key: ['native_id (sau hash-ul URL-ului)'],
    notes: [
      'Fusul orar se declară la încărcare. Moneda nu se aplică.',
      'Sentimentul din fișier este al furnizorului. Corecțiile umane (`sentiment_reviewed_by`, `sentiment_reviewed_at`) au prioritate și nu se suprascriu la reimport.',
      'Aceeași mențiune (același `native_id`) de două ori în fișier: prima se păstrează, restul se resping.',
    ],
  },
}

export function isSource(value: unknown): value is SourceId {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
}

export const normalizeHeader = (h: string): string => h.replace(/^﻿/, '').trim().replace(/\s+/g, ' ').toLowerCase()

/** Antetele șablonului (canonice, în ordinea contractului). */
export function templateHeader(source: SourceId): string[] {
  return CONTRACTS[source].columns.map((c) => c.key)
}

/** Șablonul CSV descărcabil: doar antetul, fără rânduri (nicio dată demo). */
export function templateCsv(source: SourceId): string {
  return templateHeader(source).join(',') + '\n'
}
