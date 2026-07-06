// 17Track API v2.2 — register + gettrackinfo + normalisation/fusion multi-transporteurs
// Doc: https://api.17track.net  (auth via header 17token)

const API = 'https://api.17track.net/track/v2.2'

function headers() {
  return { '17token': process.env.TRACK17_API_KEY ?? '', 'Content-Type': 'application/json' }
}

// Codes transporteurs 17Track utiles
export const CARRIER = { YUNEXPRESS: 190008, COLISSIMO: 6051 }

// 17Track "stage" → libellé FR (events Colissimo notamment)
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

// Traduction FR des descriptions transporteur (souvent en anglais, ex. YunExpress)
const TRANSLATIONS: [RegExp, string][] = [
  [/shipment information received|information received/i, 'Informations d’expédition reçues'],
  [/delivered to local carrier/i,                          'Remis au transporteur local pour livraison'],
  [/out for delivery/i,                                    'En cours de livraison'],
  [/arrived at (the )?origin facility/i,                   'Arrivé au centre de tri (départ)'],
  [/departed from (the )?sort facility/i,                  'Départ du centre de tri (origine)'],
  [/in transit to next facility|shipment is in transit/i,  'En transit vers le centre suivant'],
  [/country of origin commences customs|customs declaration/i, 'Déclaration en douane (départ)'],
  [/origin international airport/i,                         'Arrivé à l’aéroport international (départ)'],
  [/clear(a|e)nce processing completed - export/i,         'Dédouanement export terminé'],
  [/international flight has departed/i,                    'Vol international parti'],
  [/international flight has arrived/i,                     'Vol international arrivé'],
  [/noa received/i,                                        'Avis d’arrivée reçu'],
  [/arrived at sort facility/i,                            'Arrivé au centre de tri (destination)'],
  [/start customs clear(a|e)nce|customs clearance/i,       'Dédouanement à l’import en cours'],
  [/clear(a|e)nce processing completed - import/i,         'Dédouanement import terminé'],
  [/departed from facility/i,                              'Départ du centre'],
  // "will be delivered to X" = transfert au transporteur local, PAS une livraison.
  // Doit passer AVANT le motif générique /delivered/ ci-dessous.
  [/will be delivered to|handed over to|transferred to/i,  'Transmis au transporteur local'],
  // Livraison réelle uniquement (évite les faux positifs type "will be delivered")
  [/successfully delivered|delivered to (the )?(recipient|consignee|addressee|customer)|package delivered|proof of delivery|^delivered$|colis (a été )?livré|remis au destinataire/i, 'Livré'],
]
function translateDesc(d: string | null): string | null {
  if (!d) return null
  for (const [re, fr] of TRANSLATIONS) if (re.test(d)) return fr
  return d
}

// statut 17Track → étape logique 1-5
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

// `code` = 17Track canonical sub_status/stage (e.g. InTransit_CustomsReleased,
// OutForDelivery, Delivered_Other). Drives the timeline reliably, independent of
// the (carrier-specific, multilingual) description text.
export interface Track17Event { label: string; message: string | null; date: string; location: string | null; code: string | null }
export interface Track17Result {
  status: string; step: number; delivered: boolean
  carrier_name: string | null; eta_from: string | null; eta_to: string | null
  events: Track17Event[]
}

export interface TrackItem { number: string; carrier?: number }

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function register(items: TrackItem[]): Promise<any> {
  const res = await fetch(`${API}/register`, { method: 'POST', headers: headers(), body: JSON.stringify(items) })
  return res.json()
}

export async function getTrackInfo(items: TrackItem[]): Promise<any> {
  const res = await fetch(`${API}/gettrackinfo`, { method: 'POST', headers: headers(), body: JSON.stringify(items) })
  return res.json()
}

// Un "accepted" (gettrackinfo) ou "data" (webhook) → résultat normalisé (fusionne TOUS les providers)
export function normalize(accepted: any): Track17Result | null {
  const ti = accepted?.track_info
  if (!ti) return null
  const status    = ti.latest_status?.status ?? 'NotFound'
  const providers = ti.tracking?.providers ?? []
  const events: Track17Event[] = providers.flatMap((p: any) => (p.events ?? []).map((e: any) => {
    const fr = STAGE_LABELS[e.stage] ?? translateDesc(e.description) ?? e.stage ?? '—'
    return {
      label:    fr,
      message:  null, // on évite les descriptions brutes (souvent en anglais) — le libellé FR suffit
      date:     e.time_iso ?? e.time_utc ?? null,
      // e.location ("PARIS, PARIS, FR") est plus riche que address (souvent juste le
      // pays) → on le préfère ; le nettoyage (ville + pays) se fait à l'affichage.
      location: e.location || [e.address?.city, e.address?.country].filter(Boolean).join(', ') || null,
      code:     e.sub_status ?? e.stage ?? null,
    }
  })).filter((e: Track17Event) => !!e.date)

  return {
    status, step: statusToStep(status), delivered: status === 'Delivered',
    carrier_name: providers[0]?.provider?.name ?? null,
    eta_from: ti.time_metrics?.estimated_delivery_date?.from ?? null,
    eta_to:   ti.time_metrics?.estimated_delivery_date?.to ?? null,
    events,
  }
}

// Fusionne plusieurs résultats (ex. YunExpress + Colissimo) en un suivi unique
export function mergeResults(results: (Track17Result | null)[]): Track17Result | null {
  const rs = results.filter(Boolean) as Track17Result[]
  if (!rs.length) return null
  const seen = new Set<string>()
  const events = rs.flatMap(r => r.events)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter(e => { const k = `${e.date}|${e.label}`; if (seen.has(k)) return false; seen.add(k); return true })
  const withEvents = [...rs].sort((a, b) => b.events.length - a.events.length)
  const delivered = rs.some(r => r.delivered)
  return {
    status:       delivered ? 'Delivered' : (withEvents[0]?.status ?? 'NotFound'),
    step:         delivered ? 5 : Math.max(2, ...rs.map(r => r.step)),
    delivered,
    carrier_name: [...new Set(rs.flatMap(r => (r.carrier_name ?? '').split(' + ')).map(s => s.trim()).filter(Boolean))].join(' + ') || null,
    eta_from:     rs.map(r => r.eta_from).find(Boolean) ?? null,
    eta_to:       rs.map(r => r.eta_to).find(Boolean) ?? null,
    events,
  }
}
