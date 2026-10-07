import {
  BuildingsIcon,
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  ChartLineUpIcon,
  ChatCircleTextIcon,
  EarIcon,
  MagnifyingGlassIcon,
  MegaphoneSimpleIcon,
  MoonIcon,
  NotebookIcon,
  PlugsConnectedIcon,
  ScalesIcon,
  SlidersHorizontalIcon,
  SquaresFourIcon,
  SunIcon,
  UserListIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useSearchParams } from 'react-router-dom'
import type { Brand, IsoDate, IsoDateTime, ProviderResult, Role, SessionUser } from '../contracts'
import { ROLES } from '../contracts'
import { cn } from '../lib/cn'
import { formatDate, formatRelative } from '../lib/format'
import { BRAND_NAV, ROLE_LABELS, adminItemsFor, adminPath, brandPath, type NavItem } from '../lib/navigation'
import { sharedSearch } from '../lib/period'
import { useTheme } from '../theme/ThemeProvider'
import { Avatar } from './ui/Avatar'
import { Menu } from './ui/Menu'

const ICONS: Record<string, Icon> = {
  SquaresFour: SquaresFourIcon,
  ChatCircleText: ChatCircleTextIcon,
  MagnifyingGlass: MagnifyingGlassIcon,
  ChartLineUp: ChartLineUpIcon,
  MegaphoneSimple: MegaphoneSimpleIcon,
  UsersThree: UsersThreeIcon,
  Ear: EarIcon,
  Scales: ScalesIcon,
  Notebook: NotebookIcon,
  Buildings: BuildingsIcon,
  PlugsConnected: PlugsConnectedIcon,
  UserList: UserListIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
}

const SIDEBAR_KEY = 'az-sidebar'
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export interface AppShellProps {
  user: SessionUser
  /** `null` cât timp se încarcă lista de branduri. */
  brands: ProviderResult<Brand[]> | null
  brandId: string | null
  onBrandChange: (brandId: string) => void
  title: string
  subtitle?: string
  /** „Date până la" și „Ultimul refresh" ale brandului curent. */
  dataAsOf: IsoDate | null
  lastRefreshAt: IsoDateTime | null
  onSignOut: () => void
  /** Doar în modul de previzualizare: comută vederea între roluri. */
  roleSwitcher?: { role: Role; onChange: (role: Role) => void }
  filterBar?: ReactNode
  now?: Date
  children: ReactNode
}

function SidebarLink({ item, to, collapsed }: { item: NavItem; to: { pathname: string; search: string } | null; collapsed: boolean }) {
  const Glyph = ICONS[item.icon] ?? SquaresFourIcon
  const base = cn('flex h-10 items-center gap-3 rounded-[11px] text-[13.5px] font-medium transition-colors', collapsed ? 'justify-center px-0' : 'px-3')
  const content = (
    <>
      <Glyph size={18} aria-hidden="true" />
      <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
    </>
  )
  if (!to) {
    return (
      <span aria-disabled="true" title="Alege un spațiu de brand" className={cn(base, 'cursor-not-allowed text-text-3')}>
        {content}
      </span>
    )
  }
  return (
    <NavLink
      to={to}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn(base, isActive ? 'bg-[var(--nav-active)] text-text' : 'text-text-2 hover:bg-[var(--nav-hover)] hover:text-text')}
    >
      {content}
    </NavLink>
  )
}

