'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'
import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/auth-helpers-nextjs'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname()
  const isAuthPage = pathname === '/login' || pathname === '/reconciliation'
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    if (isAuthPage) return
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.auth.getUser().then(({ data }) => {
      setRole((data.user?.user_metadata?.role as string | undefined) ?? 'admin')
    })
  }, [isAuthPage])

  if (isAuthPage) {
    return <div className="min-h-screen">{children}</div>
  }

  const hasSidebar = role !== 'delivery'

  return (
    <>
      <Sidebar />
      <div className={`${hasSidebar ? 'pl-[72px]' : ''} min-h-screen`}>{children}</div>
    </>
  )
}
