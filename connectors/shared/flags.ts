// Flag-urile de activare ale conectorilor: SINGURUL loc din cod care le citește.
// În GitHub se setează ca Variables (Settings → Secrets and variables → Actions → Variables); workflow-urile le pasează ca
// variabile de mediu. Doar valoarea „true” (fără diferență de majuscule) activează; orice altceva = dezactivat.

export type ConnectorSource = 'seomonitor' | 'ga4' | 'gsc' | 'clarity' | 'planable' | 'meta_ads' | 'google_ads' | 'tiktok_ads'

/** ga4 și gsc împart un singur flag (B5): aceeași conexiune de service account, același workflow. */
export const CONNECTOR_FLAGS: Record<ConnectorSource, string> = {
  seomonitor: 'CONNECTOR_SEOMONITOR_ENABLED',
  ga4: 'CONNECTOR_GOOGLE_ENABLED',
  gsc: 'CONNECTOR_GOOGLE_ENABLED',
  clarity: 'CONNECTOR_CLARITY_ENABLED',
  planable: 'CONNECTOR_PLANABLE_ENABLED',
  meta_ads: 'CONNECTOR_META_ENABLED',
  google_ads: 'CONNECTOR_GOOGLE_ADS_ENABLED',
  tiktok_ads: 'CONNECTOR_TIKTOK_ENABLED',
}

export const REFRESH_FLAG = 'REFRESH_ENABLED'

export function flagEnabled(env: Record<string, string | undefined>, name: string): boolean {
  return (env[name] ?? '').trim().toLowerCase() === 'true'
}

export function connectorEnabled(env: Record<string, string | undefined>, source: ConnectorSource): boolean {
  return flagEnabled(env, CONNECTOR_FLAGS[source])
}
