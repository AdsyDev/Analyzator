import type { Role } from '../contracts'

export interface NavItem {
  /** Segmentul din URL: `/brands/:brandId/<segment>` sau `/admin/<segment>`. */
  segment: string
  label: string
  icon: string
  /** Submeniu: segmentul modulului sub care apare (de ex. Farmacovigilență sub Listening). */
  parent?: string
  /** Doar pentru aceste roluri; fără listă, pentru toți. UI-ul ascunde și redirecționează; RLS rămâne autoritatea. */
  roles?: readonly Role[]
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
  { segment: 'ux', label: 'User experience', icon: 'CursorClick' },
  { segment: 'paid', label: 'Paid Media', icon: 'MegaphoneSimple' },
  { segment: 'social', label: 'Social', icon: 'UsersThree' },
  { segment: 'listening', label: 'Listening', icon: 'Ear' },
  // Jurnalul PV e doar pentru agency_admin (B7-14, brief cap. 6); clientul nu îl vede.
  { segment: 'pharmacovigilance', label: 'Farmacovigilență', icon: 'FirstAidKit', parent: 'listening', roles: ['agency_admin'] },
  { segment: 'competition', label: 'Concurență', icon: 'Scales' },
  { segment: 'insights', label: 'Analize și acțiuni', icon: 'Notebook' },
]

/** Modulele de brand vizibile pentru un rol, în ordinea meniului (submeniurile imediat după părinte). */
export const brandNavFor = (role: Role): NavItem[] => BRAND_NAV.filter((i) => !i.roles || i.roles.includes(role))
export const canAccessBrandModule = (role: Role, segment: string): boolean => {
  const item = BRAND_NAV.find((i) => i.segment === segment)
  return !item?.roles || item.roles.includes(role)
}

/**
 * Spec cap. 28: clienții, brandurile, invitațiile, sursele și drepturile sunt ale lui Agency admin;
 * `docs/design/screens.md`: sursele (în pagina fiecărui site) sunt doar pentru `agency_admin`. Strategist și account lucrează cu datele
 * și analizele brandurilor alocate, nu cu Administrarea.
 */
const ADMIN_ONLY: readonly Role[] = ['agency_admin']

export const ADMIN_NAV: readonly AdminNavItem[] = [
  { segment: 'clients', label: 'Clienți și site-uri', icon: 'Buildings', roles: ADMIN_ONLY },
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
/** Pagina unui site în Administrare: detaliile și sursele lui. */
export const sitePath = (brandId: string) => `/admin/clients/${brandId}`
