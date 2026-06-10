'use client'

import { useState, FormEvent, useEffect } from 'react'
import Image from 'next/image'
import nextDynamic from 'next/dynamic'

const TrackingMap = nextDynamic(() => import('@/components/delivery/TrackingMap'), { ssr: false })

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

interface Product {
  title:         string
  variant_title: string | null
  qty:           number
  image_url:     string | null
}

interface TrackingResult {
  order_name:      string
  created_at:      string
  customer_name:   string
  products:        Product[]
  address:         { address1: string; address2: string; city: string; zip: string } | null
  tracking_number: string | null
  step:            number
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS: { short: string; detail: string; next: string | null }[] = [
  {
    short:  'Confirmée',
    detail: 'Merci pour votre commande ! Tout est en ordre et votre colis va bientôt être pris en charge.',
    next:   'Votre colis va être préparé et soigneusement emballé.',
  },
  {
    short:  'Préparation',
    detail: 'Votre commande est entre nos mains. Nous prenons le temps de préparer et vérifier chaque article.',
    next:   'Votre colis sera expédié dès que la préparation est finalisée.',
  },
  {
    short:  'Expédiée',
    detail: 'C\'est parti ! Votre colis est en route et se rapproche de vous chaque jour.',
    next:   'Il sera bientôt remis au transporteur final pour la livraison à votre domicile.',
  },
  {
    short:  'En livraison',
    detail: 'Votre colis est tout proche — le transporteur final s\'en occupe et vous le remettra très prochainement.',
    next:   null,
  },
  {
    short:  'Livrée',
    detail: 'Votre commande est arrivée à destination. Nous espérons qu\'elle vous donne entière satisfaction !',
    next:   null,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

// ─── StepDots ─────────────────────────────────────────────────────────────────

function StepDots({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      {STEPS.map((s, i) => {
        const num     = i + 1
        const done    = num < step
        const current = num === step

        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', flex: i < STEPS.length - 1 ? 1 : 'none' as never }}>
            {/* Dot + label */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                width:        current ? 26 : 20,
                height:       current ? 26 : 20,
                borderRadius: '50%',
                background:   done || current ? '#22c55e' : 'rgba(0,0,0,0.1)',
                display:      'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow:    current ? '0 0 0 3px #22c55e44' : 'none',
                flexShrink:   0,
              }}>
                {done
                  ? <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>
                  : <span style={{ color: current ? '#fff' : 'rgba(0,0,0,0.3)', fontSize: 9, fontWeight: 700 }}>{num}</span>
                }
              </div>
              {/* Label below dot */}
              <p style={{
                fontSize:   9,
                fontWeight: current ? 700 : 500,
                color:      done || current ? '#22c55e' : 'rgba(0,0,0,0.3)',
                marginTop:  5,
                textAlign:  'center',
                lineHeight: 1.2,
                maxWidth:   48,
              }}>
                {s.short}
              </p>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, marginTop: 9, marginLeft: 3, marginRight: 3,
                background:   done ? '#22c55e' : 'rgba(0,0,0,0.08)',
                borderRadius: 1, flexShrink: 0,
              }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BrandTrackingPage({ params }: { params: { brand: string } }) {
  const { brand } = params

  const [settings,  setSettings]  = useState<TrackingSettings | null>(null)
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

  const primary = settings?.brand_color || '#111'

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
      if (!res.ok || data.error) setError(data.error ?? 'Commande introuvable.')
      else setResult(data)
    } catch {
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setLoading(false)
    }
  }

  const currentStep = result ? STEPS[result.step - 1] : null
  const isDelivered = result?.step === 5

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#f5f5f3' }}>

      {/* ── Header ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '10px 20px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <div />
        <a href={settings?.brand_website || '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', justifyContent: 'center' }}>
          {settings?.brand_logo_url ? (
            <Image src={settings.brand_logo_url} alt={settings.brand_name || brand}
              width={120} height={36} unoptimized priority
              style={{ objectFit: 'contain', height: 32, width: 'auto' }} />
          ) : (
            <span style={{ fontSize: 17, fontWeight: 800, color: primary }}>
              {settings?.brand_name || brand.toUpperCase()}
            </span>
          )}
        </a>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {result && (
            <button onClick={() => { setResult(null); setError(null) }}
              style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
              Autre commande
            </button>
          )}
        </div>
      </header>

      <main style={{ flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* ── FORM ── */}
        {!result ? (
          <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 12px rgba(0,0,0,0.06)', padding: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Suivi de commande</h2>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginBottom: 18 }}>
              Entrez votre email et votre numéro de commande.
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Adresse email</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="votre@email.com"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e5e5', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', display: 'block', marginBottom: 4 }}>Numéro de commande</label>
                <input type="text" required value={orderName} onChange={(e) => setOrderName(e.target.value)}
                  placeholder="#1234"
                  style={{ width: '100%', borderRadius: 10, border: '1px solid #e5e5e5', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              {error && (
                <p style={{ borderRadius: 10, background: '#fff3f3', color: '#c0392b', fontSize: 13, padding: '10px 14px' }}>{error}</p>
              )}
              <button type="submit" disabled={loading}
                style={{ borderRadius: 10, background: primary, color: '#fff', padding: '11px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Recherche…' : 'Suivre ma commande'}
              </button>
            </form>
          </div>
        ) : (
          <>
            {/* ── 1. STATUT ── */}
            <div style={{
              background:   isDelivered ? '#f0fdf4' : primary,
              borderRadius: 16,
              padding:      '18px 20px',
              color:        isDelivered ? '#166534' : '#fff',
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, opacity: 0.65, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
                Statut
              </p>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
                    {currentStep?.short}
                  </p>
                  <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.55 }}>
                    {currentStep?.detail}
                  </p>
                </div>
                {/* Livraison estimée - doux */}
                {!isDelivered && settings && (
                  <div style={{
                    background: 'rgba(255,255,255,0.15)', borderRadius: 12,
                    padding: '10px 12px', textAlign: 'center', flexShrink: 0,
                  }}>
                    <p style={{ fontSize: 9, fontWeight: 600, opacity: 0.75, marginBottom: 4, letterSpacing: '0.5px' }}>
                      LIVRAISON PRÉVUE
                    </p>
                    <p style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.4 }}>
                      {addDays(result.created_at, settings.estimated_days_min)}<br />
                      au {addDays(result.created_at, settings.estimated_days_max)}
                    </p>
                  </div>
                )}
              </div>

              {/* Prochaine étape */}
              {currentStep?.next && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 11, opacity: 0.6, flexShrink: 0, marginTop: 1 }}>→</span>
                  <p style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                    {currentStep.next}
                  </p>
                </div>
              )}
            </div>

            {/* ── 2. PROGRESSION ── */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 12px 20px' }}>
              <StepDots step={result.step} />
            </div>

            {/* ── 3. PRODUITS + ADRESSE ── */}
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
              {settings?.show_products && (
                <div style={{ padding: '14px 16px', borderBottom: settings?.show_address && result.address ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
                    Votre commande — {result.order_name}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.products.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
                          background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {p.image_url
                            ? <Image src={p.image_url} alt={p.title} width={52} height={52} unoptimized style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontSize: 20 }}>📦</span>
                          }
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</p>
                          {p.variant_title && <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>{p.variant_title}</p>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>×{p.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings?.show_address && result.address && (
                <div style={{ padding: '12px 16px' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
                    Livraison à
                  </p>
                  <p style={{ fontSize: 13, color: '#111', fontWeight: 600 }}>{result.customer_name}</p>
                  <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>
                    {result.address.address1}{result.address.address2 ? `, ${result.address.address2}` : ''} — {result.address.zip} {result.address.city}
                  </p>
                </div>
              )}
            </div>

            {/* ── 4. TRACKING ── */}
            {settings?.show_tracking_number && result.tracking_number && (
              <div style={{ background: '#fff', borderRadius: 14, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '1px', textTransform: 'uppercase' }}>Numéro de suivi</p>
                  <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: '#111', letterSpacing: '1px' }}>{result.tracking_number}</p>
                </div>
                {settings.show_tracking_link && (
                  <a href={`https://t.17track.net/fr#nums=${result.tracking_number}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', borderRadius: 10, background: primary, color: '#fff', padding: '10px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                    Suivre mon colis →
                  </a>
                )}
              </div>
            )}

            {/* ── 5. MAP ── */}
            {settings?.show_address && result.address && (
              <div style={{ borderRadius: 16, overflow: 'hidden', height: 200 }}>
                <TrackingMap address={[result.address.address1, result.address.zip, result.address.city, 'France'].filter(Boolean).join(', ')} />
              </div>
            )}
          </>
        )}
      </main>

      <footer style={{ padding: '10px 20px', textAlign: 'center', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
        {settings?.contact_email && (
          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)' }}>
            Questions ?{' '}
            <a href={`mailto:${settings.contact_email}`} style={{ color: 'rgba(0,0,0,0.4)', textDecoration: 'underline' }}>
              {settings.contact_email}
            </a>
          </p>
        )}
      </footer>
    </div>
  )
}
