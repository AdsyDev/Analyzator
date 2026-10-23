import type { BrandId, IsoDate, IsoDateTime, ProviderResult, TenantId } from './common'
import type { Role } from './brand'

/** Acces la un brand al unei persoane (`brand_access`); `active` = nerevocat. */
export interface PersonBrandAccess {
  brand_id: BrandId
  active: boolean
}

/**
 * O persoană cu acces (membership + brand_access). `email`, `name` și `last_sign_in_at` vin din contul persoanei
 * (`auth.users`) prin funcția server `users`, doar pentru `agency_admin` și doar în tenantul lui. `name` e null când
 * contul nu are nume; `email` e null doar dacă identitatea lipsește din răspuns.
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
  /** Ultima autentificare; null = persoana nu a intrat încă (invitație neacceptată). */
  last_sign_in_at: IsoDateTime | null
  brands: PersonBrandAccess[]
}

/** Invitația trimisă din Administrare → Utilizatori (funcția server `users`, acțiunea `invite`). */
export interface NewInvite {
  tenant_id: TenantId
  email: string
  full_name: string | null
  role: Role
  brand_ids: BrandId[]
}

/** `invited` = cont nou, email trimis; `access_granted` = cont activ, fără email; `resent` = invitație retrimisă. */
export type InviteStatus = 'invited' | 'access_granted' | 'resent'
export const INVITE_STATUSES: readonly InviteStatus[] = ['invited', 'access_granted', 'resent']

export interface InviteResult {
  status: InviteStatus
  user_id: string
}

export interface UsersProvider {
  /** Doar `agency_admin` (RLS pe `memberships` și `brand_access`). */
  people(): Promise<ProviderResult<AccessPerson[]>>
  setRole(tenantId: TenantId, userId: string, role: Role): Promise<ProviderResult<null>>
  /** Revocă sau restabilește accesul la tenant (`memberships.revoked_at`). */
  setMembershipActive(tenantId: TenantId, userId: string, active: boolean): Promise<ProviderResult<null>>
  /** Acordă sau revocă accesul la un brand (`brand_access`). */
  setBrandAccess(tenantId: TenantId, userId: string, brandId: BrandId, active: boolean): Promise<ProviderResult<null>>
  /** Invită o persoană (sau retrimite invitația uneia care nu și-a activat contul). Doar `agency_admin` al tenantului. */
  invite(input: NewInvite): Promise<ProviderResult<InviteResult>>
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

/** O versiune nouă de mapare pentru un grup (`brand` cere `brand_id` și `brand_type`; `excluded` le are null). */
export interface NewSeomonitorMapping {
  campaign_id: string
  group_id: string
  kind: 'brand' | 'excluded'
  brand_id: BrandId | null
  brand_type: 'branded' | 'nonbranded' | null
  is_primary_visibility: boolean
}

export interface ConfigProvider {
  competitorVersions(brandId: BrandId): Promise<ProviderResult<CompetitorSetVersion[]>>
  aliases(brandId: BrandId): Promise<ProviderResult<BrandAlias[]>>
  seomonitorMappings(): Promise<ProviderResult<SeomonitorMapping[]>>
  /**
   * Doar `agency_admin` (RLS). Fiecare grup primește o versiune nouă (cea mai mare + 1), în vigoare de ieri
   * (Europe/Bucharest), ca prima colectare să o aplice; versiunile vechi rămân, nimic nu se modifică.
   * `sourceId` = conexiunea SEOmonitor a clientului.
   */
  saveSeomonitorMappings(tenantId: TenantId, sourceId: string, rows: NewSeomonitorMapping[]): Promise<ProviderResult<{ effective_from: IsoDate }>>
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
