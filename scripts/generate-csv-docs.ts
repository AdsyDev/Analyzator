// Generează docs/contracts/csv-*.md și docs/templates/csv/*.csv din contractele de import.
//   npm run docs:csv            scrie fișierele
//   npm run docs:csv -- --check verifică faptul că sunt la zi (cod de ieșire 1 altfel)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { allGenerated } from '../supabase/functions/_shared/csv-import/docs.ts'

const root = join(import.meta.dirname, '..')
const check = process.argv.includes('--check')
let stale = 0
for (const { path, content } of allGenerated()) {
  const full = join(root, path)
  const current = existsSync(full) ? readFileSync(full, 'utf8') : null
  if (check) {
    if (current !== content) {
      console.error(`depășit: ${path}`)
      stale++
    }
    continue
  }
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  console.log(`scris: ${path}`)
}
if (check && stale) process.exitCode = 1
