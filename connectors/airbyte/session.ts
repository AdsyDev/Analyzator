// Adaptorul Node pentru destinația Postgres Airbyte (colectorul, E-6 etapa 2), cu postgres.js. Aceleași reguli ca în
// funcția server (supabase/functions/airbyte/pg.ts): sesiune read-only din pachetul de pornire, verificată înainte de
// orice citire; conexiunea merge la IP-ul verificat, iar certificatul se verifică pe numele serverului; erorile ies
// clasificate, fără mesajul serverului. Timeout-ul pe interogare e mai mare decât la inspecție: colectarea citește
// rânduri, nu doar agregate.

import { resolve4, resolve6 } from 'node:dns/promises'
import { checkServerIdentity } from 'node:tls'
import postgres from 'postgres'
import { classifyPgError, PgError, type PgSession, type PgTarget } from '../../supabase/functions/airbyte/inspect.ts'

export const COLLECT_STATEMENT_TIMEOUT_MS = 120_000

/** A și AAAA; un tip fără înregistrări dă `[]`, orice altă eroare de DNS se propagă. */
export async function resolveHost(host: string): Promise<string[]> {
  const out: string[] = []
  for (const lookup of [resolve4, resolve6]) {
    try {
      out.push(...(await lookup(host)))
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'ENODATA' && code !== 'ENOTFOUND') throw err
    }
  }
  return out
}

export async function withReadOnlySession<T>(t: PgTarget, run: (s: PgSession) => Promise<T>): Promise<T> {
  const sql = postgres({
    host: t.ip,
    port: t.port,
    user: t.user,
    password: t.password,
    database: t.database,
    ssl: {
      rejectUnauthorized: true,
      servername: t.servername,
      // Verificarea pe nume, explicit: conexiunea e pe IP, certificatul e pe numele din connection string.
      checkServerIdentity: (_host: string, cert: Parameters<typeof checkServerIdentity>[1]) => checkServerIdentity(t.servername, cert),
      ...(t.ca ? { ca: t.ca } : {}),
    },
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 15,
    idle_timeout: 10,
    max_lifetime: 900,
    onnotice: () => {},
    connection: {
      application_name: 'analyzator-collect',
      default_transaction_read_only: true,
      statement_timeout: COLLECT_STATEMENT_TIMEOUT_MS,
      lock_timeout: 2000,
      idle_in_transaction_session_timeout: 10000,
    },
  })
  const session: PgSession = {
    async query(text, params = []) {
      try {
        return (await sql.unsafe(text, params as never[])) as never[]
      } catch (e) {
        throw classifyPgError(e)
      }
    },
  }
  try {
    const ro = await session.query<{ transaction_read_only: string }>('show transaction_read_only')
    if (ro[0]?.transaction_read_only !== 'on') throw new PgError('not_read_only', null)
    return await run(session)
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}
