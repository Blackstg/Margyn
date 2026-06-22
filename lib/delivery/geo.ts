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
}

export function geoAddress({ address1, address2, city, zip }: GeoAddressParts): string {
  const a1 = (address1 ?? '').trim()
  const a2 = (address2 ?? '').trim()
  const numberOnly = /^\d+\s*\w?$/.test(a1)

  let street: string
  if (a2 && numberOnly)      street = `${a1} ${a2}`   // "4 Avenue Virginie"
  else if (a2)               street = `${a1}, ${a2}`  // keep complement (Bât., apt, hameau…)
  else                       street = a1

  return street ? `${street}, ${city} ${zip}, France` : `${city} ${zip}, France`
}
