import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useMatch, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { useAuth, useUser } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { FilterBar } from '../components/FilterBar'
import type { Brand, ProviderResult, QueryContext, SessionUser } from '../contracts'
import { useProviders } from '../data/DataProvidersContext'
import { useAsync } from '../data/useAsync'
import { brandPath } from '../lib/navigation'
import { sharedSearch } from '../lib/period'
import { ADMIN_MODULES, BRAND_MODULES } from './modules'
import { NoAccessPage, NoBrandsPage, ProviderProblem } from './pages'
import { useQueryContext } from './useQueryContext'

export interface LayoutContext {
  user: SessionUser
  /** Brandurile permise utilizatorului, așa cum le-a întors serverul. */
  brands: Brand[]
  /** Brandul din URL, doar dacă e permis; altfel null (nu se face nicio cerere pentru el). */
  brand: Brand | null
  /** Contextul interogării din URL; null în afara modulelor de brand. */
  ctx: QueryContext | null
  homeBrandId: string | null
}

export const useLayout = () => useOutletContext<LayoutContext>()

const BRAND_KEY = 'az-brand'
function readBrand(): string | null {
  try {
    return window.sessionStorage.getItem(BRAND_KEY)
  } catch {
    return null
  }
}
function writeBrand(id: string) {
  try {
    window.sessionStorage.setItem(BRAND_KEY, id)
  } catch {
    // Stocarea poate fi blocată; brandul rămâne valabil cât ține pagina.
  }
}

export function AppLayout() {
  const user = useUser()
  const { signOut, preview } = useAuth()
  const providers = useProviders()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()

  const brandMatch = useMatch('/brands/:brandId/:segment')
  const brandOnly = useMatch('/brands/:brandId')
  const adminMatch = useMatch('/admin/:segment')
  const urlBrandId = brandMatch?.params.brandId ?? brandOnly?.params.brandId ?? null
  const segment = brandMatch?.params.segment ?? null
  const module = segment ? BRAND_MODULES[segment] : undefined
  const adminModule = adminMatch?.params.segment ? ADMIN_MODULES[adminMatch.params.segment] : undefined
  const isHome = location.pathname === '/'

  const { state: brandsState } = useAsync(() => providers.brands.list(), [providers, user.id, user.role])
  const brandsResult: ProviderResult<Brand[]> | null =
    brandsState.status === 'done' ? brandsState.value : brandsState.status === 'failed' ? { kind: 'error', message: brandsState.message } : null
  const brands = brandsResult?.kind === 'ready' ? brandsResult.data : []

  const [remembered, setRemembered] = useState<string | null>(readBrand)
  const urlBrand = urlBrandId ? (brands.find((b) => b.id === urlBrandId) ?? null) : null
  useEffect(() => {
    if (urlBrand) {
      setRemembered(urlBrand.id)
      writeBrand(urlBrand.id)
    }
  }, [urlBrand])

  const rememberedBrand = brands.find((b) => b.id === remembered) ?? null
  // Brandul afișat în topbar: cel din URL doar dacă e permis; altfel ultimul valid sau primul permis.
  const shellBrand = urlBrandId ? urlBrand : (rememberedBrand ?? brands[0] ?? null)
  const homeBrandId = (rememberedBrand ?? brands[0])?.id ?? null

  const filterDefs = module?.filters ?? []
  const { ctx, change, reset } = useQueryContext(urlBrand ? urlBrand.id : null, filterDefs)

  // „Date până la" și „Ultimul refresh" din starea surselor brandului curent (doar pentru un brand permis).
  const { state: sourcesState } = useAsync(
    () => (shellBrand ? providers.sources.statuses(shellBrand.id) : Promise.resolve(null)),
    [providers, shellBrand?.id, user.role],
  )
  const { dataAsOf, lastRefreshAt } = useMemo(() => {
    if (sourcesState.status !== 'done' || sourcesState.value?.kind !== 'ready') return { dataAsOf: null, lastRefreshAt: null }
    const live = sourcesState.value.data.filter((s) => s.state !== 'not_connected')
    const dates = live.map((s) => s.data_as_of).filter((d): d is string => !!d).sort()
    const imports = live.map((s) => s.imported_at).filter((d): d is string => !!d).sort()
    return { dataAsOf: dates[0] ?? null, lastRefreshAt: imports[imports.length - 1] ?? null }
  }, [sourcesState])

  const title = module?.title ?? adminModule?.title ?? 'Analyzator'
  const subtitle = module?.subtitle(shellBrand?.name ?? '') ?? adminModule?.subtitle(shellBrand?.name ?? null)
  useEffect(() => {
    document.title = [title, shellBrand?.name, 'Analyzator'].filter(Boolean).join(' · ')
  }, [title, shellBrand?.name])

  function onBrandChange(id: string) {
    setRemembered(id)
    writeBrand(id)
    if (urlBrandId) navigate({ pathname: brandPath(id, segment ?? 'overview'), search: sharedSearch(params) })
  }

  const needsBrand = urlBrandId !== null || isHome
  let content
  if (needsBrand && brandsResult === null) {
    content = <div role="status" aria-label="Se încarcă spațiile de brand" className="h-64 rounded-xl bg-skeleton" />
  } else if (needsBrand && brandsResult && brandsResult.kind !== 'ready') {
    content = <ProviderProblem result={brandsResult} />
  } else if (needsBrand && brands.length === 0) {
    content = <NoBrandsPage />
  } else if (urlBrandId && !urlBrand) {
    content = <NoAccessPage homeBrandId={homeBrandId} />
  } else {
    const context: LayoutContext = { user, brands, brand: urlBrand, ctx, homeBrandId }
    // `key` pe rol: la comutarea rolului în previzualizare, ecranele se reîncarcă cu datele noului rol.
    content = <Outlet key={user.role} context={context} />
  }

  return (
    <AppShell
      user={user}
      brands={brandsResult}
      brandId={shellBrand?.id ?? null}
      onBrandChange={onBrandChange}
      title={title}
      subtitle={subtitle || undefined}
      dataAsOf={dataAsOf}
      lastRefreshAt={lastRefreshAt}
      onSignOut={() => void signOut()}
      roleSwitcher={preview ? { role: user.role, onChange: preview.setRole } : undefined}
      filterBar={module && ctx && urlBrand ? <FilterBar value={ctx} onChange={change} onReset={reset} filterDefs={filterDefs} /> : undefined}
    >
      {content}
    </AppShell>
  )
}
