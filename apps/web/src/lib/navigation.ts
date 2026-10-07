import type { Role } from '../contracts'

export interface NavItem {
  /** Segmentul din URL: `/brands/:brandId/<segment>` sau `/admin/<segment>`. */
  segment: string
  label: string
  icon: string
}

export interface AdminNavItem extends NavItem {
  /** Rolurile care accesează pagina. UI-ul ascunde și redirecționează; RLS rămâne autoritatea. */
  roles: readonly Role[]
}

export const BRAND_NAV: readonly NavItem[] = [
  { segment: 'overview', label: 'Overview', icon: 'SquaresFour' },
  { segment: 'ai', label: 'AI Visibility', icon: 'ChatCircleText' },
  { segment: 'seo', label: 'SEO și Search', icon: 'MagnifyingGlass' },
  { segment: 'traffic', label: 'Trafic și conversii', icon: 'ChartLineUp' },
  { segment: 'paid', label: 'Paid Media', icon: 'MegaphoneSimple' },
  { segment: 'social', label: 'Social', icon: 'UsersThree' },
  { segment: 'listening', label: 'Listening', icon: 'Ear' },
  { segment: 'competition', label: 'Concurență', icon: 'Scales' },
  { segment: 'insights', label: 'Analize și acțiuni', icon: 'Notebook' },
]

/**
 * Spec cap. 28: clienții, brandurile, invitațiile, sursele și drepturile sunt ale lui Agency admin;
 * `docs/design/screens.md`: Surse e doar pentru `agency_admin`. Strategist și account lucrează cu datele
 * și analizele brandurilor alocate, nu cu Administrarea.
 */
const ADMIN_ONLY: readonly Role[] = ['agency_admin']

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { segment: 'clients', label: 'Clienți și site-uri', icon: 'Buildings', roles: ADMIN_ONLY },
  { segment: 'sources', label: 'Surse', icon: 'PlugsConnected', roles: ADMIN_ONLY },
  { segment: 'users', label: 'Utilizatori', icon: 'UserList', roles: ADMIN_ONLY },
  { segment: 'config', label: 'Configurare', icon: 'SlidersHorizontal', roles: ADMIN_ONLY },
]

export const adminItemsFor = (role: Role): AdminNavItem[] => ADMIN_NAV.filter((i) => i.roles.includes(role))
export const canAccessAdmin = (role: Role, segment: string): boolean => adminItemsFor(role).some((i) => i.segment === segment)

export const ROLE_LABELS: Record<Role, string> = {
  agency_admin: 'Agenție, administrator',
  strategist: 'Agenție, strategist',
  account: 'Agenție, account',
  client_viewer: 'Client, cititor',
}

export const brandPath = (brandId: string, segment: string) => `/brands/${brandId}/${segment}`
export const adminPath = (segment: string) => `/admin/${segment}`
