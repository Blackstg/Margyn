'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function InstallHandler() {
  const router   = useRouter()
  const params   = useSearchParams()
  const code     = params.get('code')
  const shop     = params.get('shop')

  useEffect(() => {
    if (code && shop) {
      // Forward OAuth params to callback
      router.replace(`/api/shopify/oauth/callback?${params.toString()}`)
    } else {
      router.replace('/dashboard')
    }
  }, [code, shop, params, router])

  return (
    <div className="min-h-screen bg-[#faf9f8] flex items-center justify-center">
      <p className="text-sm text-[#6b6b63]">Installation en cours…</p>
    </div>
  )
}

export default function InstallPage() {
  return (
    <Suspense>
      <InstallHandler />
    </Suspense>
  )
}
