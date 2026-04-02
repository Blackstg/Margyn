'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function InstallHandler() {
  const params  = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'debug'>('loading')
  const [token,  setToken]  = useState<string | null>(null)
  const [debug,  setDebug]  = useState<Record<string, string>>({})

  useEffect(() => {
    const allParams = Object.fromEntries(params.entries())
    setDebug(allParams)

    const code     = params.get('code')
    const shop     = params.get('shop')
    const idToken  = params.get('id_token')

    // Case 1 — standard OAuth code
    if (code && shop) {
      window.location.href = `/api/shopify/oauth/callback?${params.toString()}`
      return
    }

    // Case 2 — embedded app session token exchange
    if (idToken && shop) {
      fetch('/api/shopify/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop, id_token: idToken }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.access_token) {
            setToken(data.access_token)
            setStatus('success')
          } else {
            setStatus('debug')
          }
        })
        .catch(() => setStatus('error'))
      return
    }

    // Case 3 — no useful params, show debug
    setStatus('debug')
  }, [params])

  if (status === 'success' && token) {
    return (
      <div style={{ fontFamily: 'monospace', padding: 40, background: '#faf9f8' }}>
        <h2 style={{ color: '#1a7f4b' }}>✓ Token obtenu</h2>
        <p>Ajoute dans Vercel env vars :</p>
        <pre style={{ background: '#1a1a2e', color: '#dcf5e7', padding: 20, borderRadius: 12, wordBreak: 'break-all' }}>
          SHOPIFY_KROM_ACCESS_TOKEN={token}
        </pre>
      </div>
    )
  }

  if (status === 'debug') {
    return (
      <div style={{ fontFamily: 'monospace', padding: 40, background: '#faf9f8' }}>
        <h2>Params reçus de Shopify :</h2>
        <pre style={{ background: '#1a1a2e', color: '#dcf5e7', padding: 20, borderRadius: 12 }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 40, background: '#faf9f8' }}>
      <p>{status === 'error' ? 'Erreur lors de l\'échange.' : 'Connexion en cours…'}</p>
      <pre style={{ background: '#1a1a2e', color: '#dcf5e7', padding: 20, borderRadius: 12 }}>
        {JSON.stringify(debug, null, 2)}
      </pre>
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
