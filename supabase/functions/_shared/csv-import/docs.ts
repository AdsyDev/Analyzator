// Documentele contractelor și șabloanele CSV, generate din contracts.ts (o singură sursă de adevăr).
// Regenerare: npm run docs:csv. Un test verifică faptul că fișierele din repo coincid cu cele generate.
import { CONTRACTS, templateCsv, type SourceContract, type SourceId } from './contracts.ts'

const TARGETS: Record<SourceContract['family'], string> = {
  paid: '`paid_daily` (cheie unică cu `tenant_id`, `brand_id`, `source`, cont, campanie, grup, reclamă, dată, defalcare, atribuire)',
  social: '`social_daily` (`level = daily`) și `social_posts` (`level = post`)',
  mentions: '`mentions`',
}

const DECLARED: Record<string, string> = {
  currency: '`currency`: moneda costurilor (ISO 4217). **Obligatorie**; fișierul nu o stabilește.',
  timezone: '`timezone`: fusul orar al datelor (IANA, de ex. `Europe/Bucharest`). **Obligatoriu**.',
  attribution_config: '`attribution_config`: configurația de atribuire a conversiilor (de ex. `7d_click_1d_view`). Opțional; implicit `unspecified`. Face parte din cheia unică.',
  click_type: '`click_type`: tipul de click (de ex. `all`, `link`). Opțional; implicit `unspecified`. Comparațiile cer același tip în ambele perioade.',
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export const CONTRACT_FILE: Record<SourceId, string> = {
  google_ads: 'docs/contracts/csv-google-ads.md',
  meta_ads: 'docs/contracts/csv-meta-ads.md',
  tiktok_ads: 'docs/contracts/csv-tiktok-ads.md',
  planable_analytics: 'docs/contracts/csv-planable-analytics.md',
  planable_listening: 'docs/contracts/csv-planable-listening.md',
}
export const TEMPLATE_FILE = (source: SourceId) => `docs/templates/csv/${source}.csv`

export function contractMarkdown(source: SourceId): string {
  const c = CONTRACTS[source]
  const lines: string[] = []
  lines.push(`# Contract import CSV: ${c.title}`)
  lines.push('')
  lines.push('> Generat din `supabase/functions/_shared/csv-import/contracts.ts` (`npm run docs:csv`). Nu se editează de mână.')
  lines.push('')
  lines.push(`Sursă: \`${c.source}\` · Tabel țintă: ${TARGETS[c.family]}`)
  lines.push(`Șablon: \`${TEMPLATE_FILE(source)}\` (doar antetul; nu conține date).`)
  lines.push('')
  lines.push('## Formatul platformei')
  lines.push('')
  lines.push(c.platform_format)
  lines.push('')
  lines.push('## Declarații pe lot (la încărcare)')
  lines.push('')
  for (const d of c.declares) lines.push(`- ${DECLARED[d]}`)
  lines.push('')
  lines.push('## Coloane')
  lines.push('')
  lines.push('| Coloană | Tip | Obligatorie | Descriere | Exemplu | Alias-uri (neconfirmate) |')
  lines.push('|---|---|---|---|---|---|')
  for (const col of c.columns) {
    const req = col.required === true ? 'da' : col.required === 'conditional' ? 'condiționat' : 'nu'
    const type = col.values ? `${col.type}: ${col.values.map((v) => `\`${v}\``).join(', ')}` : col.type
    const aliases = (col.aliases ?? []).map((a) => `\`${a}\``).join(', ')
    lines.push(`| \`${col.key}\` | ${cell(type)} | ${req} | ${cell(col.description)} | ${col.example ? `\`${cell(col.example)}\`` : ''} | ${aliases} |`)
  }
  if (c.headerPatterns?.length) {
    lines.push('')
    lines.push('Anteturi cu parametru: ' + c.headerPatterns.map((p) => `\`${p.pattern.source}\` → \`${p.key}\``).join('; ') + '.')
  }
  lines.push('')
  lines.push('## Cheia naturală (upsert)')
  lines.push('')
  lines.push(c.natural_key.map((k) => `\`${k}\``).join(', ') + '. Reimportul aceleiași chei înlocuiește rândul; nu îl dublează.')
  lines.push('')
  lines.push('## Reguli')
  lines.push('')
  for (const n of c.notes) lines.push(`- ${n}`)
  lines.push('- Codificare: UTF-8 (cu sau fără BOM), UTF-16 sau windows-1252 (detectat). Delimitator: virgulă, punct și virgulă sau TAB (detectat).')
  lines.push('- Limite: 10 MB și 50.000 de rânduri per fișier.')
  lines.push('')
  lines.push('## Flux')
  lines.push('')
  lines.push('1. `preview`: validare rând cu rând; lotul și rândurile (acceptate / respinse, cu motivul) se păstrează în `import_batches` și `import_batch_rows`.')
  lines.push('2. `confirm`: rândurile acceptate se scriu idempotent în tabelul țintă. Un fișier identic (același hash) nu se importă de două ori pentru același brand și aceeași sursă.')
  lines.push('3. Doar rolurile `agency_admin` și `account`, cu `brand_access`, pot importa (verificat la fiecare acțiune). Fiecare previzualizare și confirmare intră în `audit_events`.')
  lines.push('')
  return lines.join('\n')
}

export function allGenerated(): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  for (const source of Object.keys(CONTRACTS) as SourceId[]) {
    out.push({ path: CONTRACT_FILE[source], content: contractMarkdown(source) })
    out.push({ path: TEMPLATE_FILE(source), content: templateCsv(source) })
  }
  return out
}
