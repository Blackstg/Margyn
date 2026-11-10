'use client'

// Connexion Shopify de la marque : état + bouton (re)connecter, et en option l'app
// Shopify custom propre à la marque (tant que l'app publique Steero n'est pas
// validée). Jetons et secrets sont rangés chiffrés côté serveur, jamais réaffichés.
import { useCallback, useEffect, useState } from 'react'

type Status = { shop: string | null; connected: boolean; customClientId: string | null }

const input = 'rounded-[10px] border border-[#d9d9d3] px-2.5 py-1.5 text-sm'

export default function ShopifyConnectCard({ brand }: { brand: string }) {
  const [state, setState] = useState<Status | null>(null)
  const [shop, setShop] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch(`/api/shopify/oauth/start?brand=${brand}&status=1`)
      .then(r => (r.ok ? r.json() : null))
      .then((d: Status | null) => { if (d) { setState(d); setShop(d.shop ?? ''); setClientId(d.customClientId ?? '') } })
      .catch(() => {})
  }, [brand])
  useEffect(load, [load])

  async function saveApp() {
    setBusy(true); setMsg(null)
    const r = await fetch('/api/shopify/app-credentials', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand, clientId, clientSecret: secret }),
    })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? { ok: true, text: 'App enregistrée — clique sur « Connecter Shopify ».' } : { ok: false, text: d.error ?? 'Erreur' })
    setSecret(''); setBusy(false)
    if (r.ok) load()
  }

  if (!state) return null
  const href = `/api/shopify/oauth/start?brand=${brand}&shop=${encodeURIComponent(shop.trim().toLowerCase())}`
  return (
    <div className="rounded-2xl border border-[#e8e8e4] bg-white px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#1a1a18]">Connexion Shopify</p>
          <p className="text-xs text-[#6b6b63] mt-0.5">
            {state.connected ? <span className="text-[#1a7f4b] font-semibold">✓ Connectée</span> : <span className="text-[#b45309] font-semibold">Non connectée</span>}
            {state.shop && <> · {state.shop}</>}
            {' · '}{state.customClientId ? 'app dédiée' : 'app Steero'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!state.shop && (
            <input value={shop} onChange={e => setShop(e.target.value)} placeholder="boutique.myshopify.com" className={input} />
          )}
          <a href={href} className="rounded-xl bg-[#1a1a2e] px-4 py-2 text-sm font-semibold text-white">
            {state.connected ? 'Reconnecter' : 'Connecter Shopify'}
          </a>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-[#6b6b63]">App Shopify dédiée à cette marque (optionnel)</summary>
        <p className="mt-2 text-xs text-[#6b6b63]">
          À utiliser seulement si la boutique ne peut pas encore installer l’app Steero publique :
          crée une app dans dev.shopify.com (organisation de la boutique), App URL <code>https://www.steero.io/install</code>,
          redirection <code>https://www.steero.io/api/shopify/oauth/callback</code>, puis colle ses identifiants ici.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="ID client" className={`${input} w-72 font-mono`} />
          <input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Secret client" className={`${input} w-56`} />
          <button disabled={busy || !clientId || !secret} onClick={saveApp}
            className="rounded-xl border border-[#1a1a2e] px-3 py-1.5 text-sm font-semibold text-[#1a1a2e] disabled:opacity-40">Enregistrer</button>
        </div>
        {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[#1a7f4b]' : 'text-[#b42318]'}`}>{msg.text}</p>}
      </details>
    </div>
  )
}
