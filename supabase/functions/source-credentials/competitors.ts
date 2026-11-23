// Propuneri pentru setul de competitori (Configurare → Competitori, cererea din 23 nov. 2026).
// Independent de runtime: doar fetch (Deno și Node). Tokenul nu iese de aici: rezultatul are doar profilurile
// publice urmărite în Planable (rețea, handle, nume afișat) și numele paginii brandului la care sunt urmărite.
//
// Planable: `GET /pages?workspaceId=` → paginile brandului, apoi `GET /pages/{id}/competitors` pe fiecare pagină
// de pe o rețea care are analiza competitorilor (Instagram, Facebook, YouTube, TikTok, LinkedIn). Specificația
// OpenAPI publică, citită pe 23 nov. 2026; rutele nu au rulat încă pe date reale.

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export const PLANABLE_API = 'https://api.planable.io/api/v1'
/** Rețelele pe care Planable urmărește competitori (documentat pe fiecare rută `/competitors`). */
export const COMPETITOR_PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin'] as const
/** Plafoane de siguranță: o propunere nu cere mai mult de atâtea pagini de listă și pagini de brand. */
const MAX_LIST_PAGES = 5
const LIST_PAGE_SIZE = 50
const MAX_BRAND_PAGES = 20

export type PlanableCompetitor = {
  platform: string
  handle: string
  name: string
  /** Paginile brandului (din Planable) la care e urmărit profilul. */
  tracked_from: string[]
}

export type PlanableCompetitorsOutcome =
  | { ok: true; competitors: PlanableCompetitor[]; pages_checked: number; notes: string[]; requests: number }
  | { ok: false; reason: 'invalid' | 'rate_limited' | 'provider_error'; status: number | null; message: string; requests: number }

const RENEW = 'Creează un token nou (scope Read) din Company settings → API tokens.'

