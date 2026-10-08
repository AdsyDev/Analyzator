// Date SINTETICE, doar în acest fișier de test.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeBytes, detectDelimiter, parseCsv } from './csv.ts'
import { CONTRACTS, SOURCES, templateCsv, type SourceId } from './contracts.ts'
import { allGenerated } from './docs.ts'
import { confirmImport, ImportError, loadBatch, previewImport, validateDeclared, type BatchRow, type PreviewInput } from './service.ts'
import { parseDate, parseDateTime, validateTable } from './validate.ts'
import { MemImportDb } from './test-db.ts'

const T1 = '10000000-0000-0000-0000-000000000001'
const T2 = '10000000-0000-0000-0000-000000000002'
const B1 = '20000000-0000-0000-0000-000000000011'
const B2 = '20000000-0000-0000-0000-000000000021'
const ADMIN = '30000000-0000-0000-0000-000000000001'
const ACCOUNT = '30000000-0000-0000-0000-000000000003'
const NOW = new Date('2026-10-08T07:00:00Z') // 10:00 București; azi = 2026-10-08
const enc = (s: string) => new TextEncoder().encode(s)

const DECL = { currency: 'RON', timezone: 'Europe/Bucharest' }

function input(source: string, csv: string | Uint8Array, over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    tenant_id: T1, brand_id: B1, user_id: ACCOUNT, source, file_name: 'export.csv',
    bytes: typeof csv === 'string' ? enc(csv) : csv, declared: DECL, ...over,
  }
}
const preview = (db: MemImportDb, source: string, csv: string | Uint8Array, over: Partial<PreviewInput> = {}) =>
  previewImport({ db, now: () => NOW }, input(source, csv, over))
const batchOf = async (db: MemImportDb, id: string): Promise<BatchRow> => loadBatch(db, id)

const GOOGLE = [
  'Raport campanii',
  '1 octombrie 2026 - 7 octombrie 2026',
  'Day,Campaign,Ad group,Cost,Impr.,Clicks,Conversions',
  '2026-10-05,Toamna,Grup A,152.40,10450,312,14',
  '2026-10-06,Toamna,Grup A,160.00,,300,',
  'Total: cont,,,312.40,10450,612,14',
].join('\n')

async function rejectCode(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    if (e instanceof ImportError) return e.code
    throw e
  }
  return 'no_error'
}

describe('csv: decodare și parsare', () => {
  test('UTF-8 cu și fără BOM, UTF-16LE cu BOM (Google Ads), windows-1252', () => {
    assert.deepEqual(decodeBytes(enc('a,b\n')), { text: 'a,b\n', encoding: 'utf-8' })
    assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).text, 'a')
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Zi\tCost'].flatMap((c) => [c.charCodeAt(0), 0])])
    assert.deepEqual(decodeBytes(utf16), { text: 'Zi\tCost', encoding: 'utf-16le' })
    const latin = new Uint8Array([0x43, 0x61, 0x6d, 0x70, 0x61, 0x6e, 0x69, 0x65, 0x20, 0xe2]) // „Campanie â”
    assert.deepEqual(decodeBytes(latin), { text: 'Campanie â', encoding: 'windows-1252' })
  })

  test('delimitator: virgulă, punct și virgulă, TAB; ambiguu sau lipsă → null', () => {
    assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',')
    assert.equal(detectDelimiter('a;b;c;d\n1;2;3;4'), ';')
    assert.equal(detectDelimiter('a\tb\tc\n'), '\t')
    assert.equal(detectDelimiter('"a,b";c;d'), ';', 'virgula din ghilimele nu contează')
    assert.equal(detectDelimiter('a,b;c\n'), null)
    assert.equal(detectDelimiter('abc\n'), null)
  })

  test('ghilimele, ghilimele duble, newline în câmp, CRLF, rânduri goale', () => {
    const t = parseCsv('a,b\r\n"x, y","z ""q"""\r\n\r\n"multi\nlinie",2\r\n', ',')
    assert.deepEqual(t, [['a', 'b'], ['x, y', 'z "q"'], ['multi\nlinie', '2']])
    assert.throws(() => parseCsv('a,"b\n', ','), /ghilimele/)
  })
})

