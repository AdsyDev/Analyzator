// Intrarea Deno pentru Edge Function. Logica e în handler.ts. verify_jwt = false (supabase/config.toml): întoarcerea
// de la furnizor nu are JWT; pornirea conectării verifică singură sesiunea utilizatorului.
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

const googleId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
const googleSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')
const tiktokId = Deno.env.get('TIKTOK_APP_ID')
const tiktokSecret = Deno.env.get('TIKTOK_APP_SECRET')

const env = {
  supabaseUrl: required('SUPABASE_URL'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  anonKey: required('SUPABASE_ANON_KEY'),
  allowedOrigin: Deno.env.get('ANALYZATOR_APP_ORIGIN'),
  appBaseUrl: required('APP_BASE_URL'),
  redirectBase: Deno.env.get('OAUTH_REDIRECT_BASE'),
  google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : undefined,
  tiktok: tiktokId && tiktokSecret ? { appId: tiktokId, secret: tiktokSecret } : undefined,
}

Deno.serve((req) => handle(req, { env, fetch, now: () => new Date() }))
