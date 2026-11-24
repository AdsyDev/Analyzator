// Seturile de competitori create de agenție din datele surselor (decizia Y-17), cu cheia de serviciu, din workflow-ul manual
// `competitor-sets`. Două moduri:
//   discover: doar citește, pe fiecare brand activ, ce există deja în date: cuvintele Planable de tip „competitor” (cu
//             mențiunile din ultimele 35 de zile), profilurile Planable Competitors (cu urmăritorii) și domeniile pe care
//             SEOmonitor le vede lângă brand în răspunsurile AI. Servește la alegerea competitorilor.
//   create:   scrie o versiune a setului pentru brandurile date, cu aceleași reguli ca `create_competitor_set_version` (E4).
//             Prima versiune a unui brand poate începe în trecut (de la 2020-01-01, ca în #28); următoarele, de azi înainte.
//             Fără `apply`, doar arată ce ar scrie.
// Funcția E4 cere un utilizator autentificat cu rol de agenție; o unealtă din CI nu are unul, deci scrie direct, cu service
// role, verificând explicit clientul și brandul (regula 3). Auditul o înregistrează ca „worker”.

import { assertUuid, type Db, type Row } from '../shared/supabase-rest.ts'

export type SetsDb = Db & { delete<T extends Row>(table: string, query: string): Promise<T[]> }

export type MemberInput = { name: string; domain?: string | null; listening_keywords?: string[]; social_handles?: string[]; ads_advertiser_ids?: string[] }
export type SetInput = { effective_from: string; note?: string | null; members: MemberInput[] }
export type Member = { name: string; domain: string | null; listening_keywords: string[]; social_handles: string[]; ads_advertiser_ids: string[] }

type Brand = { id: string; tenant_id: string; slug: string; name: string; domain: string | null; status: string }

const PAGE = 1000
const MAX_ROWS = 50_000

async function selectAll<T extends Row>(db: Db, table: string, query: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const page = await db.select<T>(table, `${query}&limit=${PAGE}&offset=${offset}`)
    out.push(...page)
    if (page.length < PAGE) break
  }
  return out
}

/** Cheia unui domeniu, ca în funcția E4: fără schemă, utilizator, cale, port; litere mici. */
export function normalizeDomain(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  return v.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/^[^@]*@/, '').replace(/:[0-9]+$/, '')
}

