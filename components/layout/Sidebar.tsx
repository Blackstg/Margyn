'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, BarChart2, PackageOpen, Settings, LogOut,
  Boxes, FileText, Tag, Truck, Headphones, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useState, useEffect } from 'react'
import DataFreshness from './DataFreshness'

// ─── Nav definition ───────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  {
    label: 'Analyse',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard',  brand: null   },
      { href: '/campaigns', icon: BarChart2,       label: 'Campagnes',  brand: null   },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { href: '/reorder',  icon: PackageOpen, label: 'Réappro',   brand: null   },
      { href: '/delivery', icon: Truck,        label: 'Delivery',  brand: 'bowa' },
      { href: '/stock',    icon: Boxes,        label: 'Stock',     brand: 'moom' },
      { href: '/invoices', icon: FileText,     label: 'Factures',  brand: 'moom' },
      { href: '/products', icon: Tag,          label: 'Produits',  brand: 'moom' },
    ],
  },
  {
    label: 'Support',
    items: [
      { href: '/sav',      icon: Headphones, label: 'SAV Mōom',    brand: 'moom' },
      { href: '/sav-krom', icon: Headphones, label: 'SAV Krom',     brand: 'krom' },
    ],
  },
]

// ─── Brand config ─────────────────────────────────────────────────────────────

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
  const [allowedBrands, setAllowedBrands] = useState<string[] | null>(null)
  const [role, setRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('bowa_role')
    return null
  })
  const [currentBrand, setCurrentBrandState] = useState<string>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('steero_brand') ?? 'bowa'
    return 'bowa'
  })

  function selectBrand(b: string) {
    setCurrentBrandState(b)
    localStorage.setItem('steero_brand', b)
    window.dispatchEvent(new CustomEvent('steero:brand', { detail: b }))
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const meta = data.user?.user_metadata
      const r = (meta?.role as string | undefined) ?? 'admin'
      setRole(r)
      localStorage.setItem('bowa_role', r)
    })
    supabase.from('user_brands').select('brand').then(({ data }) => {
      if (data) setAllowedBrands(data.map((r: { brand: string }) => r.brand))
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

  const isAdmin = role !== 'delivery' && role !== 'sav'
  const showBrandSelector = isAdmin && allowedBrands && allowedBrands.length > 1

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
            // Collapsed: stacked small avatars
            <div className="flex flex-col items-center gap-1.5">
              {allowedBrands!.map(b => (
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
            // Expanded: full brand pills
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25 px-2 mb-2">Marque</p>
              {allowedBrands!.map(b => (
                <button
                  key={b}
                  onClick={() => selectBrand(b)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
                    currentBrand === b
                      ? 'bg-white/10 text-white'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg overflow-hidden shrink-0 ring-1 transition-all ${
                    currentBrand === b ? 'ring-[#aeb0c9]/60' : 'ring-white/10'
                  }`}>
                    {BRAND_LOGOS[b]
                      ? <img src={BRAND_LOGOS[b]} alt={b} className="w-full h-full object-cover" />
                      : <span className="w-full h-full bg-[#aeb0c9]/30 flex items-center justify-center text-white text-[10px] font-bold">{b[0].toUpperCase()}</span>
                    }
                  </div>
                  <span className="text-sm font-medium">{BRAND_LABELS[b] ?? b}</span>
                  {currentBrand === b && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#aeb0c9] shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div className="mx-4 h-px bg-white/[0.07] mb-3" />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 space-y-5 pb-4">
        {role === null ? null : NAV_SECTIONS.map(section => {
          const items = section.items.filter(({ href, brand }) => {
            if (role === 'delivery') return href === '/delivery'
            if (role === 'sav')     return href === '/sav' || href === '/sav-krom' || href === '/delivery'
            // brand:null = page multi-brand, toujours visible
            // brand spécifique = seulement si c'est la brand sélectionnée (et accessible)
            if (brand === null) return true
            return brand === currentBrand && (allowedBrands === null || allowedBrands.includes(brand))
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
                {items.map(({ href, icon: Icon, label }) => {
                  const active = pathname.startsWith(href)
                  const badge  = href === '/stock' && pendingCount > 0

                  return collapsed ? (
                    <div key={href} className="flex justify-center">
                      <Link
                        href={href}
                        className={`group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                          active ? 'bg-[#aeb0c9]/20 text-[#c9c6e8]' : 'text-white/35 hover:text-[#c9c6e8] hover:bg-white/8'
                        }`}
                      >
                        <Icon size={20} strokeWidth={1.6} />
                        {badge && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#c7293a]" />}
                        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg z-50">
                          {label}{badge ? ` (${pendingCount})` : ''}
                        </span>
                      </Link>
                    </div>
                  ) : (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
                        active
                          ? 'bg-[#aeb0c9]/15 text-white'
                          : 'text-white/45 hover:text-white/80 hover:bg-white/5'
                      }`}
                    >
                      <Icon size={18} strokeWidth={1.6} className="shrink-0" />
                      <span className="text-sm font-medium">{label}</span>
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
                href="/settings"
                className={`group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                  pathname.startsWith('/settings') ? 'bg-[#aeb0c9]/20 text-[#c9c6e8]' : 'text-white/35 hover:text-[#c9c6e8] hover:bg-white/8'
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
              href="/settings"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                pathname.startsWith('/settings') ? 'bg-[#aeb0c9]/15 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/5'
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
