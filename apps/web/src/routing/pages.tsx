import { MagnifyingGlassIcon, PlugsIcon, ProhibitIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import type { Brand, ProviderResult, Role, SourceProviderId, SourceStatusInfo } from '../contracts'
import { EmptyState } from '../components/EmptyState'
import { useAsync } from '../data/useAsync'
import { useProviders } from '../data/DataProvidersContext'
import { PROVIDER_LABELS } from '../lib/sources'
import { adminPath } from '../lib/navigation'
import type { AdminModule, BrandModule } from './modules'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={<MagnifyingGlassIcon size={36} weight="thin" />}
      title="Pagina nu există"
      text="Adresa nu corespunde niciunui ecran din Analyzator."
      action={{ label: 'Mergi la început', onClick: () => navigate('/') }}
    />
  )
}

/** Brand inexistent sau nepermis: același mesaj în ambele cazuri, ca să nu confirme existența unui brand străin. */
export function NoAccessPage({ homeBrandId }: { homeBrandId: string | null }) {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={<ProhibitIcon size={36} weight="thin" />}
      title="Spațiu de brand indisponibil"
      text="Nu ai acces la acest spațiu de brand sau nu există."
      action={homeBrandId ? { label: 'Mergi la un spațiu permis', onClick: () => navigate(`/brands/${homeBrandId}/overview`) } : undefined}
    />
  )
}

export function NoBrandsPage() {
  return (
    <EmptyState
      icon={<ProhibitIcon size={36} weight="thin" />}
      title="Nu ai acces la niciun spațiu de brand"
      text="Contul tău nu are încă brandurile alocate. Cere echipei AdSymphony să îți aloce accesul."
    />
  )
}

export function ProviderProblem({ result, onRetry }: { result: Exclude<ProviderResult<unknown>, { kind: 'ready' }>; onRetry?: () => void }) {
  return result.kind === 'not_connected' ? (
    <EmptyState icon={<PlugsIcon size={36} weight="thin" />} title="Sursă neconectată" text={result.reason} />
  ) : (
    <EmptyState
      icon={<WarningCircleIcon size={36} weight="thin" />}
      title="Nu am putut încărca datele"
      text={result.message}
      action={onRetry ? { label: 'Reîncearcă', onClick: onRetry } : undefined}
    />
  )
}

function Skeleton({ label }: { label: string }) {
  return <div role="status" aria-label={label} className="h-64 rounded-xl bg-skeleton" />
}

const names = (providers: readonly SourceProviderId[]) => providers.map((p) => PROVIDER_LABELS[p].name)
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} și ${items[items.length - 1]}`)

/**
 * Conținutul unui modul până se construiește ecranul lui (UI-2…UI-6). Nu afișează „în curând": spune
 * starea reală a surselor. Fără nicio sursă conectată: „Sursă neconectată" cu motivul din design.
 */
export function ModulePlaceholder({ module, brand, role }: { module: BrandModule; brand: Brand; role: Role }) {
  const providers = useProviders()
  const navigate = useNavigate()
  const { state, reload } = useAsync(() => providers.sources.statuses(brand.id), [providers, brand.id])

  if (state.status === 'loading') return <Skeleton label="Se încarcă starea surselor" />
  if (state.status === 'failed') return <ProviderProblem result={{ kind: 'error', message: state.message }} onRetry={reload} />
  const result = state.value
  if (result.kind !== 'ready') return <ProviderProblem result={result} onRetry={reload} />

  const statuses: SourceStatusInfo[] = result.data.filter((s) => module.sources.includes(s.provider))
  const connected = statuses.filter((s) => s.state !== 'not_connected')
  const disconnected = module.sources.length > 0 && connected.length === 0

  if (disconnected) {
    const text = module.disconnected?.(brand.name) ?? `${list(names(module.sources))} nu sunt conectate pentru ${brand.name}. Până la conectare nu afișăm cifre, nici estimate.`
    // Cererea de conectare nu are încă un canal real: clientul nu primește un buton care ar pretinde că trimite ceva.
    const action = role === 'agency_admin' && module.connectLabel ? { label: module.connectLabel, onClick: () => navigate(adminPath('sources')) } : undefined
    return <EmptyState icon={<PlugsIcon size={36} weight="thin" />} title="Sursă neconectată" text={text} action={action} />
  }

  const where = connected.length > 0 ? `Sursele ${list(names(connected.map((s) => s.provider)))} sunt conectate pentru ${brand.name}, dar` : ''
  return (
    <EmptyState
      icon={<WarningCircleIcon size={36} weight="thin" />}
      title="Acest ecran nu este încă disponibil"
      text={`${where} ecranul ${module.title} nu a fost livrat în această versiune.`.trim().replace(/^\w/, (c) => c.toUpperCase())}
    />
  )
}

export function AdminPlaceholder({ module }: { module: AdminModule }) {
  const navigate = useNavigate()
  if (module.segment === 'config') {
    return (
      <EmptyState
        icon={<MagnifyingGlassIcon size={36} weight="thin" />}
        title="Configurarea e gestionată de AdSymphony"
        text="Seturile de competitori, întrebările din panelul AI și keywords-urile urmărite se modifică momentan la cerere, cu versiune și dată efectivă."
        action={{ label: 'Vezi sursele', onClick: () => navigate(adminPath('sources')) }}
      />
    )
  }
  return <EmptyState icon={<WarningCircleIcon size={36} weight="thin" />} title="Acest ecran nu este încă disponibil" text={`Ecranul ${module.title} nu a fost livrat în această versiune.`} />
}
