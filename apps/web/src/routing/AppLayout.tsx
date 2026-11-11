import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useMatch, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { useAuth, useUser } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { ModuleFreshness } from '../components/ModuleFreshness'
import { FilterBar } from '../components/FilterBar'
import type { Brand, ProviderResult, QueryContext, SessionUser } from '../contracts'
import type { FilterBarChange } from '../components/FilterBar'
import type { FilterDef } from '../lib/period'
import { useProviders } from '../data/DataProvidersContext'
import { useAsync } from '../data/useAsync'
import { PORTFOLIO_PATH, brandPath } from '../lib/navigation'
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
  /** Spațiul ales în topbar (și în afara modulelor de brand, de ex. în Administrare); null dacă utilizatorul nu are niciunul. */
  activeBrand: Brand | null
  /** Contextul interogării din URL; null în afara modulelor de brand. */
  ctx: QueryContext | null
  homeBrandId: string | null
  /** Schimbă filtrele din URL (de ex. selectarea unui engine dintr-un card). */
  changeFilters: (change: FilterBarChange) => void
  /** Reîncarcă lista de branduri (de ex. după ce Administrarea a creat sau a arhivat un site). */
  reloadBrands: () => void
  /** Alege spațiul din topbar (de ex. site-ul deschis în pagina lui de surse). */
  selectBrand: (id: string) => void
  /** Sidebarul AdSy AI („AI insights”): deschis sau nu, și elementul în care pagina își montează conținutul. */
  aiPanel: { open: boolean; setOpen: (open: boolean) => void; container: HTMLElement | null }
}

export const useLayout = () => useOutletContext<LayoutContext>()

const BRAND_KEY = 'az-brand'
/**
 * Ultimul brand ales se reține pe dispozitiv, între sesiuni (propunerea din 10 nov. 2026). E doar o preferință:
 * un ID care nu mai e printre brandurile permise utilizatorului curent e ignorat (vezi `rememberedBrand`).
 */
