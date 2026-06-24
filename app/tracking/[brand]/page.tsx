'use client'

import { useState, FormEvent, useEffect } from 'react'
import Image from 'next/image'
import nextDynamic from 'next/dynamic'
import { geoAddress } from '@/lib/delivery/geo'

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

interface TrackingEvent {
  label:    string
  message:  string | null
  date:     string
  location: string | null
  code:     string | null  // 17Track canonical sub_status/stage
}

interface TrackingResult {
  order_name:      string
  created_at:      string
  customer_name:   string
  products:        Product[]
  address:         { address1: string; address2: string; city: string; zip: string } | null
  tracking_number: string | null
  tracking_events: TrackingEvent[]
  step:            number
  has_carrier_data?: boolean
  carrier_eta?:    { from: string | null; to: string | null } | null
  carrier_name?:   string | null
}

// Local (final-mile) carrier name = drop the cross-border consolidator (YunExpress)
function localCarrier(name?: string | null): string | null {
  if (!name) return null
  const parts = name.split(/\s*\+\s*/).map(s => s.trim()).filter(s => s && !/yunexpress/i.test(s))
  return parts.join(' / ') || null
}

// "En cours de livraison" — rendre l'étape concrète (transporteur local + ville)
function deliveryDesc(result: TrackingResult): string {
  const city    = result.address?.city?.trim()
  const carrier = localCarrier(result.carrier_name)
  if (carrier && city) return `Votre colis est en cours de livraison par ${carrier} à ${city}.`
  if (city)            return `Votre colis est en cours de livraison à ${city} et arrivera très bientôt.`
  if (carrier)         return `Votre colis est en cours de livraison par ${carrier}.`
  return 'Votre colis est en tournée de livraison, il arrivera très bientôt.'
}

// ─── Timeline types ───────────────────────────────────────────────────────────

type TLStatus = 'done' | 'current' | 'upcoming'

interface TLEvent {
  status:  TLStatus
  title:   string
  time:    string | null   // real date only on 'done'
  est:     boolean         // amber "estimé" badge on 'upcoming'
  desc:    string
  place?:  string | null   // lieu réel (ville/pays) — affiché sur l'étape courante
  nextup?: string          // hint shown below 'current' dot only
}

// Pays (codes ISO) → nom FR, pour afficher un lieu lisible sur l'étape courante
const COUNTRY_FR: Record<string, string> = {
  FR: 'France', BE: 'Belgique', DE: 'Allemagne', NL: 'Pays-Bas', ES: 'Espagne',
  IT: 'Italie', LU: 'Luxembourg', GB: 'Royaume-Uni', CH: 'Suisse', CN: 'Chine',
  PT: 'Portugal',
}
function prettyPlace(loc: string | null | undefined): string | null {
  if (!loc) return null
  const parts = loc.split(',').map(s => s.trim()).filter(Boolean)
  const mapped = parts.map(p => (/^[A-Za-z]{2}$/.test(p) ? (COUNTRY_FR[p.toUpperCase()] ?? p) : p))
  return mapped.join(', ') || null
}

// ─── Carrier detection ────────────────────────────────────────────────────────

type CarrierId = 'colissimo' | 'colis-prive' | 'gofo'

const CARRIER_NAMES: Record<CarrierId, string> = {
  colissimo:     'Colissimo',
  'colis-prive': 'Colis Privé',
  gofo:          'Gofo',
}

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

