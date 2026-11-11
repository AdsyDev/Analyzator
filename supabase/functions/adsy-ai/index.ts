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
  // Opționale: fără ele funcția răspunde „neconfigurat” și nu cheamă niciun model.
  geminiApiKey: Deno.env.get('GEMINI_API_KEY'),
  modelId: Deno.env.get('ADSY_AI_MODEL'),
}

Deno.serve((req) => handle(req, { env, fetch }))
