// 17Track API v2.2 — register + gettrackinfo + normalisation des événements
// Doc: https://api.17track.net  (auth via header 17token)

const API = 'https://api.17track.net/track/v2.2'

function headers() {
  return { '17token': process.env.TRACK17_API_KEY ?? '', 'Content-Type': 'application/json' }
}

// 17Track "stage" → libellé FR (aligné sur STATUS_LABELS de la page de suivi)
const STAGE_LABELS: Record<string, string> = {
  InfoReceived:       'Étiquette créée',
  PickedUp:           'Pris en charge',
  Departure:          'En transit',
  Arrival:            'En transit',
  InTransit:          'En transit',
  CustomsClearance:   'Dédouanement',
  AvailableForPickup: 'Prêt à être récupéré',
  OutForDelivery:     'En cours de livraison',
  Delivered:          'Livré',
  Exception:          'Incident de livraison',
  DeliveryFailure:    'Incident de livraison',
  Returning:          'Retour expéditeur',
  Returned:           'Retourné',
}

// statut 17Track → étape logique 1-5 de la timeline
export function statusToStep(status: string): number {
  switch (status) {
    case 'Delivered':          return 5
    case 'OutForDelivery':     return 4
    case 'AvailableForPickup': return 4
    case 'InTransit':
    case 'Departure':
    case 'Arrival':
    case 'CustomsClearance':
    case 'Exception':
    case 'DeliveryFailure':    return 4
    case 'PickedUp':           return 3
    case 'InfoReceived':       return 2
    default:                   return 2
  }
}

export interface Track17Event { label: string; message: string | null; date: string; location: string | null }
export interface Track17Result {
  status:       string
  step:         number
  delivered:    boolean
  carrier_name: string | null
  eta_from:     string | null
  eta_to:       string | null
  events:       Track17Event[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function register(numbers: string[]): Promise<any> {
  const res = await fetch(`${API}/register`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(numbers.map(n => ({ number: n }))),
  })
  return res.json()
}

export async function getTrackInfo(numbers: string[]): Promise<any> {
  const res = await fetch(`${API}/gettrackinfo`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify(numbers.map(n => ({ number: n }))),
  })
  return res.json()
}

// Transforme un objet "accepted[i]" (gettrackinfo) OU "data" (webhook) en résultat normalisé
export function normalize(accepted: any): Track17Result | null {
  const ti = accepted?.track_info
  if (!ti) return null
  const status   = ti.latest_status?.status ?? 'NotFound'
  const provider = ti.tracking?.providers?.[0]
  const events: Track17Event[] = (provider?.events ?? [])
    .map((e: any) => ({
      label:    STAGE_LABELS[e.stage] ?? e.description ?? e.stage ?? '—',
      message:  e.description ?? null,
      date:     e.time_iso ?? e.time_utc ?? null,
      location: [e.address?.city, e.address?.country].filter(Boolean).join(', ') || e.location || null,
    }))
    .filter((e: Track17Event) => !!e.date)
    .sort((a: Track17Event, b: Track17Event) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    status,
    step:         statusToStep(status),
    delivered:    status === 'Delivered',
    carrier_name: provider?.provider?.name ?? null,
    eta_from:     ti.time_metrics?.estimated_delivery_date?.from ?? null,
    eta_to:       ti.time_metrics?.estimated_delivery_date?.to ?? null,
    events,
  }
}
