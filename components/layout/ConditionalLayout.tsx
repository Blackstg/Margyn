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

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('sidebar_collapsed') === 'true'
    return false
  })

  useEffect(() => {
    if (isAuthPage) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      const meta          = data.user?.user_metadata
      const r             = (meta?.role as string | undefined) ?? 'admin'
      const deliveryViews = meta?.delivery_views as string[] | undefined
      // Treat as delivery (no sidebar) if role is 'delivery' OR if user only has livreur view
      const livreurOnly   = Array.isArray(deliveryViews) && deliveryViews.length === 1 && deliveryViews[0] === 'livreur'
      const effectiveRole = (r === 'delivery' || livreurOnly) ? 'delivery' : r
      setRole(effectiveRole)
      localStorage.setItem('bowa_role', effectiveRole)
    })
  }, [isAuthPage])

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev
      localStorage.setItem('bowa_sidebar', String(next))
      return next
    })
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar_collapsed', String(next))
      return next
    })
  }

  if (isAuthPage) {
    return <div className="min-h-screen">{children}</div>
  }

  // Livreurs get a completely clean full-screen layout — no sidebar, no padding
  const isDelivery  = role === 'delivery'
  // While role is loading, assume delivery if on /delivery to avoid sidebar flash
  const likelyDelivery = role === null && pathname === '/delivery'

  if (isDelivery || likelyDelivery) {
    return <div className="min-h-screen">{children}</div>
  }

  const showSidebar  = sidebarOpen
  const sidebarWidth = showSidebar ? (collapsed ? 72 : 240) : 0

  return (
    <>
      <Sidebar
        isOpen={showSidebar}
        onToggle={toggleSidebar}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      {/* Floating burger when sidebar is closed */}
      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-4 left-4 z-40 w-9 h-9 bg-[#1a1a2e] rounded-xl flex items-center justify-center text-white/60 hover:text-white transition-colors shadow-lg"
        >
          <Menu size={18} strokeWidth={1.8} />
        </button>
      )}

      <div
        className="min-h-screen transition-all duration-200"
        style={{ paddingLeft: sidebarWidth }}
      >
        {children}
      </div>
    </>
  )
}
