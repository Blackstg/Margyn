'use client'

import { useState, FormEvent, useEffect } from 'react'
import Image from 'next/image'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackingSettings {
  brand_name:           string
  brand_logo_url:       string
  brand_color:          string
  brand_website:        string
  contact_email:        string
  show_products:        boolean
  show_address:         boolean
  show_tracking_number: boolean
  show_tracking_link:   boolean
  estimated_days_min:   number
  estimated_days_max:   number
}

interface TrackingResult {
  order_name:      string
  created_at:      string
  customer_name:   string
  products:        { title: string; variant_title: string | null; qty: number }[]
  address:         { address1: string; address2: string; city: string; zip: string } | null
  tracking_number: string | null
  step:            number
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS = [
  { icon: '✅', label: 'Commande confirmée',     desc: 'Votre commande a bien été reçue et enregistrée.' },
  { icon: '🔄', label: 'En traitement',           desc: 'Nous préparons votre commande avec soin.' },
  { icon: '📦', label: 'Expédiée',               desc: 'Votre commande est en route\u00a0!' },
  { icon: '🚚', label: 'En cours de livraison',  desc: 'Votre colis est pris en charge par le transporteur.' },
  { icon: '✅', label: 'Livré',                  desc: 'Votre commande a bien été livrée. Merci pour votre confiance\u00a0!' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BrandTrackingPage({ params }: { params: { brand: string } }) {
  const { brand } = params

  const [settings, setSettings] = useState<TrackingSettings | null>(null)
  const [email,     setEmail]     = useState('')
  const [orderName, setOrderName] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<TrackingResult | null>(null)

  useEffect(() => {
    fetch(`/api/tracking/settings?brand=${brand}`)
      .then((r) => r.json())
      .then((d) => setSettings(d.settings))
      .catch(() => null)
  }, [brand])

  const primary  = settings?.brand_color || '#111'
  const bgColor  = `${primary}0d` // 5% opacity tint

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res  = await fetch(`/api/tracking/${brand}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim(), order_name: orderName.trim() }),
      })
      const data = await res.json() as TrackingResult & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Commande introuvable.')
      } else {
        setResult(data)
      }
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: bgColor || '#f8f8f8' }}>

      {/* ── Header ── */}
      <header style={{ backgroundColor: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)' }} className="px-6 py-4 flex justify-center">
        {settings?.brand_logo_url ? (
          <a href={settings.brand_website || '#'} target="_blank" rel="noopener noreferrer">
            <Image
              src={settings.brand_logo_url}
              alt={settings.brand_name || brand}
              width={160}
              height={48}
              style={{ objectFit: 'contain', height: 40, width: 'auto' }}
              priority
              unoptimized
            />
          </a>
        ) : (
          <span style={{ fontSize: 20, fontWeight: 800, color: primary, letterSpacing: '-0.5px' }}>
            {settings?.brand_name || brand.toUpperCase()}
          </span>
        )}
      </header>

      {/* ── Main ── */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-8 space-y-4">

        {/* Form / pill */}
        {!result ? (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6">
            <h2 className="text-[15px] font-semibold text-black mb-1">Suivi de commande</h2>
            <p className="text-sm text-black/50 mb-5">Entrez votre email et votre numéro de commande pour suivre votre livraison.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-black/50 mb-1">Adresse email</label>
                <input
                  type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  style={{ borderRadius: 10, border: '1px solid #e5e5e5', background: '#fff' }}
                  className="w-full px-4 py-2.5 text-sm outline-none focus:border-black/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black/50 mb-1">Numéro de commande</label>
                <input
                  type="text" required value={orderName} onChange={(e) => setOrderName(e.target.value)}
                  placeholder="#1234"
                  style={{ borderRadius: 10, border: '1px solid #e5e5e5', background: '#fff' }}
                  className="w-full px-4 py-2.5 text-sm outline-none focus:border-black/30 transition-colors"
                />
              </div>
              {error && (
                <p style={{ borderRadius: 10, background: '#fff3f3', color: '#c0392b' }} className="text-sm px-4 py-2.5">
                  {error}
                </p>
              )}
              <button
                type="submit" disabled={loading}
                style={{ borderRadius: 10, background: primary, color: '#fff' }}
                className="w-full py-2.5 text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                {loading ? 'Recherche…' : 'Suivre ma commande'}
              </button>
            </form>
          </div>
        ) : (
          <div
            style={{ background: '#fff', borderRadius: 12, border: '1px solid rgba(0,0,0,0.07)' }}
            className="flex items-center justify-between px-5 py-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-black">{result.order_name}</span>
              <span className="text-xs text-black/40">{email}</span>
            </div>
            <button
              onClick={() => { setResult(null); setError(null) }}
              className="text-xs text-black/40 hover:text-black transition-colors underline underline-offset-2 shrink-0"
            >
              Autre commande
            </button>
          </div>
        )}

        {result && (
          <>
            {/* Order summary */}
            <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-black/40 mb-0.5">Commande</p>
                  <p className="font-semibold text-black text-lg">{result.order_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-black/40 mb-0.5">Date</p>
                  <p className="text-sm text-black">{fmtDate(result.created_at)}</p>
                </div>
              </div>

              {/* Estimated delivery */}
              {result.step < 5 && settings && (
                <>
                  <hr style={{ borderColor: 'rgba(0,0,0,0.05)' }} />
                  <div style={{ background: bgColor, borderRadius: 12 }} className="px-4 py-3">
                    <p className="text-xs font-semibold text-black/50 uppercase tracking-wide mb-0.5">Livraison estimée</p>
                    <p className="text-sm font-semibold text-black">
                      {addDays(result.created_at, settings.estimated_days_min)} — {addDays(result.created_at, settings.estimated_days_max)}
                    </p>
                  </div>
                </>
              )}

              {settings?.show_products && (
                <>
                  <hr style={{ borderColor: 'rgba(0,0,0,0.05)' }} />
                  <div>
                    <p className="text-xs font-semibold text-black/40 mb-2 uppercase tracking-wide">Produits commandés</p>
                    <ul className="space-y-1.5">
                      {result.products.map((p, i) => (
                        <li key={i} className="flex items-start justify-between gap-2 text-sm">
                          <span className="text-black">
                            {p.title}
                            {p.variant_title && <span className="text-black/40"> — {p.variant_title}</span>}
                          </span>
                          <span className="shrink-0 text-black/50 font-medium">×{p.qty}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {settings?.show_address && result.address && (
                <>
                  <hr style={{ borderColor: 'rgba(0,0,0,0.05)' }} />
                  <div>
                    <p className="text-xs font-semibold text-black/40 mb-1 uppercase tracking-wide">Adresse de livraison</p>
                    <p className="text-sm text-black">{result.customer_name}</p>
                    <p className="text-sm text-black/60">{result.address.address1}</p>
                    {result.address.address2 && <p className="text-sm text-black/60">{result.address.address2}</p>}
                    <p className="text-sm text-black/60">{result.address.zip} {result.address.city}</p>
                  </div>
                </>
              )}
            </div>

            {/* Tracking number */}
            {settings?.show_tracking_number && result.tracking_number && (
              <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6 space-y-3">
                <p className="text-xs font-semibold text-black/40 uppercase tracking-wide">Numéro de suivi transporteur</p>
                <p className="font-mono font-semibold text-black text-base tracking-widest">{result.tracking_number}</p>
                {settings.show_tracking_link && (
                  <a
                    href={`https://t.17track.net/fr#nums=${result.tracking_number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ borderRadius: 10, background: primary, color: '#fff' }}
                    className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    Suivre mon colis
                  </a>
                )}
              </div>
            )}

