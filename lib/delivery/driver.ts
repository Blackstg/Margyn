// Canonical form for a driver (livreur) name, so the same person is always
// stored/displayed identically regardless of how it was typed ("enzo", "ENZO"
// and "Enzo" all collapse to "Enzo"). Handles composed first names too
// (jean-pierre → Jean-Pierre, marie claire → Marie Claire).
export function normalizeDriverName(raw: string | null | undefined): string {
  if (!raw) return ''
  const capitalize = (w: string) =>
    w ? w.charAt(0).toLocaleUpperCase('fr-FR') + w.slice(1) : w
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr-FR')
    .split(' ')
    .map((word) => word.split('-').map(capitalize).join('-'))
    .join(' ')
}

// Case-insensitive equality for driver names.
export function sameDriver(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDriverName(a) === normalizeDriverName(b) && normalizeDriverName(a) !== ''
}
