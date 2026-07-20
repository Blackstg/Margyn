'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, BarChart2, PackageOpen, Settings, LogOut,
  Boxes, FileText, Tag, Truck, Headphones, ChevronLeft, ChevronRight, ChevronDown, Sparkles, Receipt, PackageX, Users,
} from 'lucide-react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useState, useEffect } from 'react'
import DataFreshness from './DataFreshness'
import { effectiveFeatures, effectiveBrands, isAdminRole, isOwner, BRAND_LOCK } from '@/lib/access'

// ─── Brand config ─────────────────────────────────────────────────────────────

const VALID_BRANDS = ['bowa', 'moom', 'krom']

const BRAND_LOGOS: Record<string, string> = {
  bowa: 'https://cdn.shopify.com/s/files/1/0617/2806/3648/files/profil.png?v=1693451968',
  moom: 'https://cdn.shopify.com/s/files/1/0506/0689/9391/files/moom-profil.png?v=1682403928',
  krom: 'https://cdn.shopify.com/s/files/1/0590/8755/2558/files/favicon.png?v=1764213860',
}

const BRAND_LABELS: Record<string, string> = {
  bowa: 'Bowa',
  moom: 'Mōom Paris',
  krom: 'Krom Water',
}

// Pages accessible to all brands — link uses current brand
import type { LucideProps } from 'lucide-react'

type NavItem = {
  key:       string
  icon:      React.ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>>
  label:     string
  brandLock: string | null
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Analyse',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, label: 'Dashboard',  brandLock: null   },
      { key: 'campaigns', icon: BarChart2,        label: 'Campagnes',  brandLock: null   },
      { key: 'creatives', icon: Sparkles,         label: 'Créatives',  brandLock: null   },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { key: 'reorder',   icon: PackageOpen, label: 'Réappro',      brandLock: null   },
      { key: 'billing',   icon: Receipt,      label: 'Facturation', brandLock: null   },
      { key: 'delivery',  icon: Truck,        label: 'Delivery',    brandLock: 'bowa' },
      { key: 'stock',     icon: Boxes,        label: 'Stock',       brandLock: 'moom' },
      { key: 'invoices',  icon: FileText,     label: 'Factures',    brandLock: 'moom' },
      { key: 'products',  icon: Tag,          label: 'Produits',    brandLock: 'moom' },
    ],
  },
  {
    label: 'Support',
    items: [
      { key: 'sav',         icon: Headphones, label: 'SAV Mōom', brandLock: 'moom' },
      { key: 'sav-defects', icon: PackageX,   label: 'Défauts',  brandLock: 'moom' },
      { key: 'sav-krom',    icon: Headphones, label: 'SAV Krom', brandLock: 'krom' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { key: 'users', icon: Users, label: 'Accès', brandLock: null },
    ],
  },
]

