// Credențiala destinației Postgres Airbyte (E-6): connection string-ul și, opțional, certificatul autorității (CA)
// care a emis certificatul serverului. Citire și verificarea adresei; independent de runtime.
//
// Din connection string folosim doar host, port, utilizator, parolă, bază și sslmode. Alți parametri (de exemplu
// `options=-c ...`) se ignoră, ca să nu poată schimba sesiunea read-only. Adresa trebuie să fie publică (SSRF): nu
// acceptăm localhost, nume fără domeniu (servicii interne), rețele private sau link-local, nici înainte de rezolvarea
// DNS, nici după.
//
// TLS e obligatoriu și certificatul serverului se verifică mereu, pe nume: runtime-ul funcțiilor server (Deno) nu
// permite conexiuni TLS neverificate și nu validează certificate pe IP. De aceea serverul are nevoie de un nume de
// domeniu și de un certificat emis pentru el, de o autoritate publică sau de una proprie (`ca_cert`).

export type Dsn = {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** PEM-ul autorității care a emis certificatul serverului; `null` = autoritățile publice. */
  ca: string | null
}

export type DsnError = { ok: false; reason: 'invalid_dsn' | 'tls_required' | 'host_not_allowed'; message: string }
export type DsnResult = { ok: true; dsn: Dsn } | DsnError

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
const TLD = /^(xn--[a-z0-9-]+|[a-z]{2,63})$/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.svc', '.cluster.local']
const PEM = /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/
const MAX_CA_LENGTH = 8000

const invalid = (message: string): DsnError => ({ ok: false, reason: 'invalid_dsn', message })
const notAllowed = (message: string): DsnError => ({ ok: false, reason: 'host_not_allowed', message })

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s)
  } catch {
    return null
  }
}

/**
 * Credențiala salvată în Vault: connection string-ul simplu sau JSON `{ "dsn": "...", "ca_cert": "-----BEGIN ..." }`.
 * Mesajele nu repetă nimic din credențială.
 */
export function parseCredential(raw: string): DsnResult {
  const text = raw.trim()
  if (!text.startsWith('{')) return parseDsn(text, null)
  let v: { dsn?: unknown; ca_cert?: unknown }
  try {
    v = JSON.parse(text) as typeof v
  } catch {
    return invalid('Credențiala salvată nu poate fi citită.')
  }
  if (typeof v.dsn !== 'string') return invalid('Lipsește connection string-ul.')
  let ca: string | null = null
  if (v.ca_cert !== undefined && v.ca_cert !== null && v.ca_cert !== '') {
    if (typeof v.ca_cert !== 'string' || v.ca_cert.length > MAX_CA_LENGTH || !PEM.test(v.ca_cert.trim())) {
      return invalid('Certificatul autorității (CA) trebuie să fie un singur bloc PEM „BEGIN CERTIFICATE”.')
    }
    ca = v.ca_cert.trim()
  }
  return parseDsn(v.dsn, ca)
}

