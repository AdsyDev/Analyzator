import { MagnifyingGlassIcon, PlugsIcon, ProhibitIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import type { ProviderResult } from '../contracts'
import { EmptyState } from '../components/EmptyState'
import type { AdminModule } from './modules'

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

/** Ecran de Administrare încă neconstruit (Clienți și site-uri): spune adevărul, fără „în curând". */
export function AdminPlaceholder({ module }: { module: AdminModule }) {
  return <EmptyState icon={<WarningCircleIcon size={36} weight="thin" />} title="Acest ecran nu este încă disponibil" text={`Ecranul ${module.title} nu a fost livrat în această versiune.`} />
}
