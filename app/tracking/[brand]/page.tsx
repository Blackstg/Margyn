'use client'

import { useState, FormEvent, useEffect } from 'react'
import Image from 'next/image'
import nextDynamic from 'next/dynamic'
import { geoAddress } from '@/lib/delivery/geo'

import { type TrackingSettings, type TrackingResult, type TLEvent, prettyPlace, type CarrierId, CARRIER_NAMES, detectCarrier, frLabel, estimatedDeliveryRange, fmtRange, localEvents, buildRealTimeline, buildTimeline } from '@/lib/tracking/display'

const TrackingMap = nextDynamic(() => import('@/components/delivery/TrackingMap'), { ssr: false })

function CarrierLogo({ id }: { id: CarrierId }) {
  if (id === 'colissimo') return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#FFD100"/>
      {/* La Poste yellow + Colissimo blue C */}
      <path d="M14 6C9.58 6 6 9.58 6 14c0 4.42 3.58 8 8 8 2.1 0 4-.8 5.44-2.1l-1.9-1.9C16.47 18.92 15.28 19.4 14 19.4c-2.98 0-5.4-2.42-5.4-5.4s2.42-5.4 5.4-5.4c1.28 0 2.47.48 3.38 1.26l1.9-1.9C17.84 6.72 16 6 14 6z" fill="#003D82"/>
    </svg>
  )
  if (id === 'colis-prive') return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#1B2A6B"/>
      <text x="14" y="19" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff" fontFamily="Arial, sans-serif">CP</text>
    </svg>
  )
  if (id === 'gofo') return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="7" fill="#FF5C1A"/>
      <text x="14" y="19.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="Arial, sans-serif">G</text>
    </svg>
  )
  return null
}

function VerticalTimeline({ events, primary }: { events: TLEvent[]; primary: string }) {
  return (
    <>
      <style>{`
        @keyframes tl-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(34,197,94,0); }
        }
        .tl-dot-current { animation: tl-pulse 2s ease-in-out infinite; }
      `}</style>

      <div style={{ padding: '2px 0' }}>
        {events.map((ev, i) => {
          const isLast    = i === events.length - 1
          const isDone    = ev.status === 'done'
          const isCurrent = ev.status === 'current'

          return (
            <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>

              {/* Left column: dot + line */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 18 }}>
                {/* Dot */}
                <div
                  className={isCurrent ? 'tl-dot-current' : undefined}
                  style={{
                    width:        isDone ? 14 : isCurrent ? 14 : 12,
                    height:       isDone ? 14 : isCurrent ? 14 : 12,
                    borderRadius: '50%',
                    flexShrink:   0,
                    marginTop:    4,
                    background:   isDone ? '#22c55e' : isCurrent ? '#22c55e' : '#e5e7eb',
                    border:       isCurrent ? '2px solid #22c55e' : isDone ? 'none' : '2px solid #d1d5db',
                    display:      'flex',
                    alignItems:   'center',
                    justifyContent: 'center',
                  }}
                >
                  {isDone && (
                    <span style={{ color: '#fff', fontSize: 7, fontWeight: 900, lineHeight: 1 }}>✓</span>
                  )}
                  {isCurrent && (
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />
                  )}
                </div>

                {/* Connector line */}
                {!isLast && (
                  <div style={{
                    width:      2,
                    flex:       1,
                    minHeight:  8,
                    marginTop:  3,
                    marginBottom: 3,
                    background: isDone ? '#22c55e' : '#e5e7eb',
                    borderRadius: 1,
                  }} />
                )}
              </div>

              {/* Right column: content */}
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 14 }}>
                {/* Title + badge/time row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <p style={{
                    fontSize:   13,
                    fontWeight: isDone || isCurrent ? 700 : 500,
                    color:      isDone || isCurrent ? '#111' : 'rgba(0,0,0,0.35)',
                    lineHeight: 1.3,
                    marginTop:  3,
                  }}>
                    {ev.title}
                  </p>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }}>
                    {ev.est && (
                      <span style={{
                        fontSize:        9,
                        fontWeight:      700,
                        padding:         '2px 6px',
                        borderRadius:    4,
                        background:      'rgba(217,119,6,0.10)',
                        color:           '#b45309',
                        textTransform:   'uppercase',
                        letterSpacing:   '0.4px',
                      }}>
                        estimé
                      </span>
                    )}
                    {ev.time && (
                      <span style={{ fontSize: 11, color: ev.est ? '#b45309' : 'rgba(0,0,0,0.4)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {ev.time}
                      </span>
                    )}
                    {isCurrent && !ev.time && (
                      <span style={{
                        fontSize:   9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                        background: 'rgba(34,197,94,0.12)', color: '#16a34a',
                        textTransform: 'uppercase', letterSpacing: '0.4px',
                      }}>
                        en cours
                      </span>
                    )}
                  </div>
                </div>

                {/* Description (done + current only) */}
                {(isDone || isCurrent) && (
                  <p style={{
                    fontSize:  12,
                    color:     isCurrent ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)',
                    marginTop: 3,
                    lineHeight: 1.5,
                  }}>
                    {ev.desc}
                  </p>
                )}

                {/* Lieu réel sur l'étape en cours (ex. « 📍 Roissy, France ») */}
                {isCurrent && ev.place && (
                  <p style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 600, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11 }}>📍</span> {ev.place}
                  </p>
                )}

                {/* Next up hint (current step only) */}
                {ev.nextup && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, color: primary, flexShrink: 0, fontWeight: 700 }}>→</span>
                    <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', lineHeight: 1.45 }}>
                      {ev.nextup}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SESSION_KEY = (brand: string) => `tracking_session_${brand}`