function detectCarrier(tracking: string): CarrierId | null {
  const t = tracking.toUpperCase().trim()

  // Colissimo (La Poste) — 13 chars, specific 2-letter prefixes
  if (/^(6[A-Z]|8[LQ]|9V)\d{11}$/.test(t)) return 'colissimo'
  // Colissimo international
  if (/^(CW|GR|EE|RR)\d{9}FR$/.test(t)) return 'colissimo'

  // Colis Privé — plusieurs formats connus
  if (/^37\d{11}$/.test(t))   return 'colis-prive'
  if (/^FCCE\d+$/.test(t))    return 'colis-prive'
  if (/^S\d{15,16}$/.test(t)) return 'colis-prive'  // ex: S6230116917912320

  // Gofo — GF or GOF prefix
  if (/^(GF|GOF)\d+/i.test(t)) return 'gofo'

  return null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
}

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ', ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Grandes étapes claires (rassurantes), pilotées par les vrais événements transporteur.
// Le journal complet reste accessible via « voir le détail ».
const RT_PHASES: { key: string; title: string; desc: string }[] = [
  { key: 'confirmed',  title: 'Commande confirmée',     desc: 'Nous avons bien reçu votre commande.' },
  { key: 'prepared',   title: 'Commande en préparation', desc: 'Votre commande est préparée avec soin. La préparation peut prendre quelques jours avant l’expédition.' },
  { key: 'shipped',    title: 'Colis expédié',          desc: 'Votre colis a quitté notre centre et est en route.' },
  { key: 'transit',    title: 'Acheminement en cours',  desc: 'Votre colis est en cours d’acheminement vers vous.' },
  { key: 'processing', title: 'Traitement en cours',    desc: 'Votre colis est pris en charge avant la livraison.' },
  { key: 'delivery',   title: 'En cours de livraison',  desc: 'Votre colis est en tournée de livraison.' },
  { key: 'delivered',  title: 'Livré',                  desc: 'Votre colis a été livré. Bonne réception !' },
]
const PHASE_IDX: Record<string, number> = Object.fromEntries(RT_PHASES.map((p, i) => [p.key, i]))

// Map a 17Track canonical sub_status/stage to a timeline phase index. Reliable
// across carriers/languages (no description-text guessing).
function phaseIndexFromCode(code: string | null): number | null {
  if (!code) return null
  const c = code.toLowerCase()
  if (c.startsWith('delivered'))                                 return PHASE_IDX.delivered
  if (c.startsWith('outfordelivery') || c.startsWith('availableforpickup')) return PHASE_IDX.delivery
  if (c.includes('customs'))                                     return PHASE_IDX.processing
  if (c.includes('arrival'))                                     return PHASE_IDX.transit
  if (c.includes('pickedup') || c.includes('departure'))         return PHASE_IDX.shipped
  if (c.startsWith('intransit') || c === 'exception' || c.startsWith('exception')) return PHASE_IDX.transit
  if (c.startsWith('inforeceived'))                              return PHASE_IDX.prepared
  return null
}

// Date de livraison estimée, TOUJOURS dans le futur (rassurant) :
// ETA transporteur si dispo → sinon commande + délai → si dépassée, glissante depuis le dernier event.
function estimatedDeliveryDate(result: TrackingResult, settings: TrackingSettings | null): Date | null {
  const now = Date.now()
  let d: Date | null = null
  if (result.carrier_eta?.to) d = new Date(result.carrier_eta.to)
  else if (settings) { d = new Date(result.created_at); d.setDate(d.getDate() + settings.estimated_days_max) }
  if (!d) return null
  if (d.getTime() < now) {
    const latest = result.tracking_events?.[0]?.date
    d = latest ? new Date(latest) : new Date()
    d.setDate(d.getDate() + 3)
    if (d.getTime() < now) { d = new Date(); d.setDate(d.getDate() + 2) }
  }
  return d
}

function buildRealTimeline(result: TrackingResult, settings: TrackingSettings | null): TLEvent[] {
  const delivered = result.step === 5
  const estDate = estimatedDeliveryDate(result, settings)
  const estStr  = estDate ? estDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null

  // Phases pilotées par le sub_status CANONIQUE de chaque événement (fiable,
  // multi-transporteurs) — plus de devinette sur le texte. dateFor = date la plus
  // récente atteinte par phase ; maxIdx = phase la plus avancée vue dans les events.
  const dateFor: Record<string, string> = {}
  let currentIdx = 0  // phase du dernier événement = où le colis se trouve MAINTENANT
  let currentPlace: string | null = null
  for (const e of result.tracking_events) {  // triés du + récent au + ancien
    const idx = phaseIndexFromCode(e.code)
    if (idx == null) continue
    if (currentIdx === 0) { currentIdx = idx; currentPlace = prettyPlace(e.location) }  // + récent → pas courant
    const key = RT_PHASES[idx].key
    if (!dateFor[key]) dateFor[key] = e.date
  }
  // Le pas courant suit la position réelle la plus récente. Évite qu'une étape plus
  // avancée dans le modèle (ex. dédouanement) affiche une date ANTÉRIEURE au pas
  // courant alors que le colis a continué à avancer ensuite (cf. #1135).
  // "Livré" UNIQUEMENT si le transporteur confirme le statut Delivered (step 5).
  const lastReached = delivered ? PHASE_IDX.delivered : Math.min(currentIdx, PHASE_IDX.delivery)

  return RT_PHASES.map((p, i): TLEvent => {
    const status: TLStatus = i < lastReached ? 'done' : i === lastReached ? (delivered ? 'done' : 'current') : 'upcoming'
    const desc = p.key === 'delivery' ? deliveryDesc(result) : p.desc
    const rawDate = p.key === 'confirmed'
      ? result.created_at
      : p.key === 'delivered'
        ? (dateFor.delivered ?? (delivered ? result.tracking_events?.[0]?.date : undefined))
        : dateFor[p.key]
    // Étapes à venir : date estimée (sur "Livré"), badge "estimé"
    if (status === 'upcoming') {
      const est = p.key === 'delivered' ? estStr : null
      return { status, title: p.title, time: est, est: !!est, desc }
    }
    const time = p.key === 'confirmed' ? fmtDate(rawDate) : (rawDate ? fmtDateTime(rawDate) : null)
    const place = status === 'current' ? currentPlace : null
    return { status, title: p.title, time, est: false, desc, place }
  })
}

