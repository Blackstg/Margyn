'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, BarChart2, PackageOpen, Settings } from 'lucide-react'

const NAV = [
  { href: '/dashboard',           icon: LayoutDashboard, label: 'Dashboard'          },
  { href: '/campaigns',           icon: BarChart2,        label: 'Campagnes'          },
  { href: '/reapprovisionnement', icon: PackageOpen,      label: 'Réappro'            },
  { href: '/settings',            icon: Settings,         label: 'Paramètres'         },
]

export default function Sidebar() {
  const pathname = usePathname()

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
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a2e] border border-white/10 text-white text-xs font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-lg">
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