// Pages the brand-selector can jump to when switching brands
const BRAND_PAGES: Record<string, string[]> = {
  bowa: ['dashboard', 'campaigns', 'creatives', 'settings', 'reorder', 'billing', 'delivery'],
  moom: ['dashboard', 'campaigns', 'creatives', 'settings', 'reorder', 'billing', 'invoices', 'stock', 'products', 'sav', 'sav-defects'],
  krom: ['dashboard', 'campaigns', 'creatives', 'settings', 'reorder', 'billing', 'sav-krom'],
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SidebarProps {
  isOpen: boolean
  onToggle: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function Sidebar({ isOpen, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [pendingCount, setPendingCount]   = useState(0)
  const [brandMenuOpen, setBrandMenuOpen] = useState(false)
  const [metaBrands, setMetaBrands]       = useState<string[] | null>(null)
  const [metaFeatures, setMetaFeatures]   = useState<string[] | null>(null)
  const [role, setRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('bowa_role')
    return null
  })

  // Extract current brand from URL: /[brand]/page → brand
  const urlSegments    = pathname.split('/').filter(Boolean)
  const currentBrand   = VALID_BRANDS.includes(urlSegments[0]) ? urlSegments[0] : null
  const currentPage    = urlSegments[1] ?? 'dashboard'

  // Build href for a nav item
  function itemHref(item: NavItem): string {
    const brand = item.brandLock ?? currentBrand ?? 'bowa'
    return `/${brand}/${item.key}`
  }

  // Switch brand: keep the same section if the user can access it on the target
  // brand, otherwise the FIRST section they can access there — not 'dashboard',
  // que les utilisateurs restreints (ex. SAV) n'ont pas, sinon le middleware les
  // renvoie à leur home (souvent Bowa) → impression de « rester sur Bowa ».
  function selectBrand(b: string) {
    const featsNow = effectiveFeatures(role, metaFeatures)
    const canAccess = (key: string): boolean => {
      if (!(BRAND_PAGES[b] ?? []).includes(key)) return false
      if (featsNow === 'all') return true
      if (!(featsNow as string[]).includes(key)) return false
      const lock = BRAND_LOCK[key]
      return lock == null || lock === b
    }
    const order = BRAND_PAGES[b] ?? ['dashboard']
    const targetPage = canAccess(currentPage) ? currentPage : (order.find(canAccess) ?? order[0] ?? 'dashboard')
    router.push(`/${b}/${targetPage}`)
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata
      const r = (meta?.role as string | undefined) ?? 'admin'
      setRole(r)
      localStorage.setItem('bowa_role', r)
      setMetaBrands(Array.isArray(meta?.brands) ? (meta!.brands as string[]) : null)
      setMetaFeatures(Array.isArray(meta?.features) ? (meta!.features as string[]) : null)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetch('/api/reconciliation/history')
      .then(r => r.json())
      .then(({ reconciliations }) => {
        setPendingCount((reconciliations ?? []).filter((r: { status: string }) => r.status === 'pending').length)
      })
      .catch(() => {})
  }, [pathname])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  if (!isOpen) return null

  const isAdmin          = isAdminRole(role)
  const owner            = isOwner(role, metaBrands)  // only the owner manages access
  const allowedBrands    = effectiveBrands(role, metaBrands)  // scoped to user's brands
  const feats            = effectiveFeatures(role, metaFeatures)  // 'all' for admins
  // Brand selector shows for anyone with access to more than one brand (incl. staff)
  const showBrandSelector = allowedBrands.length > 1
  const settingsHref     = `/${currentBrand ?? 'bowa'}/settings`

  const w = collapsed ? 'w-[72px]' : 'w-[240px]'

  return (
    <aside className={`fixed top-0 left-0 h-screen ${w} bg-[#12122a] flex flex-col z-30 transition-all duration-200 border-r border-white/[0.06]`}>

      {/* ── Top: logo + app name ───────────────────────────────────────────── */}
      <div className={`flex items-center gap-3 px-4 pt-5 pb-4 ${collapsed ? 'justify-center px-0' : ''}`}>
        <div className="w-8 h-8 rounded-xl bg-[#aeb0c9]/20 flex items-center justify-center shrink-0">
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.5px', fontFamily: 'var(--font-bricolage)' }} className="text-white">
            S
          </span>
        </div>
        {!collapsed && (
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.5px', fontFamily: 'var(--font-bricolage)' }} className="text-white">
            Steero
          </span>
        )}
      </div>

      {/* ── Brand selector ────────────────────────────────────────────────── */}
      {showBrandSelector && (
        <div className={`mx-3 mb-4 ${collapsed ? 'mx-2' : ''}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-1.5">
              {allowedBrands.map(b => (
                <button key={b} onClick={() => selectBrand(b)} className="group relative">
                  <div className={`w-9 h-9 rounded-xl overflow-hidden ring-2 transition-all ${
                    currentBrand === b ? 'ring-[#aeb0c9] opacity-100' : 'ring-transparent opacity-30 hover:opacity-60'
                  }`}>
                    {BRAND_LOGOS[b]
                      ? <img src={BRAND_LOGOS[b]} alt={b} className="w-full h-full object-cover" />
                      : <span className="w-full h-full bg-[#aeb0c9]/30 flex items-center justify-center text-white text-xs font-bold">{b[0].toUpperCase()}</span>
                    }
                  </div>
                  <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
                    {BRAND_LABELS[b] ?? b}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            // Dropdown personnalisé (assorti à la sidebar) — compact + design contrôlé
            (() => {
              const cur = currentBrand && (allowedBrands as string[]).includes(currentBrand) ? currentBrand : allowedBrands[0]
              const logo = (b: string, size: string) => (
                <div className={`${size} rounded-md overflow-hidden shrink-0 ring-1 ring-[#aeb0c9]/40`}>
                  {BRAND_LOGOS[b]
                    ? <img src={BRAND_LOGOS[b]} alt={b} className="w-full h-full object-cover" />
                    : <span className="w-full h-full bg-[#aeb0c9]/30 flex items-center justify-center text-white text-[10px] font-bold">{b[0].toUpperCase()}</span>}
                </div>
              )
              return (
                <div className="relative">
                  <button
                    onClick={() => setBrandMenuOpen(o => !o)}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 transition-colors"
                  >
                    {logo(cur, 'w-6 h-6')}
                    <span className="flex-1 min-w-0 text-left text-sm font-medium text-white truncate">{BRAND_LABELS[cur] ?? cur}</span>
                    <ChevronDown size={15} className={`text-white/40 shrink-0 transition-transform ${brandMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {brandMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setBrandMenuOpen(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl bg-[#1a1a2e] ring-1 ring-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-1">
                        {allowedBrands.map(b => (
                          <button
                            key={b}
                            onClick={() => { setBrandMenuOpen(false); selectBrand(b) }}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                              b === cur ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {logo(b, 'w-6 h-6')}
                            <span className="flex-1 min-w-0 text-sm font-medium truncate">{BRAND_LABELS[b] ?? b}</span>
                            {b === cur && <span className="w-1.5 h-1.5 rounded-full bg-[#aeb0c9] shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })()
          )}
        </div>
      )}

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="mx-4 h-px bg-white/[0.07] mb-3" />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-5 pb-4">
        {role === null ? null : NAV_SECTIONS.map(section => {
          const items = section.items.filter(({ key, brandLock }) => {
            // 'users' (Accès) is owner-only
            if (key === 'users') return owner
            // Feature gate: restricted roles only see their allowed features
            if (feats !== 'all' && !(feats as string[]).includes(key)) return false
            // Shared pages: always visible
            if (brandLock === null) return true
            // Brand-locked: only visible when currently ON that brand
            return brandLock === currentBrand
          })
          if (items.length === 0) return null

          return (
            <div key={section.label}>
              {!collapsed && (
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-2 mb-1.5">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const href   = itemHref(item)
                  const active = pathname.startsWith(href)
                  const badge  = item.key === 'stock' && pendingCount > 0

                  return collapsed ? (
                    <div key={item.key} className="flex justify-center">
                      <Link
                        href={href}
                        className={`group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                          active ? 'bg-[#aeb0c9]/20 text-[#c9c6e8]' : 'text-white/35 hover:text-[#c9c6e8] hover:bg-white/8'
                        }`}
                      >
                        <item.icon size={20} strokeWidth={1.6} />
                        {badge && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#c7293a]" />}
                        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
                          {item.label}{badge ? ` (${pendingCount})` : ''}
                        </span>
                      </Link>
                    </div>
                  ) : (
                    <Link
                      key={item.key}
                      href={href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                        active
                          ? 'bg-[#aeb0c9]/15 text-white'
                          : 'text-white/45 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <item.icon size={18} strokeWidth={1.6} className="shrink-0" />
                      <span className="text-sm font-medium">{item.label}</span>
                      {badge && (
                        <span className="ml-auto min-w-[20px] h-5 px-1.5 bg-[#c7293a] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {pendingCount}
                        </span>
                      )}
                      {active && !badge && (
                        <span className="ml-auto w-1 h-4 rounded-full bg-[#aeb0c9]/60" />
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* ── Bottom ───────────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.07] p-3 space-y-1">
        <DataFreshness />

        {/* Settings */}
        {isAdmin && (
          collapsed ? (
            <div className="flex justify-center">
              <Link
                href={settingsHref}
                className={`group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                  pathname.includes('/settings') ? 'bg-[#aeb0c9]/20 text-[#c9c6e8]' : 'text-white/35 hover:text-[#c9c6e8] hover:bg-white/8'
                }`}
              >
                <Settings size={20} strokeWidth={1.6} />
                <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
                  Paramètres
                </span>
              </Link>
            </div>
          ) : (
            <Link
              href={settingsHref}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                pathname.includes('/settings') ? 'bg-[#aeb0c9]/15 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              <Settings size={18} strokeWidth={1.6} className="shrink-0" />
              <span className="text-sm font-medium">Paramètres</span>
            </Link>
          )
        )}

        {/* Logout */}
        {collapsed ? (
          <div className="flex justify-center">
            <button
              onClick={handleLogout}
              className="group relative w-11 h-11 rounded-xl flex items-center justify-center text-white/35 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <LogOut size={20} strokeWidth={1.6} />
              <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
                Déconnexion
              </span>
            </button>
          </div>
        ) : (
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/45 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={18} strokeWidth={1.6} className="shrink-0" />
            <span className="text-sm font-medium">Déconnexion</span>
          </button>
        )}

        {/* Collapse toggle */}
        {isAdmin && (
          <button
            onClick={onToggleCollapse}
            className={`transition-all text-white/20 hover:text-white/60 hover:bg-white/5 rounded-xl flex items-center justify-center ${
              collapsed ? 'w-11 h-11 mx-auto' : 'w-full h-9 gap-2'
            }`}
          >
            {collapsed ? <ChevronRight size={16} strokeWidth={1.6} /> : (
              <>
                <ChevronLeft size={14} strokeWidth={1.6} />
                <span className="text-xs">Réduire</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  )
}