/** Aceleași reguli ca `create_competitor_set_version`; întoarce membrii normalizați sau lista erorilor. */
export function validateSet(input: SetInput, o: { today: string; firstVersion: boolean; existingDates: string[] }): { ok: true; members: Member[] } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from ?? '')) errors.push('effective_from lipsă sau invalid (YYYY-MM-DD)')
  else if (o.firstVersion ? input.effective_from < '2020-01-01' : input.effective_from < o.today) {
    errors.push(o.firstVersion ? 'prima versiune nu poate începe înainte de 2020-01-01' : `o versiune nouă nu poate începe în trecut (azi este ${o.today})`)
  } else if (o.existingDates.includes(input.effective_from)) errors.push(`există deja o versiune cu data ${input.effective_from}`)
  if ((input.note ?? '').length > 1000) errors.push('nota are peste 1000 de caractere')
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > 10) errors.push('setul trebuie să aibă între 1 și 10 competitori')
  const names = new Set<string>()
  const words = new Set<string>()
  const handles = new Set<string>()
  const ads = new Set<string>()
  const members: Member[] = []
  for (const [i, m] of (input.members ?? []).entries()) {
    const at = `competitorul ${i + 1}`
    const name = (m.name ?? '').trim()
    if (!name || name.length > 120) errors.push(`${at}: numele are între 1 și 120 de caractere`)
    if (names.has(name.toLowerCase())) errors.push(`${at}: numele „${name}” apare de două ori`)
    names.add(name.toLowerCase())
    const domain = normalizeDomain(m.domain)
    if (domain && !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(domain)) errors.push(`${at} (${name}): domeniul „${m.domain}” nu e valid`)
    const keywords = (m.listening_keywords ?? []).map((k) => k.trim())
    if (keywords.length > 10 || keywords.some((k) => !k || k.length > 200)) errors.push(`${at} (${name}): cel mult 10 cuvinte, de 1–200 de caractere`)
    if (new Set(keywords.map((k) => k.toLowerCase())).size !== keywords.length) errors.push(`${at} (${name}): un cuvânt apare de două ori`)
    for (const w of (keywords.length ? keywords : [name]).map((k) => k.toLowerCase())) {
      if (words.has(w)) errors.push(`${at} (${name}): cuvântul „${w}” e deja al altui competitor`)
      words.add(w)
    }
    const hs = (m.social_handles ?? []).map((h) => h.trim().replace(/^@/, '').toLowerCase())
    if (hs.length > 10 || hs.some((h) => !h || h.length > 100 || /\s/.test(h))) errors.push(`${at} (${name}): cel mult 10 profiluri, de 1–100 de caractere, fără spații`)
    for (const h of hs) {
      if (handles.has(h)) errors.push(`${at} (${name}): profilul ${h} apare de două ori în set`)
      handles.add(h)
    }
    const ids = (m.ads_advertiser_ids ?? []).map((a) => a.trim().toUpperCase())
    if (ids.length > 10 || ids.some((a) => !/^AR[0-9]{5,40}$/.test(a))) errors.push(`${at} (${name}): ID-urile de advertiser au forma AR urmat de cifre, cel mult 10`)
    for (const a of ids) {
      if (ads.has(a)) errors.push(`${at} (${name}): advertiserul ${a} apare de două ori în set`)
      ads.add(a)
    }
    members.push({ name, domain, listening_keywords: keywords, social_handles: hs, ads_advertiser_ids: ids })
  }
  return errors.length ? { ok: false, errors } : { ok: true, members }
}

export type BrandCandidates = {
  brand: { id: string; slug: string; name: string; domain: string | null }
  sets: Array<{ version: number; effective_from: string; members: string[] }>
  planable_keywords: Array<{ keyword: string; mentions_35d: number; covered_to: string | null }>
  planable_profiles: Array<{ handle: string; name: string | null; followers: number | null; posts_35d: number }>
  seomonitor_domains: Array<{ domain: string; keywords: number }>
}

