// Setează (sau rotește) tokenul unei surse prin Edge Function source-credentials, ca agency_admin.
// Folosit până există ecranul Administrare → Surse.
//
//   npm run set-source-token -- --connection <uuid> --email admin@agentie.ro [--validate]
//
// Parola și tokenul se citesc din stdin, fără ecou (interactiv) sau ca două linii (pipe):
//   printf '%s\n%s\n' "$PAROLA" "$TOKEN" | npm run set-source-token -- --connection … --email …
// Nu se acceptă ca argumente, ca să nu rămână în istoricul shell-ului.
//
// Mediu: SUPABASE_URL și SUPABASE_ANON_KEY (cheia publică) — din .env.local sau din mediu.
// --validate face și un apel de test, care consumă 1 din cele 10 apeluri zilnice Clarity.

import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message: string): never {
  console.error(`Eroare: ${message}`)
  process.exit(1)
}

async function readSecrets(labels: string[]): Promise<string[]> {
  if (!process.stdin.isTTY) {
    const lines: string[] = []
    const rl = createInterface({ input: process.stdin, terminal: false })
    for await (const line of rl) {
      lines.push(line)
      if (lines.length === labels.length) break
    }
    rl.close()
    if (lines.length < labels.length) fail(`Aștept ${labels.length} linii pe stdin: ${labels.join(', ')}.`)
    return lines
  }

  const values: string[] = []
  for (const label of labels) {
    let muted = false
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk)
        cb()
      },
    })
    const rl = createInterface({ input: process.stdin, output, terminal: true })
    const value = await new Promise<string>((resolve) => {
      rl.question(`${label}: `, (answer) => resolve(answer))
      muted = true
    })
    rl.close()
    process.stdout.write('\n')
    values.push(value)
  }
  return values
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      connection: { type: 'string' },
      email: { type: 'string' },
      validate: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const connectionId = args.connection ?? fail('Lipsește --connection <uuid>.')
  const email = args.email ?? fail('Lipsește --email.')
  if (!UUID.test(connectionId)) fail('--connection nu e un UUID.')

  const url = (process.env.SUPABASE_URL ?? fail('Lipsește SUPABASE_URL.')).replace(/\/+$/, '')
  const anonKey = process.env.SUPABASE_ANON_KEY ?? fail('Lipsește SUPABASE_ANON_KEY (cheia publică).')

  const [password, token] = await readSecrets(['Parola contului', 'Tokenul sursei'])
  if (!password) fail('Parolă goală.')
  if (!token?.trim()) fail('Token gol.')

  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!login.ok) fail(`Autentificare eșuată (${login.status}).`)
  const { access_token: accessToken } = (await login.json()) as { access_token?: string }
  if (!accessToken) fail('Autentificare fără access_token.')

  const callFunction = async (body: Record<string, unknown>) => {
    const res = await fetch(`${url}/functions/v1/source-credentials`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) fail(`${String(body.action)}: ${res.status} ${String(data.error ?? '')}`)
    return data
  }

  const set = await callFunction({ action: 'set_token', connection_id: connectionId, token })
  console.log(`Token salvat în Vault. Stare: ${String(set.credential_status)}. Acțiunea e în audit_events.`)

  if (args.validate) {
    const v = await callFunction({ action: 'validate', connection_id: connectionId })
    console.log(`Validare: ${String(v.outcome)}. ${String(v.message)}`)
    console.log(`Apeluri azi (UTC): ${String(v.calls_today)}/${String(v.daily_limit)}.`)
  } else {
    console.log('Nevalidat. Pentru test, rulează cu --validate (consumă 1 din cele 10 apeluri zilnice).')
  }
}

main().catch((err: unknown) => fail((err as Error).message))