describe('contracte, șabloane și documente', () => {
  test('șablonul conține doar antetul (nicio dată demo) și toate coloanele contractului', () => {
    for (const s of SOURCES) {
      const t = templateCsv(s)
      assert.equal(t.trim().split('\n').length, 1, s)
      assert.deepEqual(t.trim().split(','), CONTRACTS[s].columns.map((c) => c.key))
    }
  })

  test('șablonul propriu trece validarea ca fișier fără rânduri (niciun rând acceptat, nicio eroare de antet)', async () => {
    for (const s of SOURCES) {
      const r = await validateTable(s, parseCsv(templateCsv(s), ','), DECL, NOW)
      assert.equal(r.ok, true, `${s}: ${r.errors.join('; ')}`)
      assert.equal(r.rows.length, 0)
    }
  })

  test('docs/contracts/csv-*.md și docs/templates/csv/*.csv sunt la zi (npm run docs:csv)', () => {
    const root = join(import.meta.dirname, '..', '..', '..', '..')
    for (const { path, content } of allGenerated()) {
      assert.equal(readFileSync(join(root, path), 'utf8'), content, `${path} nu e la zi`)
    }
  })

  test('fiecare contract declară moneda doar pentru paid', () => {
    for (const s of SOURCES) assert.equal(CONTRACTS[s].declares.includes('currency'), CONTRACTS[s].family === 'paid', s)
  })
})

describe('valori', () => {
  test('date și date-ore', () => {
    assert.equal(parseDate('2026-02-29'), null)
    assert.equal(parseDate('2026-10-05'), '2026-10-05')
    assert.equal(parseDate('05.10.2026'), null)
    assert.equal(parseDateTime('2026-10-05T12:00:00+03:00', 'UTC'), '2026-10-05T09:00:00.000Z')
    assert.equal(parseDateTime('2026-10-05T12:00:00Z', 'Europe/Bucharest'), '2026-10-05T12:00:00.000Z')
    assert.equal(parseDateTime('2026-10-05 12:00', 'Europe/Bucharest'), '2026-10-05T09:00:00.000Z', 'fără offset: fusul declarat (EEST = UTC+3)')
    assert.equal(parseDateTime('2026-12-05 12:00', 'Europe/Bucharest'), '2026-12-05T10:00:00.000Z', 'iarna: EET = UTC+2')
    assert.equal(parseDateTime('2026-10-05', 'UTC'), null)
    assert.equal(parseDateTime('2026-10-05T25:00:00Z', 'UTC'), null)
  })
})

