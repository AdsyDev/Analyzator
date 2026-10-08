import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { canAccessAdmin, adminItemsFor, brandPath } from '../lib/navigation'
import { AppLayout, useLayout } from './AppLayout'
import { LoginPage } from './LoginPage'
import { ADMIN_MODULES, BRAND_MODULES } from './modules'
import { AdminPlaceholder, ModulePlaceholder, NotFoundPage } from './pages'
import { RequireAuth } from './RequireAuth'
import { AiPage } from '../screens/ai/AiPage'
import { OverviewPage } from '../screens/overview/OverviewPage'
import { SeoPage } from '../screens/seo/SeoPage'

/** `/`: spre Overview-ul ultimului brand permis (sau al primului). Fără brand permis, AppLayout arată mesajul. */
function HomeRedirect() {
  const { homeBrandId } = useLayout()
  return homeBrandId ? <Navigate to={brandPath(homeBrandId, 'overview')} replace /> : null
}

function BrandIndexRedirect() {
  const { brandId } = useParams()
  return <Navigate to={brandPath(brandId ?? '', 'overview')} replace />
}

function BrandModulePage() {
  const { segment } = useParams()
  const { brand, user } = useLayout()
  const module = segment ? BRAND_MODULES[segment] : undefined
  if (!module || !brand) return <NotFoundPage />
  // Ecranele construite înlocuiesc placeholder-ul; restul (UI-3…UI-6) rămân pe starea reală a surselor.
  if (module.segment === 'overview') return <OverviewPage />
  if (module.segment === 'ai') return <AiPage />
  if (module.segment === 'seo') return <SeoPage />
  return <ModulePlaceholder module={module} brand={brand} role={user.role} />
}

/**
 * Administrare: doar rolurile din `ADMIN_NAV`. Clientul (și orice rol fără acces) e redirecționat,
 * fără să afle dacă pagina există. Autoritatea rămâne RLS; garda e doar comoditate de interfață.
 */
function AdminModulePage() {
  const { segment } = useParams()
  const { user } = useLayout()
  const module = segment ? ADMIN_MODULES[segment] : undefined
  // Fără acces la Administrare (sau la această pagină): redirect, fără să confirmi dacă pagina există.
  if (adminItemsFor(user.role).length === 0 || (module && !canAccessAdmin(user.role, module.segment))) return <Navigate to="/" replace />
  return module ? <AdminPlaceholder module={module} /> : <NotFoundPage />
}

function AdminIndexRedirect() {
  const { user } = useLayout()
  const first = adminItemsFor(user.role)[0]
  return <Navigate to={first ? `/admin/${first.segment}` : '/'} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRedirect />} />
          <Route path="brands/:brandId" element={<BrandIndexRedirect />} />
          <Route path="brands/:brandId/:segment" element={<BrandModulePage />} />
          <Route path="admin" element={<AdminIndexRedirect />} />
          <Route path="admin/:segment" element={<AdminModulePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
