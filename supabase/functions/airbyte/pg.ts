// Adaptorul Deno pentru destinația Postgres Airbyte (E-6), cu postgres.js. Doar în funcția server.
//
// Sesiunea e read-only din pachetul de pornire (default_transaction_read_only=on), cu timeout pe fiecare
// interogare, și se verifică înainte de orice citire. Conexiunea merge la IP-ul verificat de handler (nu se mai
// rezolvă numele a doua oară); numele serverului servește la TLS, verificat mereu (în edge runtime,
// `rejectUnauthorized: false` e ignorat, iar certificatele pe IP nu trec; verificat pe 26 oct. 2026). Erorile ies
// clasificate, fără mesajul serverului (poate conține numele utilizatorului sau al bazei).

import postgres from 'npm:postgres@3.4.5'
import { classifyPgError, PgError, type PgSession, type PgTarget } from './inspect.ts'

export const STATEMENT_TIMEOUT_MS = 8000

/** Deschide sesiunea, verifică read-only, rulează `run`, închide conexiunea orice ar fi. */
export async function withReadOnlySession<T>(t: PgTarget, run: (s: PgSession) => Promise<T>): Promise<T> {
  const tls = { rejectUnauthorized: true, servername: t.servername, ...(t.ca ? { ca: t.ca } : {}) }
  const sql = postgres({
    host: t.ip,
    port: t.port,
    user: t.user,
    password: t.password,
    database: t.database,
    ssl: tls,
    max: 1,
    prepare: false,
    fetch_types: false,
    connect_timeout: 10,
    idle_timeout: 5,
    max_lifetime: 120,
    onnotice: () => {},
    connection: {
      application_name: 'analyzator-inspect',
      default_transaction_read_only: 'on',
      statement_timeout: String(STATEMENT_TIMEOUT_MS),
      lock_timeout: '2000',
      idle_in_transaction_session_timeout: '10000',
    },
  })
  const session: PgSession = {
    async query(text, params = []) {
      try {
        return (await sql.unsafe(text, params)) as never[]
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
