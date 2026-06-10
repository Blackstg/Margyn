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

// ─── Steps config ─────────────────────────────────────────────────────────────

const STEPS: {
  label:    string
  detail:   string
  next:     string | null
  icon:     string
}[] = [
  {
    label:  'Commande confirmée',
    detail: 'Votre commande a bien été reçue et votre paiement validé. Notre équipe va prendre en charge votre colis très prochainement.',
    next:   'Votre colis va être préparé et contrôlé avant expédition.',
    icon:   '✅',
  },
  {
    label:  'En cours de préparation',
    detail: 'Votre commande est en cours de traitement par notre équipe. Chaque article est soigneusement vérifié et emballé avant de vous être expédié.',
    next:   'Vous recevrez une notification dès que votre colis est expédié.',
    icon:   '🔄',
  },
  {
    label:  'Expédiée',
    detail: 'Votre colis a quitté notre entrepôt et est en cours d\'acheminement. Ce délai est tout à fait normal — votre commande avance chaque jour.',
    next:   'Votre colis sera bientôt pris en charge par le transporteur final pour la livraison chez vous.',
    icon:   '📦',
  },
  {
    label:  'En cours de livraison',
    detail: 'Votre colis est maintenant entre les mains du transporteur final. La livraison à votre domicile est imminente.',
    next:   'Vous recevrez votre commande très prochainement.',
    icon:   '🚚',
  },
  {
    label:  'Livrée 🎉',
    detail: 'Votre commande a bien été livrée. Nous espérons que vous êtes pleinement satisfait(e) de votre achat.',
    next:   null,
    icon:   '✅',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function daysRemaining(iso: string, days: number): number {
  const target = new Date(iso)
  target.setDate(target.getDate() + days)
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86_400_000))
}

// ─── StepDots ─────────────────────────────────────────────────────────────────

function StepDots({ step, primary }: { step: number; primary: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      {STEPS.map((s, i) => {
        const num     = i + 1
        const done    = num < step
        const current = num === step
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' as never }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width:        current ? 28 : 20,
                height:       current ? 28 : 20,
                borderRadius: '50%',
                background:   done ? '#22c55e' : current ? primary : 'rgba(0,0,0,0.1)',
                display:      'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow:    current ? `0 0 0 4px ${primary}28` : 'none',
                transition:   'all 0.2s',
              }}>
                {done
                  ? <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>
                  : <span style={{ color: current ? '#fff' : 'rgba(0,0,0,0.3)', fontSize: 10, fontWeight: 700 }}>{num}</span>
                }
              </div>
              {current && (
                <div style={{
                  position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                  marginTop: 5, whiteSpace: 'nowrap',
                  fontSize: 10, fontWeight: 700, color: primary, letterSpacing: '0.3px',
                }}>
                  {s.label.replace(' 🎉', '')}
                </div>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, marginLeft: 2, marginRight: 2,
                background:   done ? '#22c55e' : 'rgba(0,0,0,0.08)',
                borderRadius: 1,
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

  // Days remaining until max estimate
  const daysLeft = result && settings
    ? daysRemaining(result.created_at, settings.estimated_days_max)
    : null

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#f5f5f3' }}>

      {/* ── Header ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <a href={settings?.brand_website || '#'} target="_blank" rel="noopener noreferrer">
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
        {result && (
          <button onClick={() => { setResult(null); setError(null) }}
            style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>
            Autre commande
          </button>
        )}
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
            {/* ── 1. STATUT PRINCIPAL ── */}
            <div style={{
              background:   isDelivered ? '#f0fdf4' : primary,
              borderRadius: 16,
              padding:      '18px 20px',
              color:        isDelivered ? '#166534' : '#fff',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, opacity: 0.7, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 5 }}>
                    Statut de votre commande
                  </p>
                  <p style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
                    {currentStep?.label}
                  </p>
                  <p style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.55 }}>
                    {currentStep?.detail}
                  </p>
                </div>
                {/* Délai estimé ou livraison imminente */}
                {!isDelivered && settings && (
                  <div style={{
                    background: 'rgba(255,255,255,0.18)', borderRadius: 12,
                    padding: '10px 12px', textAlign: 'center', flexShrink: 0, minWidth: 80,
                  }}>
                    {daysLeft !== null && daysLeft > 0 ? (
                      <>
                        <p style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{daysLeft}</p>
                        <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginTop: 2 }}>
                          jour{daysLeft > 1 ? 's' : ''} max
                        </p>
                      </>
                    ) : (
                      <>
                        <p style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>📬</p>
                        <p style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, marginTop: 2 }}>
                          Imminent
                        </p>
                      </>
                    )}
                    <p style={{ fontSize: 9, opacity: 0.65, marginTop: 4 }}>
                      avant le {addDays(result.created_at, settings.estimated_days_max)}
                    </p>
                  </div>
                )}
              </div>

              {/* Prochaine étape */}
              {currentStep?.next && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 12, opacity: 0.7, flexShrink: 0, marginTop: 1 }}>→</span>
                  <p style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.45 }}>
                    <strong style={{ opacity: 1 }}>Prochaine étape :</strong> {currentStep.next}
                  </p>
                </div>
              )}
            </div>

            {/* ── 2. BARRE DE PROGRESSION ── */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px 26px' }}>
              <StepDots step={result.step} primary={primary} />
            </div>

            {/* ── 3. PRODUITS + ADRESSE ── */}
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
              {settings?.show_products && (
                <div style={{ padding: '14px 16px', borderBottom: settings?.show_address && result.address ? '1px solid rgba(0,0,0,0.05)' : 'none' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
                    Votre commande — {result.order_name}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {result.products.map((p, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
                          background: 'rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {p.image_url ? (
                            <Image src={p.image_url} alt={p.title} width={52} height={52} unoptimized
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: 20 }}>📦</span>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.title}
                          </p>
                          {p.variant_title && (
                            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 1 }}>{p.variant_title}</p>
                          )}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.4)', flexShrink: 0 }}>×{p.qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings?.show_address && result.address && (
                <div style={{ padding: '12px 16px' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
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
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: '1px', textTransform: 'uppercase' }}>Numéro de suivi</p>
                  <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: '#111', letterSpacing: '1px' }}>
                    {result.tracking_number}
                  </p>
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

            {/* ── 5. BLOC RASSURANT ── */}
            {!isDelivered && (
              <div style={{ background: '#fff', borderRadius: 14, padding: '14px 16px' }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 10 }}>
                  Bon à savoir
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { icon: '🕐', text: 'Les délais de livraison affichés sont calculés à partir de la date de commande et représentent une estimation standard.' },
                    { icon: '📦', text: 'Votre colis est soigneusement emballé et protégé pour arriver en parfait état.' },
                    { icon: '💬', text: settings?.contact_email ? `Une question ? Notre équipe répond rapidement sur ${settings.contact_email}` : 'Notre équipe est disponible pour toute question sur votre commande.' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
                      <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', lineHeight: 1.5 }}>{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ── */}
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