function readBrand(): string | null {
  try {
    return window.localStorage.getItem(BRAND_KEY) ?? window.sessionStorage.getItem(BRAND_KEY)
  } catch {
    return null
  }
}
const AI_PANEL_KEY = 'az-ai-panel'
const AI_SWITCH_ID = 'ai-insights-switch'
/** Sidebarul AdSy AI e închis până îl deschide utilizatorul; alegerea se reține pe dispozitiv. */
function readAiPanel(): boolean {
  try {
    return window.localStorage.getItem(AI_PANEL_KEY) === 'open'
  } catch {
    return false
  }
}
function writeBrand(id: string) {
  try {
    window.localStorage.setItem(BRAND_KEY, id)
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
  const siteMatch = useMatch('/admin/clients/:brandId')
  const urlBrandId = brandMatch?.params.brandId ?? brandOnly?.params.brandId ?? null
  const segment = brandMatch?.params.segment ?? null
  const module = segment ? BRAND_MODULES[segment] : undefined
  const adminModule = adminMatch?.params.segment ? ADMIN_MODULES[adminMatch.params.segment] : undefined
  const isHome = location.pathname === '/'
  const isPortfolio = location.pathname === PORTFOLIO_PATH

  const { state: brandsState, reload: reloadBrands } = useAsync(() => providers.brands.list(), [providers, user.id, user.role])
  const brandsResult: ProviderResult<Brand[]> | null =
    brandsState.status === 'done' ? brandsState.value : brandsState.status === 'failed' ? { kind: 'error', message: brandsState.message } : null
  const brands = brandsResult?.kind === 'ready' ? brandsResult.data : []

  const [aiOpen, setAiOpenState] = useState<boolean>(readAiPanel)
  const [aiContainer, setAiContainerState] = useState<HTMLElement | null>(null)
  // Deschis de utilizator (nu restaurat la încărcare): focusul trece în sidebar; la închidere se întoarce la comutator.
  const focusAiPanel = useRef(false)
  const setAiContainer = useCallback((el: HTMLElement | null) => {
    setAiContainerState(el)
    if (el && focusAiPanel.current) el.focus()
    focusAiPanel.current = false
  }, [])
  const setAiOpen = (open: boolean) => {
    focusAiPanel.current = open
    if (!open) document.getElementById(AI_SWITCH_ID)?.focus()
    setAiOpenState(open)
    try {
      window.localStorage.setItem(AI_PANEL_KEY, open ? 'open' : 'closed')
    } catch {
      // Stocarea poate fi blocată; alegerea rămâne valabilă cât ține pagina.
    }
  }
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

  // Filtrul dinamic (opțiuni din provider) există în context încă de la început, cu valoarea implicită: așa
  // `ctx.filters` are aceeași formă înainte și după încărcarea opțiunilor și secțiunile nu se reîncarcă degeaba.
  // FilterBar îl arată doar după ce opțiunile au venit; până atunci un parametru din URL nu are efect.
  const dynamic = module?.dynamicFilter
  const { state: dynamicState } = useAsync(
    () => (dynamic && urlBrand ? dynamic.load(providers, urlBrand.id) : Promise.resolve(null)),
    [providers, dynamic?.key, urlBrand?.id, user.role],
  )
  const dynamicOptions = dynamicState.status === 'done' ? dynamicState.value : null
  const dynamicDef = useMemo<FilterDef | null>(
    () => (dynamic ? { key: dynamic.key, label: dynamic.label, defaultValue: 'all', options: [{ value: 'all', label: dynamic.allLabel }, ...(dynamicOptions ?? []).map((o) => ({ value: o, label: o }))] } : null),
    [dynamic, dynamicOptions],
  )
  const filterDefs = useMemo<readonly FilterDef[]>(() => [...(module?.filters ?? []), ...(dynamicDef ? [dynamicDef] : [])], [module, dynamicDef])
  const visibleFilterDefs = useMemo<readonly FilterDef[]>(
    () => (dynamicDef && (!dynamicOptions || dynamicOptions.length === 0) ? (module?.filters ?? []) : filterDefs),
    [module, dynamicDef, dynamicOptions, filterDefs],
  )
  const { ctx, change, reset } = useQueryContext(urlBrand ? urlBrand.id : null, filterDefs)

  // „Date până la" și „Ultimul refresh" din starea surselor brandului curent (doar pentru un brand permis).
  const { state: sourcesState } = useAsync(
    () => (shellBrand ? providers.sources.statuses(shellBrand.id) : Promise.resolve(null)),
    [providers, shellBrand?.id, user.role],
  )
  // Actualitatea pe sursă e vizibilă și clientului (vederea `source_freshness`); starea conexiunilor, doar agenției.
  const { state: freshnessState } = useAsync(
    () => (shellBrand ? providers.sources.freshness(shellBrand.id) : Promise.resolve(null)),
    [providers, shellBrand?.id, user.role],
  )
  const freshness = freshnessState.status === 'done' && freshnessState.value?.kind === 'ready' ? freshnessState.value.data : null
  const { dataAsOf, lastRefreshAt } = useMemo(() => {
    const fresh = (freshness ?? []).map((f) => f.data_as_of).filter((d): d is string => !!d).sort()
    if (sourcesState.status !== 'done' || sourcesState.value?.kind !== 'ready') return { dataAsOf: fresh[0] ?? null, lastRefreshAt: null }
    const live = sourcesState.value.data.filter((s) => s.state !== 'not_connected')
    const dates = live.map((s) => s.data_as_of).filter((d): d is string => !!d).sort()
    const imports = live.map((s) => s.imported_at).filter((d): d is string => !!d).sort()
    // Clientul nu vede conexiunile, deci „Date până la" îi vine din actualitatea surselor.
    return { dataAsOf: dates[0] ?? fresh[0] ?? null, lastRefreshAt: imports[imports.length - 1] ?? null }
  }, [sourcesState, freshness])

  const title = module?.title ?? adminModule?.title ?? (siteMatch ? 'Site și surse' : isPortfolio ? 'Portofoliu' : 'Analyzator')
  const subtitle = module?.subtitle(shellBrand?.name ?? '') ?? adminModule?.subtitle(shellBrand?.name ?? null) ?? (siteMatch ? 'Detaliile site-ului, sursele lui de date și istoricul sincronizărilor.' : isPortfolio ? 'Toate brandurile la care ai acces, pe aceeași perioadă, cu indicatorii din Overview.' : undefined)
  useEffect(() => {
    document.title = [title, shellBrand?.name, 'Analyzator'].filter(Boolean).join(' · ')
  }, [title, shellBrand?.name])

  function onBrandChange(id: string) {
    setRemembered(id)
    writeBrand(id)
    if (urlBrandId) navigate({ pathname: brandPath(id, segment ?? 'overview'), search: sharedSearch(params) })
  }

  // `/admin/sources` trimite la site-ul ales în topbar, deci așteaptă lista de branduri.
  const needsBrand = urlBrandId !== null || isHome || isPortfolio || location.pathname === '/admin/sources'
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
    const context: LayoutContext = { user, brands, brand: urlBrand, activeBrand: shellBrand, ctx, homeBrandId, changeFilters: change, reloadBrands, selectBrand: onBrandChange, aiPanel: { open: aiOpen, setOpen: setAiOpen, container: aiContainer } }
    // Starea datelor apare pe fiecare modul de brand care depinde de surse; cât nu se poate citi, nu ocupă loc.
    // Structura rămâne aceeași cu sau fără fâșie, ca pagina să nu se remonteze (și să nu-și reia cererile) când apare.
    const showFreshness = module && urlBrand && module.sources.length > 0 && freshnessState.status !== 'failed' && (freshnessState.status === 'loading' || freshness !== null)
    content = (
      <div className="flex min-w-0 flex-col gap-5">
        {showFreshness ? <ModuleFreshness sources={module.sources} freshness={freshness} syncedAt={lastRefreshAt} /> : null}
        {/* `key` pe rol: la comutarea rolului în previzualizare, ecranele se reîncarcă cu datele noului rol. */}
        <Outlet key={user.role} context={context} />
      </div>
    )
  }

  return (
    <AppShell
      user={user}
      brands={brandsResult}
      brandId={shellBrand?.id ?? null}
      onBrandChange={onBrandChange}
      title={module?.headline ?? title}
      eyebrow={module?.headline ? `Brand Intelligence / ${module.title}` : undefined}
      actions={
        urlBrand && (module?.exportReport || module?.assistantPanel) ? (
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            {module.exportReport && (
              <Link to={{ pathname: brandPath(urlBrand.id, 'reports'), search: sharedSearch(params) }} className="inline-flex h-9 items-center rounded-[10px] border border-border-strong bg-surface px-3 text-[13px] font-semibold hover:bg-surface-2">
                Exportă raportul
              </Link>
            )}
            {module.assistantPanel && (
              <label htmlFor={AI_SWITCH_ID} className="flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-border-strong bg-surface px-3 text-[13px] font-semibold hover:bg-surface-2">
                <input id={AI_SWITCH_ID} type="checkbox" role="switch" aria-checked={aiOpen} checked={aiOpen} onChange={(e) => setAiOpen(e.target.checked)} className="peer sr-only" />
                <span aria-hidden="true" className="relative h-5 w-9 rounded-full bg-neutral-soft transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-[var(--text-2)] after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-checked:after:bg-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2" />
                AI insights
              </label>
            )}
          </div>
        ) : undefined
      }
      rightPanel={module?.assistantPanel && urlBrand && aiOpen ? { ref: setAiContainer, onClose: () => setAiOpen(false) } : undefined}
      subtitle={subtitle || undefined}
      dataAsOf={dataAsOf}
      lastRefreshAt={lastRefreshAt}
      onSignOut={() => void signOut()}
      roleSwitcher={preview ? { role: user.role, onChange: preview.setRole } : undefined}
      filterBar={module && !module.noPeriod && ctx && urlBrand ? <FilterBar value={ctx} onChange={change} onReset={reset} filterDefs={visibleFilterDefs} /> : undefined}
    >
      {content}
    </AppShell>
  )
}