export default function BrandTrackingPage({ params }: { params: { brand: string } }) {
  const { brand } = params

  const [settings,   setSettings]   = useState<TrackingSettings | null>(null)
  const [email,      setEmail]      = useState('')
  const [orderName,  setOrderName]  = useState('')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [result,       setResult]       = useState<TrackingResult | null>(null)
  const [eventsOpen,   setEventsOpen]   = useState(false)
  const [carrierLogos, setCarrierLogos] = useState<Record<string, string>>({})

  // Load settings (localStorage cache → API refresh)
  useEffect(() => {
    const cacheKey = `tracking_settings_${brand}`
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) setSettings(JSON.parse(cached))
    } catch { /* ignore */ }

    fetch(`/api/tracking/settings?brand=${brand}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          setSettings(d.settings)
          try { localStorage.setItem(cacheKey, JSON.stringify(d.settings)) } catch { /* ignore */ }
        }
      })
      .catch(() => null)

    fetch('/api/tracking/carrier-logos')
      .then((r) => r.json())
      .then((d) => { if (d.logos) setCarrierLogos(d.logos) })
      .catch(() => null)
  }, [brand])

  // On mount: read URL params (Klaviyo links) or restore session
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlEmail = params.get('email')?.trim() ?? ''
    const urlOrder = params.get('order')?.trim() ?? ''

    if (urlEmail && urlOrder) {
      // URL params take priority — auto-submit immediately
      setEmail(urlEmail)
      setOrderName(urlOrder)
      doFetch(urlEmail, urlOrder)
      return
    }

    // No URL params — restore last session MAIS on re-interroge pour un statut frais.
    // (Sinon on réaffichait l'ancien résultat mis en cache → le suivi semblait figé
    // sur « en préparation » alors que le colis avait avancé côté transporteur.)
    try {
      const raw = sessionStorage.getItem(SESSION_KEY(brand))
      if (raw) {
        const { email: se, orderName: so, result: sr } = JSON.parse(raw) as {
          email: string; orderName: string; result: TrackingResult
        }
        setEmail(se)
        setOrderName(so)
        setResult(sr)          // affichage immédiat (évite un écran vide)
        if (se && so) doFetch(se, so)   // …puis rafraîchit en arrière-plan
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  const primary     = settings?.brand_color || '#111'
  const isDelivered = result?.step === 5

  const detailEvents = result ? localEvents(result.tracking_events) : []
  const timeline     = result ? (result.has_carrier_data ? buildRealTimeline(result, settings) : buildTimeline(result, settings)) : []
  const currentEvent = timeline.find(e => e.status === 'current')
    ?? [...timeline].reverse().find(e => e.status === 'done')

  async function doFetch(em: string, on: string, silent = false) {
    // silent = rafraîchissement en arrière-plan : on ne vide pas l'écran ni n'affiche
    // le spinner (et on garde l'ancien résultat si le réseau échoue).
    if (!silent) {
      setLoading(true)
      setError(null)
      setResult(null)
    }
    try {
      const res  = await fetch(`/api/tracking/${brand}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: em, order_name: on }),
      })
      const data = await res.json() as TrackingResult & { error?: string }
      if (!res.ok || data.error) {
        if (!silent) setError(data.error ?? 'Commande introuvable.')   // silent → on garde l'ancien
      } else {
        setResult(data)
        // Persist session
        try {
          sessionStorage.setItem(SESSION_KEY(brand), JSON.stringify({ email: em, orderName: on, result: data }))
        } catch { /* ignore */ }
        // Reflect the lookup in the address bar → unique, shareable tracking link
        try {
          const q = `?order=${encodeURIComponent(on)}&email=${encodeURIComponent(em)}`
          window.history.replaceState(null, '', `${window.location.pathname}${q}`)
        } catch { /* ignore */ }
      }
    } catch {
      if (!silent) setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await doFetch(email.trim(), orderName.trim())
  }

  function handleReset() {
    setResult(null)
    setError(null)
    try { sessionStorage.removeItem(SESSION_KEY(brand)) } catch { /* ignore */ }
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* ignore */ }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#f5f5f3' }}>

      {/* ── Header ── */}
      <header style={{ background: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '10px 20px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <div />
        <a href={settings?.brand_website || '#'} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', justifyContent: 'center', minHeight: 32, alignItems: 'center' }}>
          {settings === null ? (
            /* Settings pas encore chargées — placeholder invisible pour éviter le flash de texte */
            <div style={{ height: 32, width: 80 }} />
          ) : settings.brand_logo_url ? (
            <Image src={settings.brand_logo_url} alt={settings.brand_name || brand}
              width={120} height={36} unoptimized priority
              style={{ objectFit: 'contain', height: 32, width: 'auto' }} />
          ) : (
            <span style={{ fontSize: 17, fontWeight: 800, color: primary }}>
              {settings.brand_name || brand.toUpperCase()}
            </span>
          )}
        </a>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {result && (
            <button onClick={handleReset}
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
            <div style={{ background: '#fff', borderRadius: 16, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.35)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 6 }}>
                    Statut
                  </p>
                  <p style={{ fontSize: 19, fontWeight: 800, color: '#111', lineHeight: 1.2 }}>
                    {currentEvent?.title ?? '—'}
                  </p>
                  {currentEvent?.status === 'current' && (
                    <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginTop: 5, lineHeight: 1.5 }}>
                      {currentEvent.desc}
                    </p>
                  )}
                </div>

                {/* Delivery estimate badge — date estimée (toujours future) */}
                {!isDelivered && (() => {
                  const est = estimatedDeliveryRange(result, settings)
                  if (!est) return null
                  return (
                    <div style={{ background: primary, borderRadius: 12, padding: '10px 12px', textAlign: 'center', flexShrink: 0, minWidth: 96, maxWidth: 130 }}>
                      <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.75)', marginBottom: 4, letterSpacing: '0.5px' }}>
                        LIVRAISON ESTIMÉE
                      </p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>
                        {fmtRange(est)}
                      </p>
                    </div>
                  )
                })()}
                {isDelivered && (
                  <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '10px 12px', textAlign: 'center', flexShrink: 0 }}>
                    <p style={{ fontSize: 20 }}>🎉</p>
                  </div>
                )}
              </div>
            </div>

            {/* ── 2. TIMELINE VERTICALE ── */}
            <div style={{ background: '#fff', borderRadius: 14, padding: '16px 18px 20px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 14 }}>
                Progression
              </p>
              <VerticalTimeline events={timeline} primary={primary} />
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
            {settings?.show_tracking_number && result.tracking_number && (() => {
              const carrierId = detectCarrier(result.tracking_number)
              return (
              <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  {/* Left: logo + numero */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {carrierId && (
                      <div style={{
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        border: '1px solid rgba(0,0,0,0.06)',
                        overflow: 'hidden',
                      }}>
                        {carrierLogos[carrierId]
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={carrierLogos[carrierId]} alt={CARRIER_NAMES[carrierId]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          : <CarrierLogo id={carrierId} />
                        }
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 2 }}>
                        {carrierId ? CARRIER_NAMES[carrierId] : 'Numéro de suivi'}
                      </p>
                      <p style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: '#111', letterSpacing: '0.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {result.tracking_number}
                      </p>
                    </div>
                  </div>

                  {detailEvents.length > 0 && (
                    <button
                      onClick={() => setEventsOpen((o) => !o)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                        background: eventsOpen ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)',
                        border: 'none', borderRadius: 8, padding: '7px 12px',
                        fontSize: 12, fontWeight: 600, color: '#111', cursor: 'pointer',
                      }}
                    >
                      Voir le détail
                      <span style={{ fontSize: 10, transition: 'transform 0.2s', display: 'inline-block', transform: eventsOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                    </button>
                  )}
                </div>

                {eventsOpen && detailEvents.length > 0 && (
                  <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {detailEvents.map((ev, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < detailEvents.length - 1 ? 14 : 0 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                            background: i === 0 ? '#22c55e' : 'rgba(0,0,0,0.15)',
                            boxShadow: i === 0 ? '0 0 0 3px #22c55e22' : 'none',
                          }} />
                          {i < detailEvents.length - 1 && (
                            <div style={{ width: 1, flex: 1, minHeight: 14, background: 'rgba(0,0,0,0.08)', marginTop: 3 }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? '#111' : 'rgba(0,0,0,0.6)', lineHeight: 1.3 }}>
                            {frLabel(ev.label)}
                          </p>
                          {ev.message && (
                            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{ev.message}</p>
                          )}
                          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>
                            {new Date(ev.date).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                            {prettyPlace(ev.location) && <span> · {prettyPlace(ev.location)}</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )
            })()}

            {/* ── 5. MAP ── */}
            {settings?.show_address && result.address && (
              <div style={{ borderRadius: 16, overflow: 'hidden', height: 200 }}>
                <TrackingMap address={geoAddress(result.address)} />
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