describe('paid: validare (Google Ads)', () => {
  test('rânduri introductive și rândul „Total” ignorate; antetul găsit; celulă goală = NULL, nu 0', async () => {
    const db = new MemImportDb()
    const r = await preview(db, 'google_ads', GOOGLE)
    assert.equal(r.status, 'validated')
    assert.equal(r.rows_accepted, 2)
    assert.equal(r.rows_rejected, 0)
    assert.equal(r.rows_skipped, 1)
    assert.equal(r.detected.header_row, 3)
    assert.deepEqual(r.period, { start: '2026-10-05', end: '2026-10-06' })
    const second = r.sample_accepted[1]!.data!
    assert.equal(second.impressions, null, 'celulă goală → NULL')
    assert.equal(second.conversions, null)
    assert.equal(second.clicks, 300)
    assert.equal(second.campaign_id, 'name:Toamna', 'fără ID: se derivă marcat, nu se inventează')
    assert.equal(second.ad_group_id, 'name:Grup A')
    assert.equal(second.ad_id, '')
    assert.equal(second.attribution_config, 'unspecified')
    assert.equal(second.click_type, 'unspecified')
    assert.equal(second.breakdown_signature, 'none')
    assert.equal(r.totals.spend, 312.4)
  })

  test('zero explicit rămâne 0 (diferit de gol)', async () => {
    const csv = 'date,campaign_name,spend,impressions,clicks\n2026-10-05,C,10.5,0,\n'
    const r = await preview(new MemImportDb(), 'tiktok_ads', csv)
    assert.equal(r.sample_accepted[0]!.data!.impressions, 0)
    assert.equal(r.sample_accepted[0]!.data!.clicks, null)
  })

  test('UTF-16LE cu TAB (formatul unui export Google Ads) este detectat', async () => {
    const text = 'Day\tCampaign\tCost\tClicks\n2026-10-05\tToamna\t12.5\t3\n'
    const bytes = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0), 0])])
    const r = await preview(new MemImportDb(), 'google_ads', bytes)
    assert.equal(r.status, 'validated')
    assert.equal(r.detected.encoding, 'utf-16le')
    assert.equal(r.detected.delimiter, '\t')
  })

  test('coloane obligatorii lipsă → lot respins, cu motiv; nimic acceptat', async () => {
    const db = new MemImportDb()
    const r = await preview(db, 'meta_ads', 'Campaign name,Impressions\nX,10\n')
    assert.equal(r.status, 'rejected')
    assert.equal(r.can_confirm, false)
    assert.match(r.errors[0]!, /coloane obligatorii lipsă: date, spend/)
    assert.equal(db.rows('import_batches')[0]!.status, 'rejected')
  })

  test('duplicate în fișier: primul rămâne, următoarele respinse cu trimitere la primul', async () => {
    const csv = 'date,campaign_id,spend\n2026-10-05,C1,10\n2026-10-06,C1,11\n2026-10-05,C1,99\n'
    const r = await preview(new MemImportDb(), 'tiktok_ads', csv)
    assert.equal(r.rows_accepted, 2)
    assert.equal(r.rows_rejected, 1)
    assert.deepEqual(r.rejected[0], { row_number: 4, reason: 'duplicat în fișier (aceeași cheie ca rândul 2)' })
  })

  test('formate numerice ambigue, semne și text sunt respinse; datele invalide și viitoare la fel', async () => {
    const csv = [
      'date,campaign_id,spend,clicks',
      '2026-10-01,A,"1.234,56",1',
      '2026-10-01,B,"12,5",1',
      '2026-10-01,C,"1,234.56",1',
      '2026-10-01,D,-3,1',
      '2026-10-01,E,abc,1',
      '2026-10-01,F,5,1.5',
      '2026-13-01,G,5,1',
      '2026-10-09,H,5,1',
      '2026-10-08,I,5,1',
    ].join('\n')
    const r = await preview(new MemImportDb(), 'tiktok_ads', csv)
    assert.equal(r.rows_accepted, 1, 'doar rândul din ziua curentă e valid')
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.row_number, x.reason]))
    assert.match(reasons[2]!, /format numeric neacceptat/)
    assert.match(reasons[4]!, /format numeric neacceptat/)
    assert.match(reasons[5]!, /valoare numerică invalidă/)
    assert.match(reasons[6]!, /valoare numerică invalidă/)
    assert.match(reasons[7]!, /clicks: se așteaptă un număr întreg/)
    assert.match(reasons[8]!, /dată invalidă/)
    assert.match(reasons[9]!, /în viitor/)
    assert.equal(reasons[10], undefined)
  })

  test('rând fără nicio metrică respins; defalcarea intră în cheie', async () => {
    const csv = 'date,campaign_id,spend,impressions,breakdown\n2026-10-05,C,,,\n2026-10-05,C,5,,Device=Mobile\n2026-10-05,C,7,,\n'
    const r = await preview(new MemImportDb(), 'tiktok_ads', csv)
    assert.equal(r.rows_rejected, 1)
    assert.match(r.rejected[0]!.reason, /fără nicio metrică/)
    assert.equal(r.rows_accepted, 2)
    assert.equal(r.sample_accepted[0]!.data!.breakdown_signature, 'device=mobile')
  })

  test('monedă: nedeclarată → refuzat; invalidă → refuzat; pe rând diferită → respins; în antet diferită → lot respins', async () => {
    const csv = 'date,campaign_id,spend,currency\n2026-10-05,C,5,EUR\n2026-10-05,D,5,RON\n'
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { timezone: 'Europe/Bucharest' } })), 'currency_required')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { timezone: 'Europe/Bucharest', currency: 'EURO' } })), 'currency_invalid')
    const r = await preview(new MemImportDb(), 'tiktok_ads', csv)
    assert.equal(r.rows_accepted, 1)
    assert.match(r.rejected[0]!.reason, /moneda rândului \(EUR\) diferă de cea declarată pe lot \(RON\)/)
    const meta = await preview(new MemImportDb(), 'meta_ads', 'Reporting starts,Campaign name,Amount spent (EUR)\n2026-10-05,C,5\n')
    assert.equal(meta.status, 'rejected')
    assert.match(meta.errors[0]!, /moneda din antetul de cost \(EUR\)/)
    const ok = await preview(new MemImportDb(), 'meta_ads', 'Reporting starts,Campaign name,Amount spent (RON)\n2026-10-05,C,5\n')
    assert.equal(ok.status, 'validated')
  })

  test('fus orar nedeclarat sau necunoscut → refuzat', async () => {
    const csv = 'date,campaign_id,spend\n2026-10-05,C,5\n'
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { currency: 'RON' } })), 'timezone_required')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { currency: 'RON', timezone: 'Marte/Olympus' } })), 'timezone_invalid')
  })

  test('Meta: „Clicks (all)” și „Link clicks” în același fișier = ambiguu; „Results” nu e mapat', async () => {
    const both = await preview(new MemImportDb(), 'meta_ads', 'Reporting starts,Campaign name,Amount spent (RON),Clicks (all),Link clicks\n2026-10-05,C,5,10,8\n')
    assert.equal(both.status, 'rejected')
    assert.match(both.errors[0]!, /coloane ambigue pentru „clicks”/)
    const results = await preview(new MemImportDb(), 'meta_ads', 'Reporting starts,Campaign name,Amount spent (RON),Results\n2026-10-05,C,5,9\n')
    assert.equal(results.status, 'validated')
    assert.deepEqual(results.detected.ignored_columns, ['Results'])
    assert.equal(results.sample_accepted[0]!.data!.conversions, null)
  })

  test('declarații opționale: attribution_config și click_type ajung în rânduri; valori invalide refuzate', async () => {
    const csv = 'date,campaign_id,spend,clicks\n2026-10-05,C,5,2\n'
    const ok = await preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { ...DECL, attribution_config: '7d_click_1d_view', click_type: 'link' } })
    assert.equal(ok.sample_accepted[0]!.data!.attribution_config, '7d_click_1d_view')
    assert.equal(ok.sample_accepted[0]!.data!.click_type, 'link')
    const meta = await preview(new MemImportDb(), 'meta_ads', csv.replace('date,campaign_id', 'Reporting starts,Campaign ID'), {
      declared: { ...DECL, attribution_config: '7d_click_1d_view', click_type: 'link' },
    })
    assert.equal(meta.status, 'validated', 'numele canonice sunt acceptate și la Meta')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', csv, { declared: { ...DECL, click_type: '<script>' } })), 'click_type_invalid')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'planable_listening', 'url,published_at\n', { declared: { timezone: 'UTC', click_type: 'all' } })), 'click_type_not_applicable')
  })

  test('fișier gol, prea mare, sursă necunoscută, delimitator nedetectat', async () => {
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', new Uint8Array(0))), 'empty_file')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'tiktok_ads', new Uint8Array(10 * 1024 * 1024 + 1))), 'file_too_large')
    assert.equal(await rejectCode(preview(new MemImportDb(), 'snapchat_ads', 'a,b\n')), 'unknown_source')
    const r = await preview(new MemImportDb(), 'tiktok_ads', 'doar-o-coloana\n1\n')
    assert.equal(r.status, 'rejected')
    assert.match(r.errors[0]!, /delimitator nedetectat/)
  })
})

