import type { BrandId, IsoDate, IsoDateTime, ProviderResult, TenantId } from './common'
import type { Role } from './brand'

/** Acces la un brand al unei persoane (`brand_access`); `active` = nerevocat. */
export interface PersonBrandAccess {
  brand_id: BrandId
  active: boolean
}

/**
 * O persoană cu acces (membership + brand_access). `name` și `email` sunt null până există o sursă
 * citibilă pentru ele: în schema curentă ele trăiesc doar în `auth.users`, inaccesibil din client.
 */
export interface AccessPerson {
  user_id: string
  tenant_id: TenantId
  /** Numele tenantului (organizația), de ex. „AdSymphony" sau „STADA". */
  organization: string
  role: Role
  membership_active: boolean
  since: IsoDateTime
  name: string | null
  email: string | null
  brands: PersonBrandAccess[]
}

export interface UsersProvider {
  /** Doar `agency_admin` (RLS pe `memberships` și `brand_access`). */
  people(): Promise<ProviderResult<AccessPerson[]>>
  setRole(tenantId: TenantId, userId: string, role: Role): Promise<ProviderResult<null>>
  /** Revocă sau restabilește accesul la tenant (`memberships.revoked_at`). */
  setMembershipActive(tenantId: TenantId, userId: string, active: boolean): Promise<ProviderResult<null>>
  /** Acordă sau revocă accesul la un brand (`brand_access`). */
  setBrandAccess(tenantId: TenantId, userId: string, brandId: BrandId, active: boolean): Promise<ProviderResult<null>>
}

export interface CompetitorMember {
  id: string
  name: string
  domain: string | null
  /** C1, C2, C3 în ordinea setului. */
  label: string
}

/** O versiune imutabilă a setului de competitori. Versiunea efectivă la data D = cea mai mare `effective_from <= D`. */
export interface CompetitorSetVersion {
  version: number
  effective_from: IsoDate
  note: string | null
  created_at: IsoDateTime
  /** Versiunea în vigoare azi (Europe/Bucharest). */
  current: boolean
  members: CompetitorMember[]
}

export interface BrandAlias {
  id: string
  alias: string
  /** Unde se folosește: detectarea în răspunsuri AI, în mențiuni. */
  used_in: string
}

export type MappingKind = 'brand' | 'multi_brand' | 'excluded'

/** Maparea unui grup SEOmonitor la un brand (cea mai recentă versiune a grupului). */
export interface SeomonitorMapping {
  campaign_id: string
  group_id: string
  version: number
  effective_from: IsoDate
  kind: MappingKind
  brand_id: BrandId | null
  brand_type: 'branded' | 'nonbranded' | null
  is_primary_visibility: boolean
  note: string | null
}

export interface ConfigProvider {
  competitorVersions(brandId: BrandId): Promise<ProviderResult<CompetitorSetVersion[]>>
  aliases(brandId: BrandId): Promise<ProviderResult<BrandAlias[]>>
  seomonitorMappings(): Promise<ProviderResult<SeomonitorMapping[]>>
}

export type RecordStatus = 'active' | 'archived'

/** Un spațiu de brand (un site) al unui client, așa cum îl vede Administrarea (inclusiv arhivat). */
export interface ClientSpace {
  id: BrandId
  tenant_id: TenantId
  slug: string
  name: string
  domain: string | null
  status: RecordStatus
  created_at: IsoDateTime
  /** Conexiunile active ale spațiului (`source_connections` cu brandul lui). */
  connections: number
}

/** Un client (tenant) cu spațiile lui. */
export interface Client {
  id: TenantId
  slug: string
  name: string
  status: RecordStatus
  created_at: IsoDateTime
  spaces: ClientSpace[]
}

export interface NewClient {
  name: string
  slug: string
}

export interface NewSpace {
  name: string
  slug: string
  domain: string | null
}

export type SpacePatch = Partial<Pick<ClientSpace, 'name' | 'domain' | 'status'>>

/**
 * Administrare → Clienți și site-uri (doar `agency_admin`; RLS e autoritatea). Crearea unui client îl face pe
 * creator `agency_admin` în el (docs/security-tests.md, E5). Clientul nu se arhivează din aplicație (D-2).
 */
export interface ClientsProvider {
  list(): Promise<ProviderResult<Client[]>>
  createClient(input: NewClient): Promise<ProviderResult<{ id: TenantId }>>
  renameClient(id: TenantId, name: string): Promise<ProviderResult<null>>
  createSpace(tenantId: TenantId, input: NewSpace): Promise<ProviderResult<{ id: BrandId }>>
  updateSpace(id: BrandId, patch: SpacePatch): Promise<ProviderResult<null>>
}