export async function planableCompetitors(token: string, workspaceId: string, fetch: Fetch): Promise<PlanableCompetitorsOutcome> {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  let requests = 0
  const get = async (path: string): Promise<Response | null> => {
    requests++
    try {
      return await fetch(`${PLANABLE_API}${path}`, { headers })
    } catch {
      return null
    }
  }
  const stop = (res: Response | null): PlanableCompetitorsOutcome | null => {
    if (!res) return { ok: false, reason: 'provider_error', status: null, message: 'Planable nu a răspuns (eroare de rețea). Reîncearcă.', requests }
    if (res.status === 401) return { ok: false, reason: 'invalid', status: 401, message: `Planable a refuzat tokenul (401). ${RENEW}`, requests }
    if (res.status === 429) return { ok: false, reason: 'rate_limited', status: 429, message: 'Planable a limitat cererile (429). Reîncearcă peste un minut.', requests }
    return null
  }

  // 1. Paginile workspace-ului brandului.
  const pages: Array<{ id: string; name: string; platform: string }> = []
  for (let p = 0; p < MAX_LIST_PAGES; p++) {
    const res = await get(`/pages?workspaceId=${encodeURIComponent(workspaceId)}&offset=${p * LIST_PAGE_SIZE}&limit=${LIST_PAGE_SIZE}`)
    const s = stop(res)
    if (s) return s
    if (res!.status === 403 || res!.status === 404) {
      await res!.body?.cancel()
      return { ok: false, reason: 'provider_error', status: res!.status, message: `Tokenul Planable nu are acces la workspace-ul brandului (${res!.status}). Verifică workspace-ul din pagina site-ului.`, requests }
    }
    if (!res!.ok) {
      await res!.body?.cancel()
      return { ok: false, reason: 'provider_error', status: res!.status, message: `Planable nu a răspuns corect (${res!.status}). Reîncearcă mai târziu.`, requests }
    }
    const body = (await res!.json().catch(() => null)) as { data?: unknown; pagination?: { hasMore?: unknown } } | null
    if (!body || !Array.isArray(body.data)) return { ok: false, reason: 'provider_error', status: res!.status, message: 'Forma răspunsului Planable /pages s-a schimbat.', requests }
    for (const raw of body.data as Array<Record<string, unknown>>) {
      if (typeof raw.id !== 'string') continue
      const platform = typeof raw.platform === 'string' ? raw.platform.toLowerCase() : typeof raw.pageType === 'string' ? raw.pageType.toLowerCase() : ''
      pages.push({ id: raw.id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id, platform })
    }
    if (body.pagination?.hasMore !== true || body.data.length === 0) break
  }

  // 2. Competitorii urmăriți pe fiecare pagină cu analiza competitorilor.
  const eligible = pages.filter((p) => (COMPETITOR_PLATFORMS as readonly string[]).includes(p.platform))
  const notes: string[] = []
  if (eligible.length > MAX_BRAND_PAGES) notes.push(`Am verificat primele ${MAX_BRAND_PAGES} din ${eligible.length} pagini ale brandului.`)
  const byKey = new Map<string, PlanableCompetitor>()
  let checked = 0
  for (const page of eligible.slice(0, MAX_BRAND_PAGES)) {
    const res = await get(`/pages/${encodeURIComponent(page.id)}/competitors`)
    const s = stop(res)
    if (s) return s
    if (res!.status === 400) {
      // Rețeaua paginii nu are analiza competitorilor: nu e o eroare.
      await res!.body?.cancel()
      continue
    }
    if (res!.status === 403) {
      await res!.body?.cancel()
      notes.push(`${page.name} (${page.platform}): tokenul nu are acces la pagină sau add-on-ul Analytics e inactiv.`)
      continue
    }
    if (!res!.ok) {
      await res!.body?.cancel()
      notes.push(`${page.name} (${page.platform}): Planable a răspuns ${res!.status}.`)
      continue
    }
    const body = (await res!.json().catch(() => null)) as { data?: unknown } | null
    if (!body || !Array.isArray(body.data)) {
      notes.push(`${page.name} (${page.platform}): forma răspunsului s-a schimbat.`)
      continue
    }
    checked++
    for (const raw of body.data as Array<Record<string, unknown>>) {
      const handle = typeof raw.handle === 'string' ? raw.handle.trim() : ''
      if (!handle) continue
      const platform = typeof raw.platform === 'string' && raw.platform.trim() ? raw.platform.trim().toLowerCase() : page.platform
      const name = typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : handle
      const key = `${platform}:${handle.toLowerCase()}`
      const cur = byKey.get(key)
      if (cur) {
        if (!cur.tracked_from.includes(page.name)) cur.tracked_from.push(page.name)
      } else {
        byKey.set(key, { platform, handle, name: name.slice(0, 120), tracked_from: [page.name] })
      }
    }
  }
  const competitors = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'ro') || a.platform.localeCompare(b.platform))
  return { ok: true, competitors, pages_checked: checked, notes, requests }
}

export type SeomonitorDomain = { domain: string; keywords: number }

/**
 * Domeniile pe care SEOmonitor le raportează drept concurenți în răspunsurile AI ale brandului, cu numărul de
 * cuvinte cheie distincte în care apar. Domeniul brandului nu se propune.
 */
export function rankDomains(rows: Array<{ observed_domain: string; keyword_id: string }>, ownDomain: string | null, limit = 20): SeomonitorDomain[] {
  const own = ownDomain?.toLowerCase().replace(/^www\./, '') ?? null
  const byDomain = new Map<string, Set<string>>()
  for (const r of rows) {
    const d = r.observed_domain?.toLowerCase().trim()
    if (!d || d.replace(/^www\./, '') === own) continue
    const set = byDomain.get(d) ?? new Set<string>()
    set.add(r.keyword_id)
    byDomain.set(d, set)
  }
  return [...byDomain.entries()]
    .map(([domain, k]) => ({ domain, keywords: k.size }))
    .sort((a, b) => b.keywords - a.keywords || a.domain.localeCompare(b.domain))
    .slice(0, limit)
}
