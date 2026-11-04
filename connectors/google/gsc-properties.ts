// Search Console: verificarea și trecerea site-urilor pe Domain property (D-27). Pașii: docs/runbook.md.
//
//   npm run gsc:properties [-- --tenant <uuid>]
//       doar citire: proprietatea fiecărui site, ce vede cheia clientului și ce s-ar face
//   npm run gsc:properties -- --apply --brand <uuid> [--brand <uuid>…] [--from YYYY-MM-DD]
//       trece site-urile alese pe Domain property (doar `switch` / `connect`; `keep` nu scrie nimic), apoi colectează
//       Search Console pentru fiecare: de la `from` (reimport, cel mult 16 luni) sau ultimele 35 de zile
//   npm run gsc:properties -- --history --brand <uuid> [--brand <uuid>…] [--from YYYY-MM-DD]
//       istoricul vechi: zilele dinaintea primei zile cu date de la Domain property, din proprietatea URL prefix
//       arhivată a site-ului, de la `from` (implicit: cea mai veche zi permisă, 16 luni); apoi fereastra obișnuită
//
// Mediu: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (ca la colectori). Cheia Google se citește din Vault, doar în memorie.

import { parseArgs } from 'node:util'
import { SupabaseRest, assertUuid, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { assertBackfillFrom, collectGoogle, gscEarliestDate, type GoogleOutcome } from './collect-core.ts'
import {
  applyGscProperty,
  estimateHistoryRows,
  importArchivedHistory,
  inspectGscProperties,
  planArchivedHistory,
  type GscSiteReport,
} from './gsc-properties-core.ts'

const READY = new Set(['switch', 'connect', 'keep'])
const fmt = (n: number) => n.toLocaleString('ro-RO')

function print(r: GscSiteReport): void {
  console.log(`${r.tenant_name ?? r.tenant_id} · ${r.brand_name} (${r.domain ?? 'fără domeniu'}) · brand ${r.brand_id}`)
  console.log(`  acum: ${r.current.length ? r.current.map((c) => `${c.site_url} (conexiunea ${c.connection_id})`).join(', ') : 'fără conexiune Search Console'}`)
  console.log(`  cheia vede: ${r.visible.length ? r.visible.join(', ') : '—'}`)
  console.log(`  acțiune: ${r.action} (${r.note})`)
  const estimate = estimateHistoryRows(r.last_run_rows)
  if (r.last_run_rows !== null && estimate !== null) console.log(`  ultima rulare: ${fmt(r.last_run_rows)} rânduri pe 35 de zile; 16 luni ≈ ${fmt(estimate)} rânduri`)
  if (r.archived_count > 0) console.log(`  proprietăți arhivate: ${r.archived.map((a) => a.site_url).join(', ')}; rânduri rămase de la ele: ${r.old_property_rows ? 'DA' : 'nu'}`)
  const range = (d: { first: string; last: string } | null) => (d ? `${d.first}..${d.last}` : 'fără zile')
  if (r.current.length === 1) console.log(`  zile cu date: activă ${range(r.days_current)}${r.archived_count > 0 ? ` · arhivate ${range(r.days_archived)}` : ''}`)
  if (r.days_current && r.archived_count > 0) {
    console.log(`  rânduri ale proprietăților arhivate din ${r.days_current.first} încolo (zile amestecate): ${r.archived_rows_since_current ? 'DA' : 'nu'}`)
  }
}

/** Câte un rând pe fereastră; întoarce câte rulări au eșuat sau nu s-au putut face. */
function printOutcomes(outcomes: GoogleOutcome[]): number {
  let failed = 0
  for (const o of outcomes) {
    if (o.status === 'not_connected') {
      console.log(`  gsc: neconectat (${o.reason})`)
      failed++
      continue
    }
    console.log(`  ${o.period.start}..${o.period.end}: ${o.status}, ${fmt(o.rows_written)} rânduri, ${o.api_calls} apeluri`)
    for (const e of o.errors) console.log(`    ${e.code}${e.dimension ? ` [${e.dimension}]` : ''}: ${e.message}`)
    if (o.status === 'failed') failed++
  }
  return failed
}

function summary(reports: GscSiteReport[]): void {
  const by = (a: string) => reports.filter((r) => r.action === a).length
  const ready = reports.filter((r) => READY.has(r.action))
  const rows = ready.reduce((sum, r) => sum + (estimateHistoryRows(r.last_run_rows) ?? 0), 0)
  console.log(
    `\nRezumat: ${reports.length} site-uri · de trecut ${by('switch')} · de conectat ${by('connect')} · deja pe Domain property ${by('keep')}` +
      ` · de lămurit ${reports.length - ready.length}. Reimport 16 luni pe cele pregătite ≈ ${fmt(rows)} rânduri (estimare).`,
  )
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      apply: { type: 'boolean', default: false },
      history: { type: 'boolean', default: false },
      brand: { type: 'string', multiple: true },
      from: { type: 'string' },
    },
    strict: true,
  })
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const now = () => new Date()

  if (values.apply && values.history) throw new Error('--apply și --history sunt pași separați: întâi --apply, apoi --history.')
  if (values.history) return history(db, now, values)
  if (!values.apply) {
    if (values.brand?.length || values.from !== undefined) throw new Error('--brand și --from merg doar cu --apply sau --history.')
    const reports = await inspectGscProperties({ db, now }, { tenantId: values.tenant })
    for (const r of reports) print(r)
    summary(reports)
    return
  }

  const brands = [...new Set(values.brand ?? [])]
  if (brands.length === 0) throw new Error('--apply cere cel puțin un --brand <uuid>.')
  for (const b of brands) assertUuid(b, 'brand_id')
  if (values.from !== undefined) assertBackfillFrom(values.from, now())

  // Toate site-urile se verifică înainte de prima scriere: unul nepregătit oprește tot.
  const reports = await inspectGscProperties({ db, now }, { tenantId: values.tenant })
  const chosen = brands.map((id) => {
    const r = reports.find((x) => x.brand_id === id)
    if (!r) throw new Error(`Brandul ${id} nu e un site activ (sau nu e al clientului ales).`)
    return r
  })
  const blocked = chosen.filter((r) => !READY.has(r.action))
  if (blocked.length) throw new Error(`Nu schimb nimic. Site-uri nepregătite:\n${blocked.map((r) => `  ${r.brand_name}: ${r.action} (${r.note})`).join('\n')}`)

  let failed = 0
  for (const r of chosen) {
    const applied = await applyGscProperty(db, r)
    console.log(
      `${r.brand_name}: ${applied.action === 'kept' ? `rămâne pe ${applied.site_url}` : `${applied.previous ?? 'fără conexiune'} → ${applied.site_url}`} (conexiunea ${applied.connection_id})`,
    )
    failed += printOutcomes(await collectGoogle({ db, now }, 'gsc', { brandId: r.brand_id, from: values.from }))
  }

  console.log('\nStarea după trecere:')
  const after = await inspectGscProperties({ db, now }, { tenantId: values.tenant })
  for (const r of after.filter((x) => brands.includes(x.brand_id))) print(r)
  if (failed) process.exitCode = 1
}