describe('flux: previzualizare, confirmare, idempotență', () => {
  const FILE_A = 'date,campaign_id,campaign_name,spend,impressions,clicks,conversions\n2026-10-05,C1,Toamna,10.5,100,5,1\n2026-10-06,C1,Toamna,20,200,9,2\n'
  const FILE_B = 'date,campaign_id,campaign_name,spend,impressions,clicks,conversions\n2026-10-05,C1,Toamna,11.5,110,6,1\n2026-10-06,C1,Toamna,20,200,9,2\n'

  test('confirmare: scrie în paid_daily cu proveniență și monedă; lotul devine imported; audit cu cine a încărcat și cine a confirmat', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', FILE_A)
    assert.equal(db.rows('paid_daily').length, 0, 'previzualizarea nu scrie în tabelul țintă')
    assert.equal(db.rows('import_batch_rows').length, 2)
    const batch = await batchOf(db, p.batch_id)
    const done = await confirmImport({ db, now: () => NOW }, batch, ADMIN)
    assert.deepEqual(done.written, { paid_daily: 2 })
    const rows = db.rows('paid_daily')
    assert.equal(rows.length, 2)
    assert.equal(rows[0]!.source, 'tiktok_ads')
    assert.equal(rows[0]!.currency, 'RON')
    assert.equal(rows[0]!.import_batch_id, p.batch_id)
    assert.equal(rows[0]!.collection_method, 'csv')
    assert.equal(rows[0]!.source_timezone, 'Europe/Bucharest')
    assert.match(rows[0]!.payload_hash as string, /^[0-9a-f]{64}$/)
    assert.equal(rows[0]!.tenant_id, T1)
    assert.equal(rows[0]!.brand_id, B1)
    const b = db.rows('import_batches')[0]!
    assert.deepEqual([b.status, b.confirmed_by, b.uploaded_by], ['imported', ADMIN, ACCOUNT])
    const audit = db.rows('audit_events').map((e) => [e.action, e.actor_user_id])
    assert.deepEqual(audit, [['import_previewed', ACCOUNT], ['import_confirmed', ADMIN]])
    assert.equal(db.conflictKeys.paid_daily!.join(','), 'tenant_id,brand_id,source,account_id,campaign_id,ad_group_id,ad_id,date,breakdown_signature,attribution_config')
  })

  test('fișier identic după import: refuzat (409 duplicate_file); a doua confirmare: 409', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', FILE_A)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)
    assert.equal(await rejectCode(preview(db, 'tiktok_ads', FILE_A)), 'duplicate_file')
    assert.equal(await rejectCode(confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)), 'already_imported')
    assert.equal(db.rows('paid_daily').length, 2)
    // alt brand sau altă sursă: același conținut e un lot nou
    const other = await preview(db, 'google_ads', FILE_A.replace('date,campaign_id,campaign_name,spend,impressions,clicks,conversions', 'Day,Campaign ID,Campaign,Cost,Impr.,Clicks,Conversions'))
    assert.equal(other.status, 'validated')
  })

  test('reimport pe aceeași perioadă (fișier diferit): înlocuiește, nu dublează', async () => {
    const db = new MemImportDb()
    await confirmImport({ db, now: () => NOW }, await batchOf(db, (await preview(db, 'tiktok_ads', FILE_A)).batch_id), ADMIN)
    assert.equal(db.rows('paid_daily')[0]!.spend, 10.5)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, (await preview(db, 'tiktok_ads', FILE_B)).batch_id), ADMIN)
    const rows = db.rows('paid_daily')
    assert.equal(rows.length, 2, 'aceeași cheie naturală: același număr de rânduri')
    assert.equal(rows[0]!.spend, 11.5)
    assert.equal(db.rows('import_batches').length, 2)
  })

  test('previzualizare repetată a aceluiași fișier neconfirmat: rândurile din lot se înlocuiesc, nu se acumulează', async () => {
    const db = new MemImportDb()
    const a = await preview(db, 'tiktok_ads', FILE_A)
    const b = await preview(db, 'tiktok_ads', FILE_A, { declared: { ...DECL, currency: 'EUR' } })
    assert.equal(a.batch_id, b.batch_id)
    assert.equal(db.rows('import_batches').length, 1)
    assert.equal(db.rows('import_batch_rows').length, 2)
    assert.equal(db.rows('import_batches')[0]!.currency, 'EUR', 'declarația nouă înlocuiește pe cea veche')
  })

  test('confirmarea unui lot respins sau cu zero rânduri acceptate: refuzată', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', 'date,campaign_id\n2026-10-05,C\n')
    assert.equal(p.status, 'rejected')
    assert.equal(await rejectCode(confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)), 'not_validated')
  })

  test('cădere la mijlocul confirmării: lotul revine la validated, reconfirmarea reușește fără dubluri', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', FILE_A)
    db.failUpsert = { table: 'paid_daily', times: 1 }
    assert.equal(await rejectCode(confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)), 'import_failed')
    assert.equal(db.rows('import_batches')[0]!.status, 'validated')
    assert.equal(db.rows('paid_daily').length, 0)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)
    assert.equal(db.rows('paid_daily').length, 2)
    assert.equal(db.rows('import_batches')[0]!.status, 'imported')
  })

  test('două confirmări simultane: doar una câștigă revendicarea', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', FILE_A)
    const stale = await batchOf(db, p.batch_id)
    const results = await Promise.allSettled([confirmImport({ db, now: () => NOW }, stale, ADMIN), confirmImport({ db, now: () => NOW }, { ...stale }, ACCOUNT)])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(db.rows('paid_daily').length, 2)
  })

  test('izolare: un rând pus în lot pentru alt brand oprește importul; nimic nu se scrie', async () => {
    const db = new MemImportDb()
    const p = await preview(db, 'tiktok_ads', FILE_A)
    db.rows('import_batch_rows')[0]!.brand_id = B2
    // Interogarea filtrează pe tenant și brand: rândul modificat nu mai e găsit, deci numărul nu corespunde (staged_mismatch).
    assert.equal(await rejectCode(confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)), 'staged_mismatch')
    assert.equal(db.rows('paid_daily').length, 0)
    assert.equal(db.rows('import_batches')[0]!.status, 'validated')
  })

  test('izolare: același fișier pentru două branduri sau două tenanți = loturi separate', async () => {
    const db = new MemImportDb()
    const a = await preview(db, 'tiktok_ads', FILE_A)
    const b = await preview(db, 'tiktok_ads', FILE_A, { tenant_id: T2, brand_id: B2 })
    assert.notEqual(a.batch_id, b.batch_id)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, a.batch_id), ADMIN)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, b.batch_id), ADMIN)
    const rows = db.rows('paid_daily')
    assert.equal(rows.length, 4)
    assert.deepEqual([...new Set(rows.map((r) => `${r.tenant_id}/${r.brand_id}`))].sort(), [`${T1}/${B1}`, `${T2}/${B2}`])
  })

  test('validateDeclared fără efecte secundare: sursa sociala nu cere monedă', () => {
    assert.deepEqual(validateDeclared('planable_analytics', { timezone: 'Europe/Bucharest' }), { timezone: 'Europe/Bucharest' })
  })
})