function UserMenu({ user, roleSwitcher, onSignOut }: Pick<AppShellProps, 'user' | 'roleSwitcher' | 'onSignOut'>) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button type="button" aria-label={`Contul ${user.name}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl p-1 hover:bg-neutral-soft">
        <Avatar name={user.name} tone="accent" />
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-[13px] font-semibold">{user.name}</span>
          <span className="block text-[11.5px] text-text-2">{ROLE_LABELS[user.role]}</span>
        </span>
      </button>
      {open && (
        <div role="group" aria-label="Meniul contului" className="glass-strong absolute right-0 top-[calc(100%+6px)] z-40 w-72 rounded-xl p-3">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <Avatar name={user.name} size="lg" tone="accent" />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold">{user.name}</p>
              <p className="text-[12px] text-text-2">
                {ROLE_LABELS[user.role]}, {user.organization}
              </p>
              <p className="truncate font-mono text-[11.5px] text-text-2">{user.email}</p>
            </div>
          </div>
          {roleSwitcher && (
            <fieldset className="mt-3 border-b border-border pb-3">
              <legend className="mb-1.5 text-[12px] font-semibold text-text-2">Vezi interfața ca</legend>
              <div role="radiogroup" aria-label="Vezi interfața ca" className="flex flex-col gap-1">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={roleSwitcher.role === r}
                    onClick={() => roleSwitcher.onChange(r)}
                    className={cn('rounded-lg px-2.5 py-1.5 text-left text-[12.5px]', roleSwitcher.role === r ? 'bg-accent-soft text-accent-text' : 'hover:bg-neutral-soft')}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <button type="button" onClick={onSignOut} className="mt-2 w-full rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-neutral-soft">
            Ieși din cont
          </button>
        </div>
      )}
    </div>
  )
}

export function AppShell({ user, brands, brandId, onBrandChange, title, subtitle, dataAsOf, lastRefreshAt, onSignOut, roleSwitcher, filterBar, now, children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [params] = useSearchParams()
  const { theme, toggleTheme } = useTheme()
  const search = sharedSearch(params)
  const adminItems = adminItemsFor(user.role)

  function toggleSidebar() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(SIDEBAR_KEY, c ? 'expanded' : 'collapsed')
      } catch {
        // Stocarea poate fi blocată; starea rămâne valabilă pentru sesiune.
      }
      return !c
    })
  }

  const brandList = brands?.kind === 'ready' ? brands.data : []
  const current = brandList.find((b) => b.id === brandId) ?? null
  const themeLabel = theme === 'dark' ? 'Comută la tema deschisă' : 'Comută la tema închisă'

  return (
    <div className="relative z-10 min-h-screen pt-[var(--banner-h,0px)]">
      <a href="#main" className="glass-strong sr-only z-[80] rounded-lg px-3 py-2 text-[13px] font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Sari la conținut
      </a>
      <aside
        aria-label="Navigare principală"
        className={cn('glass fixed bottom-0 left-0 top-[var(--banner-h,0px)] z-30 flex flex-col gap-1 border-y-0 border-l-0 px-3 py-4 transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-[240px]')}
      >
        <div className={cn('mb-3 flex h-11 items-center gap-2.5', collapsed ? 'justify-center' : 'px-2')}>
          <span aria-hidden="true" className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-accent-btn font-display text-[15px] font-bold text-on-accent">A</span>
          {!collapsed && <span className="font-display text-[16px] font-semibold tracking-[-0.01em]">Analyzator</span>}
        </div>
        <nav aria-label="Module" className="flex flex-col gap-0.5">
          {BRAND_NAV.map((item) => (
            <SidebarLink key={item.segment} item={item} collapsed={collapsed} to={brandId ? { pathname: brandPath(brandId, item.segment), search } : null} />
          ))}
        </nav>
        {adminItems.length > 0 && (
          <nav aria-label="Administrare" className="mt-4 flex flex-col gap-0.5 border-t border-border pt-3">
            {!collapsed && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">Administrare</p>}
            {adminItems.map((item) => (
              <SidebarLink key={item.segment} item={item} collapsed={collapsed} to={{ pathname: adminPath(item.segment), search: '' }} />
            ))}
          </nav>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Extinde bara laterală' : 'Restrânge bara laterală'}
          aria-expanded={!collapsed}
          className={cn('flex h-9 items-center gap-3 rounded-[11px] text-[13px] text-text-2 hover:bg-[var(--nav-hover)]', collapsed ? 'justify-center' : 'px-3')}
        >
          {collapsed ? <CaretDoubleRightIcon size={16} aria-hidden="true" /> : <CaretDoubleLeftIcon size={16} aria-hidden="true" />}
          {!collapsed && <span>Restrânge</span>}
        </button>
      </aside>

      <div className={cn('transition-[margin] duration-200', collapsed ? 'ml-[72px]' : 'ml-[240px]')}>
        <header className="glass sticky top-[var(--banner-h,0px)] z-20 flex h-14 items-center gap-3 border-x-0 border-t-0 px-6">
          {brands === null ? (
            <span className="h-8 w-40 rounded-lg bg-skeleton" role="status" aria-label="Se încarcă brandurile" />
          ) : brands.kind !== 'ready' ? (
            <span className="text-[13px] text-text-2" title={brands.kind === 'not_connected' ? brands.reason : brands.message}>
              {brands.kind === 'error' ? 'Nu am putut încărca brandurile' : 'Niciun spațiu de brand disponibil'}
            </span>
          ) : brandList.length === 0 ? (
            <span className="text-[13px] text-text-2">Nu ai acces la niciun spațiu de brand</span>
          ) : (
            <Menu
              label="Spațiu de brand"
              value={brandId ?? ''}
              options={brandList.map((b) => ({ value: b.id, label: b.name, hint: b.category ?? undefined }))}
              onSelect={onBrandChange}
              triggerClassName="h-9 rounded-[10px] px-2.5 text-[13.5px] font-semibold hover:bg-neutral-soft"
              trigger={
                <>
                  <Avatar name={current?.name ?? '?'} size="sm" tone="lav" />
                  <span>{current?.name ?? 'Alege brandul'}</span>
                </>
              }
            />
          )}
          <span className="flex-1" />
          <p className="hidden text-[12px] text-text-2 md:block">
            {dataAsOf || lastRefreshAt ? (
              <>
                {dataAsOf && (
                  <>
                    Date până la <span className="font-mono text-[11.5px] text-text">{formatDate(dataAsOf)}</span>
                  </>
                )}
                {dataAsOf && lastRefreshAt && <span aria-hidden="true"> · </span>}
                {lastRefreshAt && (
                  <>
                    Ultimul refresh <span className="text-text">{formatRelative(lastRefreshAt, now)}</span>
                  </>
                )}
              </>
            ) : (
              'Nicio sursă nu a importat date încă'
            )}
          </p>
          <button type="button" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel} className="grid size-9 place-items-center rounded-[11px] text-text hover:bg-neutral-soft">
            {theme === 'dark' ? <SunIcon size={18} aria-hidden="true" /> : <MoonIcon size={18} aria-hidden="true" />}
          </button>
          <UserMenu user={user} roleSwitcher={roleSwitcher} onSignOut={onSignOut} />
        </header>

        <main id="main" tabIndex={-1} className="mx-auto flex max-w-[1440px] flex-col gap-5 px-6 pb-12 pt-5 outline-none">
          <div>
            <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="mt-1 max-w-[72ch] text-[14px] leading-normal text-text-2">{subtitle}</p>}
          </div>
          {filterBar}
          {children}
        </main>
      </div>
    </div>
  )
}
