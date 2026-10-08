import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { canAccessAdmin, adminItemsFor, brandPath } from '../lib/navigation'
import { AppLayout, useLayout } from './AppLayout'
import { LoginPage } from './LoginPage'
import { ADMIN_MODULES, BRAND_MODULES } from './modules'
import { AdminPlaceholder, NotFoundPage } from './pages'
import { RequireAuth } from './RequireAuth'
import { ConfigPage } from '../screens/admin/ConfigPage'
import { SourcesPage } from '../screens/admin/SourcesPage'
import { UsersPage } from '../screens/admin/UsersPage'
import { InsightsPage } from '../screens/insights/InsightsPage'
import { AiPage } from '../screens/ai/AiPage'
import { CompetitionPage } from '../screens/competition/CompetitionPage'
import { ListeningPage } from '../screens/listening/ListeningPage'
import { OverviewPage } from '../screens/overview/OverviewPage'
import { PaidPage } from '../screens/paid/PaidPage'
import { SeoPage } from '../screens/seo/SeoPage'
import { SocialPage } from '../screens/social/SocialPage'
import { TrafficPage } from '../screens/traffic/TrafficPage'

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
  const { brand } = useLayout()
  const module = segment ? BRAND_MODULES[segment] : undefined
  if (!module || !brand) return <NotFoundPage />
  // Ecranele construite înlocuiesc placeholder-ul; restul (UI-3…UI-6) rămân pe starea reală a surselor.
  if (module.segment === 'overview') return <OverviewPage />
  if (module.segment === 'ai') return <AiPage />
  if (module.segment === 'seo') return <SeoPage />
  if (module.segment === 'traffic') return <TrafficPage />
  if (module.segment === 'paid') return <PaidPage />
  if (module.segment === 'social') return <SocialPage />
  if (module.segment === 'listening') return <ListeningPage />
  if (module.segment === 'competition') return <CompetitionPage />
  if (module.segment === 'insights') return <InsightsPage />
  return <NotFoundPage />
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
  if (module?.segment === 'sources') return <SourcesPage />
  if (module?.segment === 'users') return <UsersPage />
  if (module?.segment === 'config') return <ConfigPage />
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
