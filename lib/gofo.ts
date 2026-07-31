// GOFO / CIRRO — suivi OFFICIEL (dernière ligne en France), fusionné avec 17Track.
// 17Track (via YunExpress) a le trajet international détaillé mais reste souvent
// un scan en retard sur le site GOFO pour la partie française. GOFO n'expose QUE
// le trajet domestique (préparation → tri → livraison), pas la Chine → on tague
// ses events en FR (côté destination, jamais masqués) et on les fusionne pour que
// notre suivi soit toujours aussi frais que l'officiel.
import type { Track17Result, Track17Event } from './track17'

const GOFO_API = 'https://www.gofo.com/fr/open-api/official/track/queryTrackV2'

interface GofoEvent {
  processDate:      string
  processContent?:  string
  mainContent?:     string
  processLocation?: string | null
  trackStatus?:     string
}
interface GofoRecord {
  status?:               string
  serviceName?:          string
  trackEventList?:       GofoEvent[]
  expectedDeliveryTime?: string | null
}

// Les numéros GOFO commencent par "GF" + 2 lettres pays + chiffres (ex. GFFR26206168113827)
export function isGofoNumber(n: string | null | undefined): boolean {
  return !!n && /^GF[A-Z]{2}\d/i.test(n.trim())
}

// Statut global GOFO → étape/statut façon 17Track (repli si aucun event ne tranche)
function gofoStatusToStep(s: string): { status: string; step: number; delivered: boolean } {
  const t = (s || '').toLowerCase()
  if (/deliver|sign|remis au destinataire|livr[ée]/.test(t)) return { status: 'Delivered',      step: 5, delivered: true  }
  if (/out.?for.?deliver|tourn[ée]e/.test(t))                return { status: 'OutForDelivery',  step: 4, delivered: false }
  if (/exception|problem|incident|fail|retour/.test(t))      return { status: 'Exception',       step: 4, delivered: false }
  if (/transit|tri|sort|pickup|collect|charge/.test(t))      return { status: 'InTransit',       step: 4, delivered: false }
  return { status: 'InfoReceived', step: 2, delivered: false }
}

// Un event GOFO (texte déjà en français) → Track17Event avec un `code` que la
// timeline sait mapper, et une localisation taguée FR (côté destination).
function mapEvent(e: GofoEvent): Track17Event | null {
  const date = e.processDate
  if (!date) return null
  const raw = (e.processContent || e.mainContent || '').trim()
  const L = raw.toLowerCase()
  let code = 'InTransit_Other'
  if (/(remis au destinataire|colis .*livr[ée]|livraison effectu|delivered|sign[ée])/.test(L) && !/centre de tri|en cours/.test(L)) code = 'Delivered'
  else if (/en cours de livraison|en tourn[ée]e|pris en charge par le livreur|out for delivery/.test(L)) code = 'OutForDelivery'
  else if (/pr[ée]par|information|exp[ée]diteur|shipment information/.test(L)) code = 'InfoReceived'
  const city = (e.processLocation || '').trim()
  const location = city ? `${city}, FR` : 'FR' // ligne France → jamais la Chine
  return { label: raw || '—', message: null, date, location, code }
}

export async function getGofoResult(number: string): Promise<Track17Result | null> {
  try {
    const res = await fetch(GOFO_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', lang: 'fr' },
      body: JSON.stringify({ numberList: [number] }),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json() as { code?: number; data?: GofoRecord[] }
    const rec = json?.data?.[0]
    if (!rec) return null

    const events = (rec.trackEventList ?? []).map(mapEvent).filter(Boolean) as Track17Event[]
    if (events.length === 0) return null

    const st = gofoStatusToStep(rec.status ?? '')
    const hasDelivered = events.some(e => e.code === 'Delivered')
    const hasOfd       = events.some(e => e.code === 'OutForDelivery')
    return {
      status:    hasDelivered ? 'Delivered' : hasOfd ? 'OutForDelivery' : st.status,
      step:      hasDelivered ? 5 : Math.max(st.step, hasOfd ? 4 : 2),
      delivered: hasDelivered || st.delivered,
      carrier_name: rec.serviceName ?? 'GOFO',
      eta_from: null,
      eta_to:   rec.expectedDeliveryTime ?? null,
      events,
    }
  } catch {
    return null
  }
}
