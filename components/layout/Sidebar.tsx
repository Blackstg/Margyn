'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, BarChart2, PackageOpen, Settings, LogOut, Boxes, FileText, Tag, Truck, PanelLeftClose } from 'lucide-react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useState, useEffect } from 'react'
import DataFreshness from './DataFreshness'

const NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard',   brand: null   },
  { href: '/campaigns', icon: BarChart2,       label: 'Campagnes',   brand: null   },
  { href: '/delivery',  icon: Truck,           label: 'Delivery',    brand: 'bowa' },
  { href: '/reorder',   icon: PackageOpen,     label: 'Réappro',     brand: null   },
  { href: '/stock',     icon: Boxes,           label: 'Stock',       brand: 'moom' },
  { href: '/invoices',  icon: FileText,        label: 'Factures',    brand: 'moom' },
  { href: '/products',  icon: Tag,             label: 'Produits',    brand: 'moom' },
  { href: '/settings',  icon: Settings,        label: 'Paramètres',  brand: null   },
]

export default function Sidebar({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const [pendingCount, setPendingCount] = useState(0)
  const [allowedBrands, setAllowedBrands] = useState<string[] | null>(null)
  const [role, setRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('bowa_role')
    return null
  })

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
      .then((r) => r.json())
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

  return (
    <aside className={`fixed top-0 left-0 h-screen w-[72px] bg-[#1a1a2e] flex-col items-center py-5 z-30 ${isOpen ? 'flex' : 'hidden'}`}>
      {/* Logo + toggle (toggle hidden for delivery role) */}
      <div className="mb-2 flex flex-col items-center w-full gap-2">
        <span
          className="select-none text-white"
          style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-1px', fontFamily: 'var(--font-bricolage)' }}
        >
          S
        </span>
        {role !== 'delivery' && (
          <button
            onClick={onToggle}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/8 transition-colors"
          >
            <PanelLeftClose size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* Divider */}
      <div className="w-9 h-px bg-white/10 mb-5" />

      {/* Nav */}
      <nav className="flex flex-col items-center gap-1.5 w-full px-2">
        {role === null ? null : NAV.filter(({ href, brand }) => {
          if (role === 'delivery') return href === '/delivery'
          return brand === null || allowedBrands === null || allowedBrands.includes(brand)
        }).map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          const badge  = href === '/stock' && pendingCount > 0
          return (
            <Link
              key={href}
              href={href}
              className={`group relative w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                active
                  ? 'bg-[#aeb0c9]/25 text-[#c9c6e8]'
                  : 'text-white/35 hover:text-[#c9c6e8] hover:bg-[#aeb0c9]/12'
              }`}
            >
              <Icon size={20} strokeWidth={1.8} />
              {badge && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#c7293a]" />
              )}
              <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                {label}{badge ? ` (${pendingCount})` : ''}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom actions: freshness + logout */}
      <div className="mt-auto flex flex-col items-center gap-1">
        <DataFreshness />

        <button
          onClick={handleLogout}
          className="group relative w-11 h-11 rounded-xl flex items-center justify-center text-white/35 hover:text-[#c9c6e8] hover:bg-[#aeb0c9]/12 transition-all cursor-pointer"
        >
          <LogOut size={20} strokeWidth={1.8} />
          <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
            Déconnexion
          </span>
        </button>
      </div>
    </aside>
  )
}
