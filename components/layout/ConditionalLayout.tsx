'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'
import { Menu } from 'lucide-react'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/reconciliation' || pathname === '/tracking'

  const [role, setRole] = useState<string | null>(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('bowa_role')
    return null
  })

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bowa_sidebar')
      return saved !== null ? saved === 'true' : true
    }
    return true
  })

  useEffect(() => {
    if (isAuthPage) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      const r = (data.user?.user_metadata?.role as string | undefined) ?? 'admin'
      setRole(r)
      localStorage.setItem('bowa_role', r)
    })
  }, [isAuthPage])

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('bowa_sidebar', String(next))
      return next
    })
  }

  if (isAuthPage) {
    return <div className="min-h-screen">{children}</div>
  }

  const isDelivery = role === 'delivery'
  const showSidebar = isDelivery || sidebarOpen

  return (
    <>
      <Sidebar isOpen={showSidebar} onToggle={toggleSidebar} />

      {/* Floating burger when sidebar is closed (never for delivery role) */}
      {!isDelivery && !sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-4 left-4 z-40 w-9 h-9 bg-[#1a1a2e] rounded-xl flex items-center justify-center text-white/60 hover:text-white transition-colors shadow-lg"
        >
          <Menu size={18} strokeWidth={1.8} />
        </button>
      )}

      <div className={`${showSidebar ? 'pl-[72px]' : ''} min-h-screen`}>
        {children}
      </div>
    </>
  )
}
