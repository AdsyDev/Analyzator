// Conectorul zilnic Clarity. Rulare: npm run collect:clarity
//
// STATUS: parserul și scrierea în clarity_daily nu sunt implementate (așteaptă proba și migrația din
// Promptul 4). Până atunci scriptul se oprește ÎNAINTE de orice apel la Clarity, ca să nu consume bugetul.

import { resolveBrands } from '../shared/resolve.ts'
import { SupabaseRest, supabaseConfigFromEnv } from '../shared/supabase-rest.ts'
import { parseClarityProjects } from './config.ts'
import { collectProject, type ClarityParser, type ClarityWriter } from './collect-core.ts'

// Se înlocuiesc după probă cu implementările reale (interfețele din collect-core.ts).
const parser: ClarityParser<never> | null = null
const writer: ClarityWriter<never> | null = null

async function main(): Promise<void> {
  if (!parser || !writer) {
    throw new Error('Parserul și scrierea în clarity_daily nu sunt implementate încă (după probă). Nu apelez Clarity.')
  }
  const projects = parseClarityProjects(process.env.CLARITY_PROJECTS)
  const db = new SupabaseRest(supabaseConfigFromEnv(process.env))
  const resolved = await resolveBrands(db, projects)

  let failed = 0
  for (const project of resolved) {
    const outcome = await collectProject({ db, parser, writer }, project)
    console.log(
      `${project.tenant_slug}/${project.brand_slug} ${outcome.date}: ${outcome.status}, ` +
        `${outcome.rows_written} rânduri, ${outcome.attempt_count} apeluri` +
        (outcome.not_collected.length ? `, necolectat: ${outcome.not_collected.join(', ')}` : ''),
    )
    if (outcome.status === 'failed') failed++
  }
  if (failed) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error(`Eroare: ${(err as Error).message}`)
  process.exitCode = 1
})