describe('social (Planable Analytics)', () => {
  const HEADER = 'level,platform,account_id,account_name,date,post_id,published_at,snapshot_date,metrics_scope,followers,impressions,reach,likes'
  test('rânduri daily → social_daily, post → social_posts; reach nesumabil; absent = NULL', async () => {
    const csv = [
      HEADER,
      'daily,Instagram,A1,Brand A,2026-10-05,,,,,5230,8400,6100,',
      'post,instagram,A1,,,P1,2026-10-05T09:30:00+03:00,2026-10-07,lifetime,,1200,900,80',
    ].join('\n')
    const db = new MemImportDb()
    const p = await preview(db, 'planable_analytics', csv, { declared: { timezone: 'Europe/Bucharest' } })
    assert.equal(p.rows_accepted, 2, JSON.stringify(p.rejected))
    const done = await confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)
    assert.deepEqual(done.written, { social_daily: 1, social_posts: 1 })
    const daily = db.rows('social_daily')[0]!
    assert.equal(daily.platform, 'instagram')
    assert.equal(daily.followers, 5230)
    assert.equal(daily.reach_not_additive, 6100)
    assert.equal(daily.likes, null, 'metrică absentă = NULL, nu 0')
    const post = db.rows('social_posts')[0]!
    assert.equal(post.published_at, '2026-10-05T06:30:00.000Z')
    assert.equal(post.metrics_scope, 'lifetime')
    assert.equal(post.likes, 80)
    assert.equal('currency' in daily, false)
  })

  test('level invalid, daily fără dată, post fără snapshot / scope / published_at, rând fără metrici, duplicate', async () => {
    const csv = [
      HEADER,
      'weekly,instagram,A1,,2026-10-05,,,,,,10,,',
      'daily,instagram,A1,,,,,,,,10,,',
      'post,instagram,A1,,,P1,2026-10-05T09:30:00Z,,lifetime,,10,,',
      'post,instagram,A1,,,P2,2026-10-05T09:30:00Z,2026-10-07,total,,10,,',
      'post,instagram,A1,,,P3,,2026-10-07,period,,10,,',
      'daily,instagram,A1,,2026-10-05,,,,,,,,',
      'daily,instagram,A1,,2026-10-06,,,,,,10,,',
      'daily,instagram,A1,,2026-10-06,,,,,,11,,',
    ].join('\n')
    const p = await preview(new MemImportDb(), 'planable_analytics', csv, { declared: { timezone: 'UTC' } })
    assert.equal(p.rows_accepted, 1)
    const by = Object.fromEntries(p.rejected.map((r) => [r.row_number, r.reason]))
    assert.match(by[2]!, /level: „weekly” nu e valid/)
    assert.match(by[3]!, /date: dată invalidă/)
    assert.match(by[4]!, /snapshot_date/)
    assert.match(by[5]!, /metrics_scope/)
    assert.match(by[6]!, /published_at/)
    assert.match(by[7]!, /fără nicio metrică/)
    assert.match(by[9]!, /duplicat/)
  })

  test('lifetime și period ale aceleiași postări sunt rânduri distincte (nu se suprapun)', async () => {
    const csv = [HEADER, 'post,instagram,A1,,,P1,2026-10-05T09:30:00Z,2026-10-07,lifetime,,1200,,', 'post,instagram,A1,,,P1,2026-10-05T09:30:00Z,2026-10-07,period,,300,,'].join('\n')
    const db = new MemImportDb()
    const p = await preview(db, 'planable_analytics', csv, { declared: { timezone: 'UTC' } })
    assert.equal(p.rows_accepted, 2)
    await confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)
    assert.equal(db.rows('social_posts').length, 2)
  })
})

