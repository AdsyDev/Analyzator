// Flag-urile de activare ale conectorilor: SINGURUL loc din cod care le citește.
// În GitHub se setează ca Variables (Settings → Secrets and variables → Actions → Variables); workflow-urile le pasează ca
// variabile de mediu. Doar valoarea „true” (fără diferență de majuscule) activează; orice altceva = dezactivat.

export type ConnectorSource = 'seomonitor' | 'ga4' | 'gsc' | 'clarity'

/** ga4 și gsc împart un singur flag (B5): aceeași conexiune de service account, același workflow. */
export const CONNECTOR_FLAGS: Record<ConnectorSource, string> = {
  seomonitor: 'CONNECTOR_SEOMONITOR_ENABLED',
  ga4: 'CONNECTOR_GOOGLE_ENABLED',
  gsc: 'CONNECTOR_GOOGLE_ENABLED',
  clarity: 'CONNECTOR_CLARITY_ENABLED',
}

export const REFRESH_FLAG = 'REFRESH_ENABLED'

export function flagEnabled(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name] ?? '').trim().toLowerCase() === 'true'
}

export function connectorEnabled(env: Record<string, string | undefined>, source: ConnectorSource): boolean {
  return flagEnabled(env, CONNECTOR_FLAGS[source])
}
