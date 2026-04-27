'use client'

import { useState, FormEvent } from 'react'
import Image from 'next/image'
import nextDynamic from 'next/dynamic'

const TrackingMap = nextDynamic(() => import('@/components/delivery/TrackingMap'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackingResult {
  order_name:        string
  created_at:        string
  email:             string
  customer_name:     string
  products:          { title: string; variant_title: string | null; qty: number }[]
  address:           { address1: string; address2: string; city: string; zip: string } | null
  tags:              string[]
  is_preorder:       boolean
  is_sample:         boolean
  tracking_number:   string | null
  tour_status:       string | null
  tour_name:         string | null
  tour_planned_date: string | null
  stop_status:       string | null
  delivered_at:      string | null
  step:              number
}

// ─── Timeline config ──────────────────────────────────────────────────────────

const STEPS = [
  { icon: '✅', label: 'Commande confirmée',   desc: 'Votre commande a bien été reçue et enregistrée.' },
  { icon: '📦', label: 'En préparation',        desc: 'Votre commande est en cours de préparation en entrepôt.' },
  { icon: '🔍', label: 'Contrôle qualité',      desc: 'Les panneaux sont vérifiés avant expédition.' },
  { icon: '🚛', label: 'Chargement planifié',   desc: 'Votre commande est affectée à une tournée de livraison.' },
  { icon: '🗺️', label: 'Tournée démarrée',      desc: 'Votre commande est en route\u00a0! Notre livreur passera chez vous dans les prochains jours. Vous serez contacté avant le passage.' },
  { icon: '🔔', label: 'Avis de passage',       desc: "Une tentative de livraison a été effectuée. Notre livreur va vous recontacter pour convenir d'un nouveau créneau." },
  { icon: '✅', label: 'Livré',                 desc: 'Votre commande a été livrée avec succès.' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

function addWorkingDays(dateStr: string, days: number): Date {
  const result = new Date(dateStr + 'T00:00:00')
  result.setDate(result.getDate() + days)
  return result
}

function fmtDateFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function stepDate(result: TrackingResult, stepIndex: number): string | null {
  if (stepIndex === 0) return fmtDate(result.created_at)
  if (stepIndex === 1) return fmtDate(addDays(result.created_at, 1))
  if (stepIndex === 2) return fmtDate(addDays(result.created_at, 2))
  if (stepIndex === 3 && result.tour_planned_date) return fmtDate(result.tour_planned_date)
  if (stepIndex === 6 && result.delivered_at) return fmtDateTime(result.delivered_at)
  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrackingPage() {
  const [email,     setEmail]     = useState('')
  const [orderName, setOrderName] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [result,    setResult]    = useState<TrackingResult | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res  = await fetch('/api/tracking', {
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

  function handleReset() {
    setResult(null)
    setError(null)
  }

  const mapAddress = result?.address
    ? [result.address.address1, result.address.city, result.address.zip, 'France'].filter(Boolean).join(', ')
    : null

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f1ebe7' }}>

      {/* ── Header ── */}
      <header style={{ backgroundColor: '#f1ebe7', borderBottom: '1px solid rgba(0,0,0,0.06)' }} className="px-6 py-4 flex justify-center">
        <a href="https://bowa-concept.com" target="_blank" rel="noopener noreferrer">
          <Image
            src="https://bowa-concept.com/cdn/shop/files/logo.png?v=1693451719"
            alt="Bowa Concept"
            width={120}
            height={48}
            style={{ objectFit: 'contain', height: 40, width: 'auto' }}
            priority
            unoptimized
          />
        </a>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-8 space-y-4">

        {/* Form or collapsed pill */}
        {!result ? (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6">
            <h2 className="text-[15px] font-semibold text-black mb-1">Suivi de commande</h2>
            <p className="text-sm text-black/50 mb-5">Entrez votre email et votre numéro de commande pour suivre votre livraison.</p>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-black/50 mb-1">Adresse email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  style={{ borderRadius: 10, border: '1px solid #e0d9d4', background: '#ffffff' }}
                  className="w-full px-4 py-2.5 text-sm outline-none focus:border-black/30 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black/50 mb-1">Numéro de commande</label>
                <input
                  type="text"
                  required
                  value={orderName}
                  onChange={(e) => setOrderName(e.target.value)}
                  placeholder="#9969"
                  style={{ borderRadius: 10, border: '1px solid #e0d9d4', background: '#ffffff' }}
                  className="w-full px-4 py-2.5 text-sm outline-none focus:border-black/30 transition-colors"
                />
              </div>
              {error && (
                <p style={{ borderRadius: 10, background: '#fff3f3', color: '#c0392b' }} className="text-sm px-4 py-2.5">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                style={{ borderRadius: 10, background: '#111', color: '#fff' }}
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
              onClick={handleReset}
              className="text-xs text-black/40 hover:text-black transition-colors underline underline-offset-2 shrink-0"
            >
              Autre commande
            </button>
          </div>
        )}

        {result && (
          <>
            {/* Preorder banner */}
            {result.is_preorder && (
              <div style={{ background: '#fdf6f0', borderRadius: 14, border: '1px solid rgba(180,130,90,0.25)' }} className="px-5 py-4">
                <span style={{ background: '#b47a4a', color: '#fff', borderRadius: 999 }} className="text-xs font-semibold px-2.5 py-0.5 uppercase tracking-wide">
                  Précommande
                </span>
                <p className="text-sm text-black/70 mt-2">
                  Votre commande est confirmée et sera expédiée dès que tous les produits sont disponibles.
                  {result.tour_planned_date && (() => {
                    const end = addWorkingDays(result.tour_planned_date!, 4)
                    return <> Livraison estimée entre le <strong>{fmtDateFr(new Date(result.tour_planned_date! + 'T00:00:00'))}</strong> et le <strong>{fmtDateFr(end)}</strong>.</>
                  })()}
                </p>
              </div>
            )}

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

              {result.address && (
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

            {/* Map */}
            {mapAddress && (
              <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }}>
                <div style={{ height: 220 }}>
                  <TrackingMap address={mapAddress} />
                </div>
              </div>
            )}

            {/* Sample: La Poste */}
            {result.is_sample ? (
              <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📬</span>
                  <p className="text-[15px] font-semibold text-black">Votre échantillon est expédié via La Poste</p>
                </div>
                {result.tracking_number ? (
                  <div style={{ background: '#f1ebe7', borderRadius: 12 }} className="px-5 py-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-black/40 uppercase tracking-wide mb-1">Numéro de suivi</p>
                      <p className="font-mono font-semibold text-black text-base tracking-widest">{result.tracking_number}</p>
                    </div>
                    <a
                      href={`https://www.laposte.fr/outils/suivre-vos-envois?code=${result.tracking_number}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ borderRadius: 10, background: '#FFCC00', color: '#111' }}
                      className="flex items-center justify-center gap-2 w-full py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                    >
                      <span>🔍</span> Suivre sur laposte.fr
                    </a>
                  </div>
                ) : (
                  <p className="text-sm text-black/50">Votre colis est en cours de préparation. Le numéro de suivi sera disponible dès l&apos;expédition.</p>
                )}
              </div>
            ) : (
              /* Standard timeline */
              <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)' }} className="p-6">
                <p className="text-xs font-semibold text-black/40 mb-5 uppercase tracking-wide">Progression de la livraison</p>
                <ol>
                  {STEPS.map((s, i) => {
                    const stepNum   = i + 1
                    const isDone    = stepNum < result.step
                    const isCurrent = stepNum === result.step
                    const date      = (isCurrent || isDone) ? stepDate(result, i) : null

                    return (
                      <li key={i} className="flex gap-4">
                        <div className="flex flex-col items-center">
                          <div
                            style={{
                              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 14,
                              background: isDone ? '#eaf7f0' : isCurrent ? '#111' : 'rgba(0,0,0,0.05)',
                              color: isDone ? '#27ae60' : isCurrent ? '#fff' : 'rgba(0,0,0,0.2)',
                              boxShadow: isCurrent ? '0 0 0 4px rgba(0,0,0,0.08)' : 'none',
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
                          {date && (
                            <p style={{ fontSize: 11, marginTop: 2, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>
                              {date}
                            </p>
                          )}
                          {(i === 3 || i === 4) && result.tour_name && isCurrent && (
                            <p style={{ fontSize: 12, marginTop: 4, color: 'rgba(0,0,0,0.45)' }}>
                              Tournée : <span style={{ fontWeight: 600 }}>{result.tour_name}</span>
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ backgroundColor: '#f1ebe7', borderTop: '1px solid rgba(0,0,0,0.06)' }} className="px-6 py-5 text-center space-y-1">
        <p className="text-xs text-black/40">© Bowa Concept</p>
        <a
          href="https://bowa-concept.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-black/50 hover:text-black transition-colors underline underline-offset-2"
        >
          Retour au site
        </a>
        <p className="text-xs text-black/30 pt-1">
          Des questions ? <a href="mailto:hello@bowa-concept.com" className="underline">hello@bowa-concept.com</a>
        </p>
      </footer>
    </div>
  )
}