/** Istoricul vechi din proprietatea URL prefix arhivată, pentru zilele dinaintea Domain property (D-27). */
async function history(db: SupabaseRest, now: () => Date, values: { tenant?: string; brand?: string[]; from?: string }): Promise<void> {
  const brands = [...new Set(values.brand ?? [])]
  if (brands.length === 0) throw new Error('--history cere cel puțin un --brand <uuid>.')
  for (const b of brands) assertUuid(b, 'brand_id')
  const from = values.from ?? gscEarliestDate(now())
  assertBackfillFrom(from, now())

  // Toate site-urile se verifică înainte de prima scriere: unul nepregătit oprește tot.
  const reports = await inspectGscProperties({ db, now }, { tenantId: values.tenant })
  const plans = brands.map((id) => {
    const r = reports.find((x) => x.brand_id === id)
    if (!r) throw new Error(`Brandul ${id} nu e un site activ (sau nu e al clientului ales).`)
    return planArchivedHistory(r, from)
  })

  let failed = 0
  for (const p of plans) {
    if (p.until < p.from) {
      console.log(`${p.brand_name}: nimic de importat (${p.current.site_url} are date de la ${p.current.first_day})`)
      continue
    }
    console.log(
      `${p.brand_name}: zilele ${p.from}..${p.until} din ${p.source.site_url} (arhivată, conexiunea ${p.source.connection_id});` +
        ` ${p.current.site_url} are date de la ${p.current.first_day}`,
    )
    const { history: windows, regular } = await importArchivedHistory({ db, now }, p)
    failed += printOutcomes(windows)
    if (regular.length) {
      console.log(`  fereastra obișnuită, pe ${p.current.site_url}:`)
      failed += printOutcomes(regular)
    }
  }

  console.log('\nStarea după import:')
  const after = await inspectGscProperties({ db, now }, { tenantId: values.tenant })
  for (const r of after.filter((x) => brands.includes(x.brand_id))) print(r)
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
