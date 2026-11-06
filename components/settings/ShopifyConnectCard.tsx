'use client'

// Connexion Shopify de la marque : état + bouton (re)connecter. Le jeton est
// rangé chiffré par le callback, jamais affiché.
import { useEffect, useState } from 'react'

export default function ShopifyConnectCard({ brand }: { brand: string }) {
  const [state, setState] = useState<{ shop: string | null; connected: boolean } | null>(null)
  const [shop, setShop] = useState('')

  useEffect(() => {
    fetch(`/api/shopify/oauth/start?brand=${brand}&status=1`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) { setState(d); setShop(d.shop ?? '') } })
      .catch(() => {})
  }, [brand])

  if (!state) return null
  const href = `/api/shopify/oauth/start?brand=${brand}&shop=${encodeURIComponent(shop.trim().toLowerCase())}`
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-[#1a1a18]">Connexion Shopify</p>
        <p className="text-xs text-[#6b6b63] mt-0.5">
          {state.connected ? <span className="text-[#1a7f4b] font-semibold">✓ Connectée</span> : <span className="text-[#b45309] font-semibold">Non connectée</span>}
          {state.shop && <> · {state.shop}</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!state.shop && (
          <input value={shop} onChange={e => setShop(e.target.value)} placeholder="boutique.myshopify.com"
            className="rounded-[10px] border border-[#d9d9d3] px-2.5 py-1.5 text-sm" />
        )}
        <a href={href} className="rounded-xl bg-[#1a1a2e] px-4 py-2 text-sm font-semibold text-white">
          {state.connected ? 'Reconnecter' : 'Connecter Shopify'}
        </a>
      </div>
    </div>
  )
}