/** `postgresql://utilizator:parolă@server.exemplu.ro:5432/bază?sslmode=require`. */
export function parseDsn(raw: string, ca: string | null): DsnResult {
  const text = raw.trim()
  if (!/^postgres(ql)?:\/\//i.test(text)) return invalid('Connection string-ul trebuie să înceapă cu postgresql://.')
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return invalid('Connection string-ul nu poate fi citit.')
  }
  const user = decode(url.username)
  const password = decode(url.password)
  const database = decode(url.pathname.replace(/^\//, ''))
  if (!user) return invalid('Lipsește utilizatorul din connection string.')
  if (!password) return invalid('Lipsește parola din connection string.')
  if (!database || database.includes('/')) return invalid('Lipsește numele bazei de date din connection string.')

  let port = 5432
  if (url.port !== '') {
    port = Number(url.port)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return invalid('Portul trebuie să fie între 1024 și 65535.')
  }

  // require, verify-ca și verify-full ajung toate la verificarea completă (vezi antetul).
  const sslmode = (url.searchParams.get('sslmode') ?? 'verify-full').toLowerCase()
  if (!['require', 'verify-ca', 'verify-full'].includes(sslmode)) {
    return { ok: false, reason: 'tls_required', message: 'Conexiunea trebuie să fie criptată: folosește sslmode=require sau verify-full.' }
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const hostCheck = checkHost(host)
  if (hostCheck) return hostCheck
  return { ok: true, dsn: { host, port, user, password, database, ca } }
}

/** Numele din connection string. `null` = acceptat (rezolvarea DNS se verifică separat). */
export function checkHost(host: string): DsnError | null {
  if (host === '') return invalid('Lipsește adresa serverului din connection string.')
  if (isIpLiteral(host)) {
    if (!isPublicIp(host)) return notAllowed('Adresa serverului e privată sau rezervată. Folosește adresa publică a serverului Airbyte.')
    return invalid('Folosește numele de domeniu al serverului, nu IP-ul: certificatul TLS se verifică pe nume.')
  }
  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return notAllowed('Adresa serverului e internă. Folosește adresa publică a serverului Airbyte.')
  }
  // Ultima etichetă trebuie să fie alfabetică: `127.1` sau `0x7f.1` ar ajunge la 127.0.0.1 prin getaddrinfo.
  if (!HOSTNAME.test(host) || !TLD.test(host.slice(host.lastIndexOf('.') + 1))) return invalid('Adresa serverului nu e un nume de domeniu valid.')
  return null
}

/** Toate adresele în care se rezolvă numele trebuie să fie publice. */
export function checkResolved(addresses: string[]): DsnError | null {
  if (addresses.length === 0) return { ok: false, reason: 'host_not_allowed', message: 'Numele serverului nu se rezolvă în nicio adresă.' }
  return addresses.every(isPublicIp) ? null : notAllowed('Numele serverului se rezolvă într-o adresă privată sau rezervată.')
}

function isIpLiteral(host: string): boolean {
  return IPV4.test(host) || host.includes(':')
}

function ipv4Octets(ip: string): number[] | null {
  const m = IPV4.exec(ip)
  if (!m) return null
  const o = m.slice(1).map(Number)
  return o.every((n) => n >= 0 && n <= 255) ? o : null
}

function isPublicIpv4(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
  if (a === 169 && b === 254) return false // link-local, metadata cloud
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  if (a >= 224) return false // multicast, rezervat, broadcast
  return true
}

/** Grupurile de 16 biți ale unei adrese IPv6 (cu `::` și sufix IPv4). `null` = adresă invalidă. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.split('%')[0]!
  const tail: number[] = []
  const v4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s)
  if (v4) {
    const o = ipv4Octets(v4[1]!)
    if (!o) return null
    tail.push((o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!)
    s = s.slice(0, s.length - v4[1]!.length)
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1)
  }
  const parts = s.split('::')
  if (parts.length > 2) return null
  const parse = (p: string) => (p === '' ? [] : p.split(':').map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN)))
  const head = parse(parts[0]!)
  const rest = parts.length === 2 ? parse(parts[1]!) : []
  if ([...head, ...rest].some(Number.isNaN)) return null
  const fill = 8 - tail.length - head.length - rest.length
  if (parts.length === 1 ? fill !== 0 : fill < 1) return null
  return [...head, ...Array<number>(parts.length === 2 ? fill : 0).fill(0), ...rest, ...tail]
}

export function isPublicIp(ip: string): boolean {
  const v4 = ipv4Octets(ip)
  if (v4) return isPublicIpv4(v4)
  const g = ipv6Groups(ip.toLowerCase())
  if (!g || g.length !== 8) return false
  if (g.every((x) => x === 0)) return false // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false // ::1
  // ::ffff:a.b.c.d și ::a.b.c.d: decide adresa IPv4.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIpv4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255])
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicIpv4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]) // NAT64
  if ((g[0]! & 0xfe00) === 0xfc00) return false // unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return false // link-local
  if ((g[0]! & 0xff00) === 0xff00) return false // multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false // documentație
  return true
}
