// Signature par agent (option gratuite, sans siège Zendesk supplémentaire).
//
// Contexte : il n'y a qu'UNE identité Zendesk par marque. On personnalise la
// signature avec le nom PUBLIC choisi pour chaque agent, qui peut dépendre de la
// MARQUE (ex. Satiana signe « Jade Mayet » sur Moom et « Marine Vayet » sur Bowa).
// L'attribution interne (verrou anti-double-réponse, stats Qualité) reste sur le
// full_name réel (Satiana, Lary…). Les brouillons utilisent le marqueur {{PRÉNOM}}
// (remplacé à l'affichage ET à l'envoi). À l'ENVOI, on :
//  1) remplace {{PRÉNOM}} (et l'ancien « Je suis Jade ») par le prénom public ;
//  2) retire toute signature déjà présente (après la formule de politesse ou « -- ») ;
//  3) réappose « {Nom public} / Customer Success {Marque} ».

// Nom PUBLIC complet par agent interne (clé = prénom réel en minuscules) PAR MARQUE.
const DISPLAY_NAME: Record<string, Record<string, string>> = {
  satiana: { moom: 'Jade Mayet',  bowa: 'Marine Vayet' },
  lary:    { moom: 'Laura',       bowa: 'Laura' },
}

// Libellé de marque affiché dans la ligne de rôle.
const BRAND_LABEL: Record<string, string> = {
  moom: 'Mōom',
  bowa: 'Bowa Concept',
  krom: 'Krom',
}

// Mots qui suivent « Je suis … » mais ne sont PAS des prénoms (adjectifs/états).
const NOT_A_NAME = new Set([
  'ravi', 'ravie', 'désolé', 'désolée', 'navré', 'navrée', 'content', 'contente',
  'heureux', 'heureuse', 'disponible', 'là', 'certain', 'certaine', 'sincèrement',
  'vraiment', 'tout', 'bien', 'conscient', 'consciente', 'confus', 'confuse',
])

const PRENOM_MARKER = /\{\{\s*PR[ÉE]NOM\s*\}\}/gi

export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}

// Nom PUBLIC complet affiché dans la signature (ex. « Jade Mayet »). Sans mapping,
// on retombe sur le prénom réel de l'agent.
export function signatureDisplayName(fullName: string | null | undefined, brand: string): string {
  const key = firstNameOf(fullName).toLowerCase()
  const byBrand = DISPLAY_NAME[key]
  if (byBrand) return byBrand[brand] ?? byBrand.moom ?? firstNameOf(fullName)
  return firstNameOf(fullName)
}

// Prénom PUBLIC (1er mot du nom affiché) pour l'intro « Je suis … » et {{PRÉNOM}}.
export function signatureFirstName(fullName: string | null | undefined, brand: string): string {
  return firstNameOf(signatureDisplayName(fullName, brand))
}

// Formules de politesse de clôture — la signature vient toujours APRÈS.
const CLOSING_RE = /(bien cordialement|cordialement|bien à vous|belle journée|bonne journée|excellente journée|très belle journée|à bientôt|à très bientôt|au plaisir)/i

export function personalizeReply(
  body: string,
  fullName: string | null | undefined,
  brand: string,
): string {
  const displayFirst = signatureFirstName(fullName, brand)
  const displayFull  = signatureDisplayName(fullName, brand)
  if (!displayFirst || !body) return body

  let t = body.replace(/\r\n/g, '\n')
  // 0) Marqueur {{PRÉNOM}} → prénom public (brouillons générés avec le marqueur).
  t = t.replace(PRENOM_MARKER, displayFirst)
  t = t.replace(/\n{3,}/g, '\n\n').trimEnd()

  // 1) Ancienne auto-présentation « Je suis X » / « Je m'appelle X » → prénom public.
  t = t.replace(/\b(Je suis|Je m['’]appelle)\s+([A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’-]+)/g, (m, lead, name) => {
    return NOT_A_NAME.has(String(name).toLowerCase()) ? m : `${lead} ${displayFirst}`
  })

  // 2) Retirer la signature existante.
  const lines = t.split('\n')
  // a) couper au séparateur Zendesk « -- »
  const sepAt = lines.findIndex(l => /^\s*--\s*$/.test(l))
  let kept = sepAt !== -1 ? lines.slice(0, sepAt) : lines
  // b) sinon/ensuite, couper juste après la DERNIÈRE formule de politesse (tout ce
  //    qui suit est une signature : nom, équipe, rôle, url…).
  let lastClosing = -1
  for (let i = 0; i < kept.length; i++) if (CLOSING_RE.test(kept[i])) lastClosing = i
  if (lastClosing !== -1) kept = kept.slice(0, lastClosing + 1)
  else {
    // c) pas de formule trouvée : on retire les dernières lignes qui ressemblent à
    //    une signature (équipe/rôle/persona/url).
    const sigRe = /^(l['’]équipe\b|service client\b|customer service\b|customer success\b|www\.|m?ōom\b|moom\b|bowa\b|krom\b|jade\b|marine\b|laura\b)/i
    while (kept.length && (kept[kept.length - 1].trim() === '' || sigRe.test(kept[kept.length - 1].trim())))
      kept.pop()
  }

  const clean = kept.join('\n').trimEnd()
  const brandLabel = BRAND_LABEL[brand] ?? `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`
  return `${clean}\n\n${displayFull}\nCustomer Success ${brandLabel}`
}
