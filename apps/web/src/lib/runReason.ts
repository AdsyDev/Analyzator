import type { SyncRunStatus } from '../contracts'

/**
 * De ce o sincronizare e „Parțial” sau „Eșuat”, în română, din `sync_runs.errors` și `sync_runs.coverage`.
 * E o clasificare a codurilor scrise de conectori, nu o metrică: un cod necunoscut devine „alte erori tehnice”,
 * fără să ghicim ce înseamnă.
 */

/** Observații ale conectorilor care nu schimbă datele (câmpuri noi în API, verificări informative). */
const NOTES = new Set(['unknown_field', 'unknown_block', 'unknown_block_key', 'ignored_breakdown_block', 'parser_note', 'behavior_unverified', 'call_count_not_recorded'])
/**
 * La Clarity, tot ce începe cu `parser_` e o observație care nu schimbă starea rulării (câmpuri nemapate, valori
 * lipsă păstrate ca NULL). La SEOmonitor, doar `parser_unknown_field`; `parser_invalid_item` e o respingere reală.
 */
const isNote = (code: string, source?: string) =>
  NOTES.has(code) || code.startsWith('parser_unknown_field') || (source === 'clarity' && code.startsWith('parser_'))

/** Defalcările Clarity (`errors[].dimension` la `empty_payload`). */
const BREAKDOWNS: Record<string, string> = { all: 'total', device: 'dispozitiv', source: 'sursă', page: 'pagină' }
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} și ${xs[xs.length - 1]}`)

/** Rapoartele venite goale: fără nicio defalcare, Clarity n-a înregistrat nicio vizită în ziua colectată. */
function emptyLabel(dimensions: string[], source?: string): string {
  const known = dimensions.filter((d) => BREAKDOWNS[d])
  if (source === 'clarity' && ['device', 'source', 'page'].every((d) => known.includes(d))) {
    return 'Clarity nu a înregistrat nicio vizită (nicio defalcare pe dispozitiv, sursă sau pagină)'
  }
  return known.length ? `sursa nu a trimis date pentru ${list(known.map((d) => BREAKDOWNS[d]!))}` : LABELS.empty_payload!
}

const LABELS: Record<string, string> = {
  access_denied: 'accesul a fost refuzat de furnizor',
  permission_denied: 'cheia nu are drept de citire pe acest cont',
  token_unavailable: 'cheia nu a putut fi citită',
  credential_invalid: 'cheia salvată nu e validă',
  credential_invalid_json: 'cheia salvată nu e validă',
  budget_exhausted: 'bugetul zilnic de apeluri s-a epuizat',
  insufficient_budget: 'bugetul zilnic de apeluri s-a epuizat',
  rate_limited: 'furnizorul a limitat cererile',
  empty_report: 'sursa nu a trimis date în perioadă',
  empty_payload: 'sursa nu a trimis date pentru o parte din rapoarte',
  ga4_thresholding: 'GA4 a ascuns valori mici (pragul de confidențialitate)',
  ga4_sampled: 'GA4 a eșantionat raportul',
  ga4_data_loss_other_row: 'GA4 a grupat o parte din rânduri în „(other)”',
  ga4_incompatible_dimensions: 'GA4 nu permite o combinație de câmpuri',
  ga4_incompatible_metrics: 'GA4 nu permite o combinație de câmpuri',
  compatibility_check_failed: 'verificarea câmpurilor GA4 a eșuat',
  ga4_too_many_pages: 'detaliile au fost trunchiate (volum foarte mare)',
  gsc_truncated: 'detaliile au fost trunchiate (volum foarte mare)',
  timezone_mismatch: 'fusul orar al proprietății diferă de cel configurat',
  invalid_timezone: 'fusul orar configurat nu e valid',
  reconciliation_mismatch: 'totalurile nu se potrivesc cu cele raportate de sursă',
  invalid_property_id: 'ID-ul din conexiune nu e valid',
  invalid_site_url: 'ID-ul din conexiune nu e valid',
  invalid_account_id: 'ID-ul din conexiune nu e valid',
  mapped_group_missing: 'un grup SEOmonitor mapat nu mai există',
  campaign_not_found: 'campania SEOmonitor nu mai e urmărită',
  ai_engines_unknown: 'motoarele AI din SEOmonitor nu au putut fi citite',
  ai_originals_not_saved: 'textele originale ale răspunsurilor AI nu au fost salvate',
  workspace_not_found: 'workspace-ul Planable nu a fost găsit',
  invalid_payload: 'răspuns neașteptat de la furnizor',
  invalid_json: 'răspuns neașteptat de la furnizor',
  unexpected_rows: 'răspuns neașteptat de la furnizor',
  pagination_stalled: 'răspuns neașteptat de la furnizor',
}
const REJECTED = 'unele rânduri au fost respinse la validare'
const REJECTED_CODES = new Set(['invalid_row', 'invalid_item', 'invalid_value', 'invalid_metric_value', 'missing_dimension_header', 'missing_metric_header', 'missing_dimension_value', 'duplicate_dimension_value', 'dimension_too_long'])
const TIMEOUT = /57014|statement timeout/

function labelFor(code: string, message: string): string {
  if (code === 'exception' || code === 'orchestrator_exception') return TIMEOUT.test(message) ? 'baza de date nu a răspuns la timp' : 'eroare tehnică în timpul colectării'
  if (LABELS[code]) return LABELS[code]
  if (code.startsWith('normalize_') || code.startsWith('parser_') || REJECTED_CODES.has(code)) return REJECTED
  return 'alte erori tehnice'
}

/** Ce lipsește, pe seturi de date (cheile din `coverage`). Unitatea e zi, cu excepția intervalelor de utilizatori. */
const COVERAGE: Record<string, { what: string; unit: 'zile' | 'intervale' }> = {
  web_daily: { what: 'fără sesiuni', unit: 'zile' },
  web_key_events: { what: 'fără evenimente cheie', unit: 'zile' },
  web_active_users_interval: { what: 'fără utilizatori activi', unit: 'intervale' },
  search_daily: { what: 'fără date Search Console', unit: 'zile' },
  search_queries: { what: 'fără date Search Console', unit: 'zile' },
  ranks: { what: 'fără poziții', unit: 'zile' },
  visibility: { what: 'fără vizibilitate', unit: 'zile' },
  ai_answers: { what: 'fără răspunsuri AI', unit: 'zile' },
}

/** „1 zi”, „7 zile”, „35 de zile” (de la 20 în sus, „de”). */
export function count(n: number, unit: 'zile' | 'intervale'): string {
  if (n === 1) return unit === 'zile' ? '1 zi' : '1 interval'
  const de = n % 100 === 0 || n % 100 >= 20 ? 'de ' : ''
  return `${n} ${de}${unit}`
}

function coverageGaps(coverage: unknown): string[] {
  if (!coverage || typeof coverage !== 'object') return []
  const byWhat = new Map<string, { missing: number; expected: number; unit: 'zile' | 'intervale' }>()
  for (const [dataset, raw] of Object.entries(coverage as Record<string, unknown>)) {
    const c = raw as { expected_days?: unknown; covered_days?: unknown } | null
    const meta = COVERAGE[dataset]
    if (!meta || !c || typeof c.expected_days !== 'number' || typeof c.covered_days !== 'number') continue
    const missing = c.expected_days - c.covered_days
    if (missing <= 0) continue
    const prev = byWhat.get(meta.what)
    if (!prev || missing > prev.missing) byWhat.set(meta.what, { missing, expected: c.expected_days, unit: meta.unit })
  }
  return [...byWhat.entries()].map(([what, g]) => `${g.missing} din ${count(g.expected, g.unit)} ${what}`)
}

/**
 * Cel mult trei motive, primele fiind erorile; `null` pentru o rulare reușită sau fără nicio explicație salvată.
 * `source` (`sync_runs.source`) decide ce coduri sunt doar observații.
 */
export function runReason(status: SyncRunStatus, errors: unknown, coverage: unknown, source?: string): string | null {
  if (status !== 'partial' && status !== 'failed') return null
  const labels: string[] = []
  // Rapoartele goale dau un singur motiv, pe poziția primului, cu toate defalcările lor.
  const empty: string[] = []
  let emptyAt = -1
  for (const e of Array.isArray(errors) ? errors : []) {
    const o = (typeof e === 'string' ? { code: e } : e) as { code?: unknown; message?: unknown; dimension?: unknown } | null
    const code = typeof o?.code === 'string' ? o.code : ''
    if (!code || isNote(code, source)) continue
    if (code === 'empty_payload') {
      if (typeof o?.dimension === 'string' && !empty.includes(o.dimension)) empty.push(o.dimension)
      if (emptyAt < 0) {
        emptyAt = labels.length
        labels.push('')
      }
      continue
    }
    const label = labelFor(code, typeof o?.message === 'string' ? o.message : '')
    if (!labels.includes(label)) labels.push(label)
  }
  if (emptyAt >= 0) labels[emptyAt] = emptyLabel(empty, source)
  const reasons = [...labels, ...coverageGaps(coverage)]
  return reasons.length ? reasons.slice(0, 3).join('; ') : null
}

/** Codurile de eroare ale rulării (fără observații), pentru verificări precise, de exemplu accesul refuzat. */
export function runErrorCodes(errors: unknown, source?: string): string[] {
  const out = new Set<string>()
  for (const e of Array.isArray(errors) ? errors : []) {
    const code = typeof e === 'string' ? e : typeof (e as { code?: unknown } | null)?.code === 'string' ? (e as { code: string }).code : null
    if (code && !isNote(code, source)) out.add(code)
  }
  return [...out]
}
