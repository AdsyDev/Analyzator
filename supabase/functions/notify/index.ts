// Intrarea Deno pentru Edge Function. Logica e în handler.ts.
import { handle } from './handler.ts'

declare const Deno: {
  env: { get(name: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
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
  RESEND_API_KEY: Deno.env.get('RESEND_API_KEY'),
  PV_FROM_EMAIL: Deno.env.get('PV_FROM_EMAIL'),
  APP_BASE_URL: Deno.env.get('APP_BASE_URL'),
}

Deno.serve((req) => handle(req, { env, fetch, now: () => new Date() }))
