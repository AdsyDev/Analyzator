// Decodare și parsare CSV, fără dependențe (rulează în Deno și Node).
// Acceptă UTF-8 (cu sau fără BOM), UTF-16 LE/BE (cu BOM; exporturile Google Ads) și, ca ultimă variantă, windows-1252.
// Delimitatori: virgulă, punct și virgulă, tab. Ghilimele RFC 4180 (câmpuri cu delimitator, ghilimele duble, newline).

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
export type Delimiter = ',' | ';' | '\t'

export function decodeBytes(bytes: Uint8Array): { text: string; encoding: Encoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/**
 * Delimitatorul = cel cu cele mai multe apariții (în afara ghilimelelor) pe una dintre primele 15 linii nevide.
 * Exporturile au rânduri introductive fără delimitatori; antetul câștigă. Egalitate sau niciunul → null.
 */
export function detectDelimiter(text: string): Delimiter | null {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '').slice(0, 15)
  const best: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  for (const line of lines) {
    const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 }
    let quoted = false
    for (const ch of line) {
      if (ch === '"') quoted = !quoted
      else if (!quoted && ch in counts) counts[ch as Delimiter]++
    }
    for (const d of Object.keys(best) as Delimiter[]) best[d] = Math.max(best[d], counts[d])
  }
  const ranked = (Object.entries(best) as Array<[Delimiter, number]>).sort((a, b) => b[1] - a[1])
  if (ranked[0]![1] === 0) return null
  if (ranked[1]![1] === ranked[0]![1]) return null
  return ranked[0]![0]
}

export class CsvError extends Error {}

export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    // rând complet gol (o singură celulă goală) → ignorat
    if (!(row.length === 1 && row[0]!.trim() === '')) rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        field += ch
      }
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      pushField()
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      pushRow()
    } else if (ch === '\n') {
      pushRow()
    } else {
      field += ch
    }
    i++
  }
  if (quoted) throw new CsvError('ghilimele neînchise în fișier')
  if (field !== '' || row.length > 0) pushRow()
  return rows
}