// ─── buildTimeline ────────────────────────────────────────────────────────────

// Offsets (in days from created_at) for each of the 10 logical steps.
// Upcoming steps use these to compute estimated dates.
const STEP_OFFSETS = [0, 1, 2, 3, 5, 8, 9, 10, 11, 12]

function buildTimeline(result: TrackingResult, settings: TrackingSettings | null): TLEvent[] {
  const s    = result.step
  const evts = result.tracking_events   // newest first
  const min  = settings?.estimated_days_min ?? 12
  const max  = settings?.estimated_days_max ?? 20

  // Scale the fixed offsets to the actual delivery window
  // Steps 0-3 are early (fixed), steps 4-9 spread across the delivery window
  function estDate(idx: number): string {
    const fraction = STEP_OFFSETS[idx] / 12  // 12 = max fixed offset
    const days = Math.round(min + fraction * (max - min))
    const d = new Date(result.created_at); d.setDate(d.getDate() + days)
    if (d.getTime() < Date.now()) return idx === 9 ? 'très prochainement' : 'à venir'
    const date = addDays(result.created_at, days)
    return idx === 9 ? `au plus tard le ${date}` : `~ ${date}`
  }

  // Extract key timestamps from carrier events
  const labelEvt      = evts.find(e => ['Étiquette créée', 'Étiquette achetée'].includes(e.label))
  const firstScanEvt  = [...evts].reverse().find(e =>
    ['Expédition confirmée', 'Pris en charge', 'En transit'].includes(e.label)
  )
  const transitEvt    = [...evts].reverse().find(e => e.label === 'En transit')
  const outEvt        = evts.find(e => e.label === 'En cours de livraison')
  const delivEvt      = evts.find(e => e.label === 'Livré')

  // Minimum result.step for each logical step (0-indexed) to be "done"
  const doneAt = [1, 2, 3, 3, 4, 4, 4, 4, 5, 5]

  // Which logical step index is "current" per result.step
  const curLogical: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8 }
  const cur = curLogical[s] ?? -1

  type Raw = { title: string; realTime?: string | null; desc: string; nextup?: string }

  const raw: Raw[] = [
    {
      title:    'Commande confirmée',
      realTime: fmtDate(result.created_at),
      desc:     'Votre commande a bien été enregistrée et validée.',
    },
    {
      title:    'Préparation en entrepôt',
      realTime: s >= 2 ? fmtDate(labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre commande a été préparée et soigneusement emballée.',
      nextup:   'Votre colis sera bientôt pris en charge pour l\'expédition.',
    },
    {
      title:    'Colis expédié',
      realTime: s >= 3 ? fmtDate(firstScanEvt?.date ?? labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre colis a quitté notre entrepôt et est en route.',
    },
    {
      title:    'Départ du centre logistique',
      realTime: s >= 3 ? fmtDate(firstScanEvt?.date ?? labelEvt?.date ?? result.created_at) : null,
      desc:     'Votre colis a quitté le centre logistique de départ.',
    },
    {
      title:    'Acheminement en cours',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     s === 3
        ? 'C\'est l\'étape la plus longue du trajet — votre colis avance chaque jour. Tout se passe normalement.'
        : 'Votre colis a été acheminé avec succès vers la France.',
      nextup: 'Votre colis sera pris en charge par le transporteur local pour la livraison finale.',
    },
    {
      title:    'Arrivée au centre de tri',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     'Votre colis est arrivé au centre de tri régional.',
    },
    {
      title:    'Contrôle & traitement',
      realTime: s >= 4 ? fmtDate(transitEvt?.date ?? firstScanEvt?.date ?? null) : null,
      desc:     'Votre colis est en cours de traitement et d\'orientation.',
    },
    {
      title:    'Remis au transporteur',
      realTime: s >= 4 ? fmtDate(outEvt?.date ?? transitEvt?.date ?? null) : null,
      desc:     'Votre colis a été confié au transporteur final.',
    },
    {
      title:    'En cours de livraison',
      realTime: s >= 5 ? fmtDate(outEvt?.date ?? null) : null,
      desc:     'Le livreur est en chemin — il passera très bientôt à votre adresse.',
      nextup:   'Le livreur passera à votre adresse dans la journée.',
    },
    {
      title:    'Livré',
      realTime: s >= 5 ? fmtDate(delivEvt?.date ?? null) : null,
      desc:     'Votre commande est arrivée à destination. Merci de votre confiance !',
    },
  ]

  return raw.map((r, i): TLEvent => {
    const status: TLStatus =
      s >= doneAt[i]  ? 'done'    :
      i === cur       ? 'current' :
      'upcoming'

    // done → real timestamp | current → no time | upcoming → estimated date
    const time =
      status === 'done'     ? (r.realTime ?? null) :
      status === 'upcoming' ? estDate(i)            :
      null

    return {
      status,
      title:  r.title,
      time,
      est:    status === 'upcoming',
      desc:   r.desc,
      nextup: status === 'current' ? r.nextup : undefined,
    }
  })
}

// ─── VerticalTimeline ─────────────────────────────────────────────────────────

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

    // No URL params — try to restore last session
    try {
      const raw = sessionStorage.getItem(SESSION_KEY(brand))
      if (raw) {
        const { email: se, orderName: so, result: sr } = JSON.parse(raw) as {
          email: string; orderName: string; result: TrackingResult
        }
        setEmail(se)
        setOrderName(so)
        setResult(sr)
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  const primary     = settings?.brand_color || '#111'
  const isDelivered = result?.step === 5

  const timeline     = result ? (result.has_carrier_data ? buildRealTimeline(result, settings) : buildTimeline(result, settings)) : []
  const currentEvent = timeline.find(e => e.status === 'current')
    ?? [...timeline].reverse().find(e => e.status === 'done')

  async function doFetch(em: string, on: string) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res  = await fetch(`/api/tracking/${brand}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: em, order_name: on }),
      })
      const data = await res.json() as TrackingResult & { error?: string }
      if (!res.ok || data.error) {
        setError(data.error ?? 'Commande introuvable.')
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
      setError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setLoading(false)
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
                  const est = estimatedDeliveryDate(result, settings)
                  if (!est) return null
                  return (
                    <div style={{ background: primary, borderRadius: 12, padding: '10px 12px', textAlign: 'center', flexShrink: 0, minWidth: 96, maxWidth: 130 }}>
                      <p style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.75)', marginBottom: 4, letterSpacing: '0.5px' }}>
                        LIVRAISON ESTIMÉE
                      </p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.35 }}>
                        {est.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
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

                  {result.tracking_events.length > 0 && (
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

                {eventsOpen && result.tracking_events.length > 0 && (
                  <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {result.tracking_events.map((ev, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < result.tracking_events.length - 1 ? 14 : 0 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                            background: i === 0 ? '#22c55e' : 'rgba(0,0,0,0.15)',
                            boxShadow: i === 0 ? '0 0 0 3px #22c55e22' : 'none',
                          }} />
                          {i < result.tracking_events.length - 1 && (
                            <div style={{ width: 1, flex: 1, minHeight: 14, background: 'rgba(0,0,0,0.08)', marginTop: 3 }} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? '#111' : 'rgba(0,0,0,0.6)', lineHeight: 1.3 }}>
                            {ev.label}
                          </p>
                          {ev.message && (
                            <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>{ev.message}</p>
                          )}
                          <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', marginTop: 2 }}>
                            {new Date(ev.date).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                            {ev.location && <span> · {ev.location}</span>}
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
