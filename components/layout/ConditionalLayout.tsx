'use client'

import { usePathname } from 'next/navigation'
import Sidebar from './Sidebar'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname   = usePathname()
  const isAuthPage = pathname === '/login'

  if (isAuthPage) {
    return <div className="min-h-screen">{children}</div>
  }

  return (
    <>
      <Sidebar />
      <div className="pl-[72px] min-h-screen">{children}</div>
    </>
  )
}
