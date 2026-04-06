'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutDashboard, BarChart2, PackageOpen, Settings, LogOut, Boxes, FileText, Tag } from 'lucide-react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { useState, useEffect } from 'react'

const NAV = [
  { href: '/dashboard',            icon: LayoutDashboard, label: 'Dashboard'      },
  { href: '/campaigns',            icon: BarChart2,        label: 'Campagnes'      },
  { href: '/reapprovisionnement',  icon: PackageOpen,      label: 'Réappro'        },
  { href: '/reconciliation-stock',    icon: Boxes,     label: 'Réconciliation'  },
  { href: '/factures-logisticien',    icon: FileText,  label: 'Factures logo'   },
  { href: '/produits',                icon: Tag,       label: 'Produits'        },
  { href: '/settings',                icon: Settings,  label: 'Paramètres'      },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const [pendingCount, setPendingCount] = useState(0)

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
    <aside className="fixed top-0 left-0 h-screen w-[72px] bg-[#1a1a2e] flex flex-col items-center py-5 z-30">
      {/* Logo */}
      <div className="mb-8 flex items-center justify-center w-full">
        <span
          className="select-none text-white"
          style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-1px', fontFamily: 'var(--font-bricolage)' }}
        >
          S
        </span>
      </div>

      {/* Divider */}
      <div className="w-9 h-px bg-white/10 mb-5" />

      {/* Nav */}
      <nav className="flex flex-col items-center gap-1.5 w-full px-2">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href)
          const badge  = href === '/reconciliation-stock' && pendingCount > 0
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

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="group relative mt-auto w-11 h-11 rounded-xl flex items-center justify-center text-white/35 hover:text-[#c9c6e8] hover:bg-[#aeb0c9]/12 transition-all cursor-pointer"
      >
        <LogOut size={20} strokeWidth={1.8} />
        <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
          Déconnexion
        </span>
      </button>
    </aside>
  )
}