/** Ce există deja în date pe fiecare brand activ, pentru alegerea competitorilor. Doar citire. */
export async function discover(db: Db, today: string): Promise<BrandCandidates[]> {
  const since = new Date(`${today}T00:00:00Z`)
  since.setUTCDate(since.getUTCDate() - 35)
  const from = since.toISOString().slice(0, 10)
  const brands = (await db.select<Brand>('brands', 'select=id,tenant_id,slug,name,domain,status&status=eq.active')).sort((a, b) => a.name.localeCompare(b.name, 'ro'))
  const out: BrandCandidates[] = []
  for (const b of brands) {
    assertUuid(b.id, 'brand_id')
    assertUuid(b.tenant_id, 'tenant_id')
    const scope = `tenant_id=eq.${b.tenant_id}&brand_id=eq.${b.id}`
    const sets = await db.select<{ id: string; version: number; effective_from: string }>('competitor_sets', `select=id,version,effective_from&${scope}`)
    const members = sets.length ? await db.select<{ competitor_set_id: string; name: string; sort_order: number }>('competitor_set_members', `select=competitor_set_id,name,sort_order&${scope}`) : []
    const trackers = await db.select<{ source: string; external_id: string; label: string | null; display_name: string | null; covered_to: string | null }>(
      'competitor_trackers',
      `select=source,external_id,label,display_name,covered_to&${scope}`,
    )
    const mentions = await selectAll<{ keyword_id: string }>(db, 'competitor_mentions', `select=keyword_id&${scope}&published_at=gte.${from}T00:00:00Z&order=id.asc`)
    const perKeyword = new Map<string, number>()
    for (const m of mentions) perKeyword.set(m.keyword_id, (perKeyword.get(m.keyword_id) ?? 0) + 1)
    const social = await selectAll<{ profile_id: string; date: string; followers: number | null; posts: number | null }>(
      db,
      'competitor_social_daily',
      `select=profile_id,date,followers,posts&${scope}&is_own=eq.false&date=gte.${from}&order=id.asc`,
    )
    const observations = await selectAll<{ observed_domain: string; keyword_id: string }>(
      db,
      'ai_brand_observations',
      `select=observed_domain,keyword_id&${scope}&present=eq.true&is_own_brand=eq.false&crawl_at=gte.${from}&order=id.asc`,
    )
    const own = normalizeDomain(b.domain)?.replace(/^www\./, '') ?? null
    const byDomain = new Map<string, Set<string>>()
    for (const r of observations) {
      const d = normalizeDomain(r.observed_domain)?.replace(/^www\./, '')
      if (!d || d === own) continue
      byDomain.set(d, (byDomain.get(d) ?? new Set()).add(r.keyword_id))
    }
    out.push({
      brand: { id: b.id, slug: b.slug, name: b.name, domain: b.domain },
      sets: sets
        .sort((x, y) => x.version - y.version)
        .map((s) => ({ version: s.version, effective_from: s.effective_from, members: members.filter((m) => m.competitor_set_id === s.id).sort((x, y) => x.sort_order - y.sort_order).map((m) => m.name) })),
      planable_keywords: trackers
        .filter((t) => t.source === 'planable_listening')
        .map((t) => ({ keyword: t.label ?? t.external_id, mentions_35d: perKeyword.get(t.external_id) ?? 0, covered_to: t.covered_to }))
        .sort((x, y) => y.mentions_35d - x.mentions_35d),
      planable_profiles: trackers
        .filter((t) => t.source === 'planable_competitors')
        .map((t) => {
          const days = social.filter((s) => s.profile_id === t.external_id).sort((x, y) => y.date.localeCompare(x.date))
          return { handle: t.label ?? t.external_id, name: t.display_name, followers: days.find((d) => d.followers !== null)?.followers ?? null, posts_35d: days.reduce((n, d) => n + (d.posts ?? 0), 0) }
        })
        .sort((x, y) => (y.followers ?? -1) - (x.followers ?? -1)),
      seomonitor_domains: [...byDomain.entries()].map(([domain, k]) => ({ domain, keywords: k.size })).sort((x, y) => y.keywords - x.keywords || x.domain.localeCompare(y.domain)).slice(0, 20),
    })
  }
  return out
}

export function discoveryReport(c: BrandCandidates[]): string {
  const lines: string[] = []
  for (const b of c) {
    lines.push(`## ${b.brand.name} (${b.brand.slug}${b.brand.domain ? `, ${b.brand.domain}` : ''})`)
    lines.push(b.sets.length ? `Seturi: ${b.sets.map((s) => `v${s.version} din ${s.effective_from}: ${s.members.join(', ')}`).join(' | ')}` : 'Seturi: niciunul')
    lines.push(`Planable Listening, cuvinte de tip „competitor” (mențiuni în 35 de zile): ${b.planable_keywords.length ? b.planable_keywords.map((k) => `${k.keyword} (${k.mentions_35d})`).join(', ') : 'niciunul colectat'}`)
    lines.push(`Planable Competitors, profiluri (urmăritori, postări în 35 de zile): ${b.planable_profiles.length ? b.planable_profiles.map((p) => `${p.name ?? p.handle} @${p.handle} (${p.followers ?? '?'}, ${p.posts_35d})`).join(', ') : 'niciunul colectat'}`)
    lines.push(`SEOmonitor, domenii prezente în răspunsurile AI (cuvinte cheie distincte, 35 de zile): ${b.seomonitor_domains.length ? b.seomonitor_domains.map((d) => `${d.domain} (${d.keywords})`).join(', ') : 'niciunul'}`)
    lines.push('')
  }
  return lines.join('\n')
}

