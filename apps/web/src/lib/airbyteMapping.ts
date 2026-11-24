// Maparea conturilor Airbyte pe site-urile clientului (E-8): propunere după nume și domeniu, confirmată de om.
// Doar o clasificare pentru formular, nu o metrică; nimic nu se leagă fără confirmarea din ecran.

// Fără importuri: aceeași logică rulează și în worker (connectors/airbyte/map-core.ts), nu doar în aplicație.

/** Contul văzut de inspecție (forma din `AirbyteAccount`, doar câmpurile folosite). */
type AirbyteAccount = { id: string; name: string; platform: string }
/** Site-ul clientului (forma din `ClientSpace`, doar câmpurile folosite). */
type ClientSpace = { id: string; name: string; domain: string | null; status: string }

/** Cuvinte care nu deosebesc un site de altul (țară, monedă, platformă, formă juridică). */
const GENERIC = new Set([
  'ro', 'romania', 'eur', 'ron', 'usd', 'ads', 'account', 'accounts', 'cont', 'srl', 'meta', 'google', 'tiktok', 'facebook',
  'instagram', 'search', 'display', 'pmax', 'brand', 'site', 'www', 'com', 'net', 'org', 'new', 'old', 'the', 'and', 'campaign',
  'campaigns', 'agency', 'adsymphony', 'adsy', 'official', 'shop', 'store', 'online',
])

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const compact = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '')
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w) && !/^\d+$/.test(w))

/** Numele domeniului fără www și fără TLD: `https://www.proenzi.ro/x` → `proenzi`. */
function domainLabel(domain: string | null): string[] {
  if (!domain) return []
  const host = fold(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')
  const parts = host.split('.').filter(Boolean)
  return parts.length > 1 ? words(parts.slice(0, -1).join(' ')) : []
}

/** Cuvintele care identifică site-ul, fără cele din numele clientului (de ex. „STADA”, comun tuturor site-urilor). */
export function siteKeys(space: Pick<ClientSpace, 'name' | 'domain'>, clientName: string): string[] {
  const common = new Set(words(clientName))
  return [...new Set([...words(space.name), ...domainLabel(space.domain)])].filter((k) => !common.has(k))
}

/** Scorul potrivirii: suma lungimilor cuvintelor site-ului găsite în numele contului (cel mai specific câștigă). */
function score(accountName: string, keys: string[]): number {
  const text = compact(accountName)
  const own = new Set(words(accountName))
  return keys.reduce((sum, k) => sum + (own.has(k) || (k.length >= 4 && text.includes(k)) ? k.length : 0), 0)
}

export type MappingRow<A extends AirbyteAccount = AirbyteAccount> = {
  account: A
  /** Site-ul propus (potrivire unică); `null` = fără potrivire sau ambiguu. */
  proposed: string | null
  /** Site-urile cu același scor maxim, când sunt mai multe (ambiguu). */
  candidates: string[]
}

export type MappingProposal<A extends AirbyteAccount = AirbyteAccount> = {
  rows: MappingRow<A>[]
  /** Conturile deja legate: `external_account_id` → id-ul site-ului. */
  linked: Array<{ account: A; brand_id: string }>
}

/**
 * Propunerea pentru toate conturile nelegate. Doar site-urile active primesc propuneri; un cont legat deja (pe orice
 * site al clientului) nu se mai propune, pentru că un cont aparține unui singur site.
 */
export function proposeAirbyteMapping<A extends AirbyteAccount>(
  accounts: A[],
  spaces: Array<Pick<ClientSpace, 'id' | 'name' | 'domain' | 'status'>>,
  clientName: string,
  linkedTo: ReadonlyMap<string, string>,
): MappingProposal<A> {
  const active = spaces.filter((s) => s.status === 'active').map((s) => ({ id: s.id, keys: siteKeys(s, clientName) }))
  const rows: MappingRow<A>[] = []
  const linked: MappingProposal<A>['linked'] = []
  for (const account of accounts) {
    const brand = linkedTo.get(account.id)
    if (brand) {
      linked.push({ account, brand_id: brand })
      continue
    }
    const scored = active.map((s) => ({ id: s.id, score: score(account.name, s.keys) })).filter((s) => s.score > 0)
    const best = Math.max(0, ...scored.map((s) => s.score))
    const top = scored.filter((s) => s.score === best).map((s) => s.id)
    rows.push({ account, proposed: top.length === 1 ? top[0]! : null, candidates: top.length > 1 ? top : [] })
  }
  // Propunerile întâi, apoi ambiguele, apoi restul; în fiecare grup, după platformă și nume.
  const rank = (r: MappingRow<A>) => (r.proposed ? 0 : r.candidates.length ? 1 : 2)
  rows.sort((a, b) => rank(a) - rank(b) || a.account.platform.localeCompare(b.account.platform) || a.account.name.localeCompare(b.account.name, 'ro'))
  return { rows, linked }
}