describe('mențiuni (Planable Listening)', () => {
  const HEADER = 'native_id,url,source_name,published_at,text,sentiment,language,country'

  test('sentiment gol = unknown (stare explicită), native_id din hash-ul URL-ului; câmpuri invalide respinse', async () => {
    const csv = [
      HEADER,
      ',https://exemplu.ro/a,exemplu.ro,2026-10-05T12:00:00+03:00,,,ro,RO',
      'm-2,https://exemplu.ro/b,exemplu.ro,2026-10-05T12:00:00Z,text,Negative,ro,RO',
      'm-3,ftp://exemplu.ro/c,x,2026-10-05T12:00:00Z,,,,',
      'm-4,https://exemplu.ro/d,x,2026-10-05T12:00:00Z,,furios,,',
      'm-5,https://exemplu.ro/e,x,2099-01-01T00:00:00Z,,,,',
      'm-2,https://exemplu.ro/b2,x,2026-10-05T12:00:00Z,,,,',
      'm-7,https://exemplu.ro/g,x,2026-10-05T12:00:00Z,,neutral,RO,ro',
    ].join('\n')
    const db = new MemImportDb()
    const p = await preview(db, 'planable_listening', csv, { declared: { timezone: 'Europe/Bucharest' } })
    assert.equal(p.rows_accepted, 2)
    const first = p.sample_accepted[0]!.data!
    assert.equal(first.sentiment, 'unknown')
    assert.match(first.native_id as string, /^h:[0-9a-f]{32}$/)
    assert.equal(p.sample_accepted[1]!.data!.sentiment, 'negative')
    const by = Object.fromEntries(p.rejected.map((r) => [r.row_number, r.reason]))
    assert.match(by[4]!, /url/)
    assert.match(by[5]!, /sentiment/)
    assert.match(by[6]!, /în viitor/)
    assert.match(by[7]!, /duplicat/)
    assert.match(by[8]!, /language/)
    assert.match(by[8]!, /country/)
  })

  test('reimport: sentimentul revizuit de un om nu se suprascrie; restul câmpurilor se actualizează', async () => {
    const db = new MemImportDb({
      mentions: [{
        tenant_id: T1, brand_id: B1, native_id: 'm-1', url: 'https://exemplu.ro/a', sentiment: 'positive',
        sentiment_reviewed_by: ADMIN, sentiment_reviewed_at: '2026-10-06T10:00:00Z', text: 'vechi',
      }],
    })
    const csv = [HEADER, 'm-1,https://exemplu.ro/a,exemplu.ro,2026-10-05T12:00:00Z,nou,negative,ro,RO', 'm-2,https://exemplu.ro/b,exemplu.ro,2026-10-05T13:00:00Z,,negative,ro,RO'].join('\n')
    const p = await preview(db, 'planable_listening', csv, { declared: { timezone: 'UTC' } })
    await confirmImport({ db, now: () => NOW }, await batchOf(db, p.batch_id), ADMIN)
    const m1 = db.rows('mentions').find((m) => m.native_id === 'm-1')!
    assert.equal(m1.sentiment, 'positive', 'corecția umană are prioritate')
    assert.equal(m1.sentiment_reviewed_by, ADMIN)
    assert.equal(m1.text, 'nou')
    const m2 = db.rows('mentions').find((m) => m.native_id === 'm-2')!
    assert.equal(m2.sentiment, 'negative')
    assert.equal(db.rows('mentions').length, 2)
  })

  test('nu se stochează autorul (date personale minime)', () => {
    assert.ok(!CONTRACTS.planable_listening.columns.some((c) => /author|autor/i.test(c.key)))
  })
})

describe('toate sursele', () => {
  test('SOURCES acoperă cele cinci surse din brief', () => {
    assert.deepEqual([...SOURCES].sort(), ['google_ads', 'meta_ads', 'planable_analytics', 'planable_listening', 'tiktok_ads'])
  })
  test('fiecare sursă are alias-urile marcate ca neconfirmate în document', () => {
    for (const s of SOURCES as readonly SourceId[]) {
      const withAliases = CONTRACTS[s].columns.some((c) => c.aliases?.length) || (CONTRACTS[s].headerPatterns?.length ?? 0) > 0
      const doc = allGenerated().find((g) => g.path.endsWith(`csv-${s.replace('_', '-').replace('_', '-')}.md`))!.content
      if (withAliases) assert.match(doc, /Alias-uri \(neconfirmate\)/)
      assert.match(doc, /Formatul platformei/)
    }
  })
})