export type CreateOutcome = { brand: string; status: 'created' | 'dry_run' | 'invalid' | 'not_found'; version?: number; effective_from?: string; members?: Member[]; errors?: string[] }

/** Brandul după ID sau după slug (unic între clienți; altfel se cere ID-ul). */
async function findBrand(db: Db, key: string): Promise<Brand | 'ambiguous' | null> {
  const byId = /^[0-9a-f-]{36}$/.test(key)
  if (!byId && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(key)) return null
  const rows = await db.select<Brand>('brands', `select=id,tenant_id,slug,name,domain,status&${byId ? 'id' : 'slug'}=eq.${key}&status=eq.active`)
  if (rows.length > 1) return 'ambiguous'
  return rows[0] ?? null
}

/**
 * Scrie versiunile cerute. Setul și membrii în două cereri; dacă membrii nu se pot scrie, setul abia creat se șterge, ca să
 * nu rămână un set fără competitori (motivul pentru care funcția E4 e atomică).
 */
export async function createSets(db: SetsDb, input: Record<string, SetInput>, o: { today: string; apply: boolean }): Promise<CreateOutcome[]> {
  const out: CreateOutcome[] = []
  for (const [key, set] of Object.entries(input)) {
    const b = await findBrand(db, key)
    if (b === null || b === 'ambiguous') {
      out.push({ brand: key, status: 'not_found', errors: [b === 'ambiguous' ? 'slug folosit la mai mulți clienți: folosește ID-ul brandului' : 'brand activ inexistent'] })
      continue
    }
    assertUuid(b.id, 'brand_id')
    assertUuid(b.tenant_id, 'tenant_id')
    const scope = `tenant_id=eq.${b.tenant_id}&brand_id=eq.${b.id}`
    const existing = await db.select<{ version: number; effective_from: string }>('competitor_sets', `select=version,effective_from&${scope}`)
    const v = validateSet(set, { today: o.today, firstVersion: existing.length === 0, existingDates: existing.map((e) => e.effective_from) })
    if (!v.ok) {
      out.push({ brand: b.name, status: 'invalid', errors: v.errors })
      continue
    }
    const version = existing.reduce((m, e) => Math.max(m, e.version), 0) + 1
    if (!o.apply) {
      out.push({ brand: b.name, status: 'dry_run', version, effective_from: set.effective_from, members: v.members })
      continue
    }
    const created = await db.insert<{ id: string; tenant_id: string; brand_id: string }>('competitor_sets', {
      tenant_id: b.tenant_id, brand_id: b.id, version, effective_from: set.effective_from, note: (set.note ?? '').trim() || null, created_by: null,
    })
    const row = created[0]
    if (!row || row.tenant_id !== b.tenant_id || row.brand_id !== b.id) throw new Error(`${b.name}: setul întors nu aparține brandului; opresc.`)
    assertUuid(row.id, 'competitor_set_id')
    try {
      const rows = v.members.map((m, i) => ({ tenant_id: b.tenant_id, brand_id: b.id, competitor_set_id: row.id, sort_order: i, ...m }))
      const written = await db.upsert<{ tenant_id: string; brand_id: string }>('competitor_set_members', rows, ['tenant_id', 'brand_id', 'competitor_set_id', 'name'])
      if (written.length !== rows.length || written.some((w) => w.tenant_id !== b.tenant_id || w.brand_id !== b.id)) throw new Error('membrii întorși nu corespund setului')
    } catch (err) {
      await db.delete('competitor_set_members', `${scope}&competitor_set_id=eq.${row.id}`)
      await db.delete('competitor_sets', `${scope}&id=eq.${row.id}`)
      throw new Error(`${b.name}: membrii nu s-au putut scrie, setul a fost anulat (${(err as Error).message})`)
    }
    out.push({ brand: b.name, status: 'created', version, effective_from: set.effective_from, members: v.members })
  }
  return out
}
