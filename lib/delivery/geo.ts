// Shared geocoding-address builder for every delivery map.
//
// Shopify customers are inconsistent: some put only the house number in
// address1 and the street name in address2 (e.g. #10174 address1="4",
// address2="Avenue Virginie"). Geocoding address1 alone then mismatches to a
// wrong town (Mapbox sent "4, Colombes 92700" to dept 18 instead of 92).
//
// Rule:
//  - address1 is just a house number → combine "<num> <street>" from address2
//  - otherwise → keep address1 and append address2 as a complement when present
//  - no usable street at all → fall back to city + zip
export interface GeoAddressParts {
  address1: string
  address2?: string | null
  city:     string
  zip:      string
  // Coordonnées déjà connues (fournies par Shopify à la commande) — si présentes,
  // le géocodeur les utilise directement (position exacte, aucun risque d'erreur).
  lat?:     number | null
  lng?:     number | null
}

function buildStreet(address1?: string | null, address2?: string | null): string {
  const a1 = (address1 ?? '').trim()
  const a2 = (address2 ?? '').trim()
  const numberOnly = /^\d+\s*\w?$/.test(a1)
  if (a2 && numberOnly) return `${a1} ${a2}`   // "4 Avenue Virginie"
  if (a2)               return `${a1}, ${a2}`  // keep complement (Bât., apt, hameau…)
  return a1
}

export function geoAddress({ address1, address2, city, zip }: GeoAddressParts): string {
  const street = buildStreet(address1, address2)
  return street ? `${street}, ${city} ${zip}, France` : `${city} ${zip}, France`
}

// Ligne de rue lisible pour l'AFFICHAGE : combine le n° (address1) et la rue
// (address2) quand le client a réparti sur les deux champs (ex. #10365 :
// address1="54", address2="Avenue Général De gaulle" → "54 Avenue Général De gaulle").
// Sans ça, l'affichage ne montrait que "54" → adresse incomplète pour le livreur.
export function streetLine(address1?: string | null, address2?: string | null): string {
  return buildStreet(address1, address2)
}

// Requêtes de géocodage par ordre de préférence. Le 2e candidat (rue + CP SANS la
// ville) rattrape les villes mal orthographiées par le client (ex. #10298
// "Saint mars d outillé" au lieu de "Saint-Mars-d'Outillé" : le géocodage adresse
// échouait, ou pire matchait un village homonyme "Noyers" à 250 km). Le dernier
// candidat = centroïde CP/ville (approximatif mais bonne commune) en dernier recours.
export function geoAddressCandidates({ address1, address2, city, zip }: GeoAddressParts): string[] {
  const street = buildStreet(address1, address2)
  const c = (city ?? '').trim()
  const z = (zip ?? '').trim()
  const out: string[] = []
  if (street && c) out.push(`${street}, ${c} ${z}, France`)
  if (street && z) out.push(`${street}, ${z}, France`)
  const centroid = [c, z].filter(Boolean).join(' ').trim()
  if (centroid) out.push(`${centroid}, France`)
  return out
}
