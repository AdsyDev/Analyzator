// Intrarea Deno pentru Edge Function. Logica e în handler.ts; conexiunea Postgres în pg.ts.
import { handle } from './handler.ts'
import { withReadOnlySession } from './pg.ts'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
  resolveDns(query: string, recordType: 'A' | 'AAAA'): Promise<string[]>
  errors: { NotFound: new (...args: unknown[]) => Error }
}

function required(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Lipsește ${name}`)
  return value
}

const env = {
  supabaseUrl: required('SUPABASE_URL'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  anonKey: required('SUPABASE_ANON_KEY'),
  allowedOrigin: Deno.env.get('ANALYZATOR_APP_ORIGIN'),
}

/** A și AAAA; un tip fără înregistrări dă `[]`, orice altă eroare de DNS se propagă. */
async function resolve(host: string): Promise<string[]> {
  const out: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    try {
      out.push(...(await Deno.resolveDns(host, type)))
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err
    }
  }
  return out
}

Deno.serve((req) => handle(req, { env, fetch, now: () => new Date(), resolve, connect: withReadOnlySession }))