            {/* Timeline */}
            <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6">
              <p className="text-xs font-semibold text-black/40 mb-5 uppercase tracking-wide">Progression</p>
              <ol>
                {STEPS.map((s, i) => {
                  const stepNum   = i + 1
                  const isDone    = stepNum < result.step
                  const isCurrent = stepNum === result.step

                  return (
                    <li key={i} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div
                          style={{
                            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 14,
                            background: isDone ? '#eaf7f0' : isCurrent ? primary : 'rgba(0,0,0,0.05)',
                            color:      isDone ? '#27ae60' : isCurrent ? '#fff'   : 'rgba(0,0,0,0.2)',
                            boxShadow:  isCurrent ? `0 0 0 4px ${primary}22` : 'none',
                          }}
                        >
                          {isDone ? '✓' : s.icon}
                        </div>
                        {i < STEPS.length - 1 && (
                          <div
                            style={{
                              width: 1, flexGrow: 1, minHeight: 24, margin: '4px 0',
                              background: isDone ? '#b5e8cf' : 'rgba(0,0,0,0.08)',
                            }}
                          />
                        )}
                      </div>

                      <div className={`flex-1 min-w-0 ${i < STEPS.length - 1 ? 'pb-5' : ''}`}>
                        <p
                          style={{
                            fontSize: 14, fontWeight: 600, lineHeight: 1.3,
                            color: isCurrent ? '#111' : isDone ? '#27ae60' : 'rgba(0,0,0,0.28)',
                          }}
                        >
                          {s.label}
                        </p>
                        {(isCurrent || isDone) && (
                          <p style={{ fontSize: 12, marginTop: 2, lineHeight: 1.5, color: isCurrent ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.35)' }}>
                            {s.desc}
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ backgroundColor: '#fff', borderTop: '1px solid rgba(0,0,0,0.06)' }} className="px-6 py-5 text-center space-y-1">
        <p className="text-xs text-black/40">© {settings?.brand_name || brand}</p>
        {settings?.brand_website && (
          <a
            href={settings.brand_website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-black/50 hover:text-black transition-colors underline underline-offset-2 block"
          >
            Retour au site
          </a>
        )}
        {settings?.contact_email && (
          <p className="text-xs text-black/30 pt-1">
            Des questions ?{' '}
            <a href={`mailto:${settings.contact_email}`} className="underline">
              {settings.contact_email}
            </a>
          </p>
        )}
      </footer>
    </div>
  )
}
