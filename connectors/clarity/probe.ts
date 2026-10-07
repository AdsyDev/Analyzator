// Probă de payload Clarity (ziua 0). Salvează răspunsurile brute ca fixtures; nu scrie în baza de date.
//
// Rulare: npm run probe:clarity
// CLARITY_PROJECTS='[{"brand_slug":"brand-a","token":"…"}]' (în .env.local, niciodată în repo)
//
// Buget Clarity: 10 apeluri/zi per proiect. Scriptul face EXACT 2 apeluri per proiect, fără retry,
// și refuză să ruleze dacă fixtures există deja (folosește --force pentru a le suprascrie).

import { mkdir, writeFile, access } from 'node:fs/promises'
import { join } from 'node:path'

const ENDPOINT = 'https://www.clarity.ms/export-data/api/v1/project-live-insights'
const OUT_DIR = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'clarity')

type Project = { brand_slug: string; token: string }

type Probe = { suffix: 'totals' | 'device'; query: string }

const PROBES: Probe[] = [
  { suffix: 'totals', query: 'numOfDays=1' },
  { suffix: 'device', query: 'numOfDays=1&dimension1=Device' },
]

function parseProjects(raw: string | undefined): Project[] {
  if (!raw) throw new Error('Lipsește CLARITY_PROJECTS (JSON: [{"brand_slug":"…","token":"…"}]).')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('CLARITY_PROJECTS nu este JSON valid.')
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CLARITY_PROJECTS trebuie să fie o listă nevidă.')
  }
  const slugs = new Set<string>()
  return parsed.map((item, i) => {
    const p = item as Partial<Project>
    if (typeof p.brand_slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.brand_slug)) {
      throw new Error(`Proiectul #${i}: brand_slug lipsă sau invalid (doar a-z, 0-9, cratimă).`)
    }
    if (typeof p.token !== 'string' || p.token.trim() === '') {
      throw new Error(`Proiectul ${p.brand_slug}: token lipsă.`)
    }
    if (slugs.has(p.brand_slug)) throw new Error(`brand_slug duplicat: ${p.brand_slug}`)
    slugs.add(p.brand_slug)
    return { brand_slug: p.brand_slug, token: p.token.trim() }
  })
}

function describeStatus(status: number, retryAfter: string | null): string {
  if (status >= 200 && status < 300) return 'OK'
  if (status === 401) return 'Token invalid sau expirat (401). Generează un token nou în Clarity: Settings → Data Export.'
  if (status === 403) {
    return 'Acces refuzat (403). Tokenul e invalid, nu aparține acestui proiect sau exportul nu e activat. ' +
      '(Clarity răspunde 403, nu 401, și pentru un token inexistent.)'
  }
  if (status === 429) {
    return `Limită de apeluri atinsă (429): bugetul zilnic de 10 apeluri e consumat.${
      retryAfter ? ` Retry-After: ${retryAfter}.` : ''
    } Nu reîncerca azi.`
  }
  if (status >= 500) return `Eroare la Clarity (${status}). Problemă temporară a serviciului; reîncearcă mai târziu, cu grijă la buget.`
  return `Răspuns neașteptat (${status}).`
}

function summarize(body: unknown): string[] {
  if (!Array.isArray(body)) {
    return [`  Forma răspunsului nu e listă: ${typeof body}${body && typeof body === 'object' ? ` (chei: ${Object.keys(body).join(', ')})` : ''}`]
  }
  return body.map((block) => {
    const b = (block ?? {}) as { metricName?: unknown; information?: unknown }
    const extraKeys = Object.keys(b).filter((k) => k !== 'metricName' && k !== 'information')
    const info = Array.isArray(b.information) ? b.information : []
    const fields = new Set<string>()
    for (const row of info) {
      if (row && typeof row === 'object') for (const k of Object.keys(row)) fields.add(k)
    }
    return (
      `  • ${String(b.metricName)} — ${info.length} rânduri; câmpuri: ${[...fields].join(', ') || '(niciunul)'}` +
      (extraKeys.length ? `; alte chei pe bloc: ${extraKeys.join(', ')}` : '')
    )
  })
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')
  const projects = parseProjects(process.env.CLARITY_PROJECTS)
  await mkdir(OUT_DIR, { recursive: true })

  if (!force) {
    for (const project of projects) {
      for (const probe of PROBES) {
        const file = join(OUT_DIR, `${project.brand_slug}-${probe.suffix}.json`)
        if (await exists(file)) {
          throw new Error(`Există deja ${file}. Nu consum bugetul din nou; folosește --force dacă vrei să suprascrii.`)
        }
      }
    }
  }

  let failures = 0
  for (const project of projects) {
    console.log(`\n=== ${project.brand_slug} ===`)
    for (const probe of PROBES) {
      const url = `${ENDPOINT}?${probe.query}`
      let res: Response
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${project.token}` } })
      } catch (err) {
        failures++
        console.log(`[${probe.suffix}] eroare de rețea: ${(err as Error).message}`)
        continue
      }
      const text = await res.text()
      console.log(`[${probe.suffix}] HTTP ${res.status}: ${describeStatus(res.status, res.headers.get('retry-after'))}`)

      if (!res.ok) {
        failures++
        if (text) console.log(`  corp: ${text.slice(0, 300)}`)
        continue
      }

      // Brut, fără transformare.
      const file = join(OUT_DIR, `${project.brand_slug}-${probe.suffix}.json`)
      await writeFile(file, text)
      console.log(`  salvat: ${file}`)

      try {
        for (const line of summarize(JSON.parse(text))) console.log(line)
      } catch {
        console.log('  Răspunsul nu este JSON valid (salvat oricum, brut).')
      }
    }
  }

  console.log(`\nApeluri efectuate: ${projects.length * PROBES.length}. Eșecuri: ${failures}.`)
  if (failures > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
