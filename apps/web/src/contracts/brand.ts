import type { BrandId, IsoDate, TenantId } from './common'

/** Rolurile din `membership_role` (baza de date). */
export const ROLES = ['agency_admin', 'strategist', 'account', 'client_viewer'] as const
export type Role = (typeof ROLES)[number]

/** Rolurile de agenție văd Administrare, statusurile editoriale și jurnalul de farmacovigilență. */
export function isAgencyRole(role: Role): boolean {
  return role !== 'client_viewer'
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  /** Organizația afișată (de ex. „AdSymphony", „STADA"). */
  organization: string
}

export interface Brand {
  id: BrandId
  tenant_id: TenantId
  name: string
  category: string | null
  domain: string | null
}

export interface Competitor {
  id: string
  name: string
  /** Eticheta stabilă din UI: C1, C2, C3. Culoarea urmează eticheta. */
  label: string
}

export interface CompetitorSet {
  brand_id: BrandId
  version: number
  effective_from: IsoDate
  competitors: Competitor[]
}
