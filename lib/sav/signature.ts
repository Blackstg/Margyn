// Signature par agent (option gratuite, sans siège Zendesk supplémentaire).
//
// Contexte : il n'y a qu'UNE identité Zendesk par marque, donc toutes les réponses
// partaient sous le même persona (« Je suis Jade… » + « Jade Mayet / Customer
// service »), imposé par les règles SAV. On personnalise désormais avec le PRÉNOM de
// l'agent authentifié. Les brouillons utilisent le marqueur {{PRÉNOM}} (remplacé à
// l'affichage ET à l'envoi). Ici, à l'ENVOI, on :
//  1) remplace {{PRÉNOM}} (et l'ancien persona « Je suis Jade ») par le vrai prénom ;
//  2) retire toute signature déjà présente (après la formule de politesse ou « -- ») ;
//  3) réappose une signature propre « {Prénom} / Service client {Marque} / site ».

// Bloc signature par marque : lignes affichées sous le prénom.
const SIGNATURE: Record<string, string[]> = {
  moom: ['Service client Mōom', 'www.moom-paris.co'],
  bowa: ['Service client Bowa Concept', 'www.bowa-concept.com'],
  krom: ['Service client Krom', 'www.krom-paris.com'],
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

// Formules de politesse de clôture — la signature vient toujours APRÈS.
const CLOSING_RE = /(bien cordialement|cordialement|bien à vous|belle journée|bonne journée|excellente journée|très belle journée|à bientôt|à très bientôt|au plaisir)/i

export function personalizeReply(
  body: string,
  fullName: string | null | undefined,
  brand: string,
): string {
  const first = firstNameOf(fullName)
  if (!first || !body) return body

  let t = body.replace(/\r\n/g, '\n')
  // 0) Marqueur {{PRÉNOM}} → prénom de l'agent (brouillons générés avec le marqueur).
  t = t.replace(PRENOM_MARKER, first)
  t = t.replace(/\n{3,}/g, '\n\n').trimEnd()

  // 1) Ancienne auto-présentation « Je suis X » / « Je m'appelle X » → prénom agent.
  t = t.replace(/\b(Je suis|Je m['’]appelle)\s+([A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’-]+)/g, (m, lead, name) => {
    return NOT_A_NAME.has(String(name).toLowerCase()) ? m : `${lead} ${first}`
  })

  // 2) Retirer la signature existante.
  const lines = t.split('\n')
  // a) couper au séparateur Zendesk « -- »
  const sepAt = lines.findIndex(l => /^\s*--\s*$/.test(l))
  let kept = sepAt !== -1 ? lines.slice(0, sepAt) : lines
  // b) sinon/ensuite, couper juste après la DERNIÈRE formule de politesse (tout ce
  //    qui suit est une signature : nom, équipe, service client, url…).
  let lastClosing = -1
  for (let i = 0; i < kept.length; i++) if (CLOSING_RE.test(kept[i])) lastClosing = i
  if (lastClosing !== -1) kept = kept.slice(0, lastClosing + 1)
  else {
    // c) pas de formule trouvée : on retire les dernières lignes qui ressemblent à
    //    une signature (équipe/persona/url/service client).
    const sigRe = /^(l['’]équipe\b|service client\b|customer service\b|www\.|m?ōom\b|moom\b|bowa\b|krom\b|jade\b|marine\b)/i
    while (kept.length && (kept[kept.length - 1].trim() === '' || sigRe.test(kept[kept.length - 1].trim())))
      kept.pop()
  }

  const clean = kept.join('\n').trimEnd()
  const sigLines = SIGNATURE[brand] ?? [`Service client ${brand.charAt(0).toUpperCase()}${brand.slice(1)}`]
  return `${clean}\n\n${first}\n${sigLines.join('\n')}`
}
