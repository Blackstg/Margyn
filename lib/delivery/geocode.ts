// Géocodage robuste et partagé pour toutes les cartes de livraison.
//
// Ordre de priorité :
//  1. Coordonnées Shopify déjà connues (parts.lat/lng) → exactes, aucun appel.
//  2. Adresse précise (types=address) VALIDÉE contre le centroïde du code postal :
//     on rejette tout résultat trop loin (rue homonyme dans une autre ville — ex.
//     "24 Rue Lenôtre, Bourges 18000" que Mapbox plaçait à Cognac/Banyuls à 300 km)
//     ou peu fiable.
//  3. Repli sur le centroïde du code postal (bonne commune) plutôt qu'un match faux.
import { geoAddressCandidates, type GeoAddressParts } from './geo'

const MAPBOX = 'https://api.mapbox.com/geocoding/v5/mapbox.places'
const MAX_KM_FROM_ZIP = 30 // au-delà, on considère que c'est un homonyme (mauvaise ville)

function distKm(a: [number, number], b: [number, number]): number {
  const [lng1, lat1] = a, [lng2, lat2] = b
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

async function geocodeOne(
  query: string, token: string, typesAddress: boolean,
): Promise<{ center: [number, number]; relevance: number } | null> {
  try {
    const res = await fetch(
      `${MAPBOX}/${encodeURIComponent(query)}.json?access_token=${token}&country=fr&limit=1${typesAddress ? '&types=address' : ''}`,
    )
    if (!res.ok) return null
    const f = (await res.json()).features?.[0]
    return f?.center ? { center: f.center as [number, number], relevance: f.relevance ?? 0 } : null
  } catch { return null }
}

export async function geocodeParts(
  parts: GeoAddressParts,
  token: string,
): Promise<[number, number] | null> {
  // 1. Coordonnées Shopify déjà connues → exactes.
  if (typeof parts.lat === 'number' && typeof parts.lng === 'number'
      && !(parts.lat === 0 && parts.lng === 0)) {
    return [parts.lng, parts.lat]
  }

  // 2. Ancre = centroïde du code postal (+ ville). Fiable, jamais à 300 km.
  const zip  = (parts.zip ?? '').trim()
  const city = (parts.city ?? '').trim()
  const anchorQ = [zip, city].filter(Boolean).join(' ')
  const anchor  = anchorQ ? (await geocodeOne(`${anchorQ}, France`, token, false))?.center ?? null : null

  // 3. Adresse précise, validée contre l'ancre (distance + fiabilité).
  const candidates = geoAddressCandidates(parts)
  const addressCandidates = candidates.slice(0, Math.max(0, candidates.length - 1)) // hors centroïde final
  for (const q of addressCandidates) {
    const r = await geocodeOne(q, token, true)
    if (!r) continue
    const closeEnough = !anchor || distKm(r.center, anchor) <= MAX_KM_FROM_ZIP
    if (r.relevance >= 0.5 && closeEnough) return r.center
  }

  // 4. Repli : centroïde du CP (bonne commune) ; sinon dernier candidat permissif.
  if (anchor) return anchor
  const last = candidates[candidates.length - 1]
  return last ? (await geocodeOne(last, token, false))?.center ?? null : null
}
