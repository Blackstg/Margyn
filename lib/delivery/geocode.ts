// Géocodage robuste et partagé pour toutes les cartes de livraison.
// Essaie plusieurs formulations d'adresse (voir geoAddressCandidates) : les
// candidats "adresse" sont restreints à types=address (empêche de matcher un
// village/POI homonyme — ex. la rue "des noyers" → village "Noyers" à 250 km),
// et seul le dernier candidat (centroïde CP/ville) reste permissif.
import { geoAddressCandidates, type GeoAddressParts } from './geo'

export async function geocodeParts(
  parts: GeoAddressParts,
  token: string
): Promise<[number, number] | null> {
  const candidates = geoAddressCandidates(parts)
  for (let i = 0; i < candidates.length; i++) {
    const isCentroid = i === candidates.length - 1
    const typesParam = isCentroid ? '' : '&types=address'
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(candidates[i])}.json` +
        `?access_token=${token}&country=fr&limit=1${typesParam}`
      )
      if (!res.ok) continue
      const data = await res.json()
      const c = data.features?.[0]?.center
      if (c) return c as [number, number]
    } catch { /* try next candidate */ }
  }
  return null
}
