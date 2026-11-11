/** Un fragment de document: textul și secțiunea din care vine. */
export interface TextFragment {
  section_ref: string | null
  content: string
}

/** Ținta unui fragment și limita lui; baza acceptă cel mult 4.000 de caractere pe fragment și 400 de fragmente pe document. */
const TARGET = 1200
const MAX = 1500
export const MAX_FRAGMENTS = 400

/** Taie un paragraf prea lung la sfârșit de propoziție, sau, dacă nu are, la spațiu. */
function cut(paragraph: string): string[] {
  const out: string[] = []
  let rest = paragraph
  while (rest.length > MAX) {
    const window = rest.slice(0, MAX)
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('; '))
    const space = window.lastIndexOf(' ')
    const at = sentence > MAX / 3 ? sentence + 1 : space > MAX / 3 ? space : MAX
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Împarte textul unui document în fragmente, pentru căutare. Un rând care începe cu „#” e titlul secțiunii pentru ce
 * urmează; paragrafele (despărțite de un rând gol) se grupează până la circa 1.200 de caractere, fără să treacă dintr-o
 * secțiune în alta. Textul nu se rescrie: fragmentele, puse cap la cap, dau documentul.
 */
export function splitIntoFragments(text: string): TextFragment[] {
  const fragments: TextFragment[] = []
  let section: string | null = null
  let buffer = ''
  const flush = () => {
    if (buffer.trim()) fragments.push({ section_ref: section, content: buffer.trim() })
    buffer = ''
  }
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l !== '')
    const body: string[] = []
    for (const line of lines) {
      const heading = /^#{1,6}\s*(.+)$/.exec(line)
      if (heading) {
        // Ce s-a strâns până aici ține de secțiunea anterioară.
        if (body.length) {
          buffer = buffer ? `${buffer}\n\n${body.join('\n')}` : body.join('\n')
          body.length = 0
        }
        flush()
        section = heading[1]!.trim().slice(0, 200) || null
      } else body.push(line)
    }
    if (body.length === 0) continue
    for (const piece of cut(body.join('\n'))) {
      if (buffer && buffer.length + piece.length + 2 > TARGET) flush()
      buffer = buffer ? `${buffer}\n\n${piece}` : piece
      if (buffer.length >= TARGET) flush()
    }
  }
  flush()
  return fragments
}
