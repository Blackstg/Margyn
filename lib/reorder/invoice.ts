// Facture fournisseur → lignes de commande : rapprochement des lignes lues (produit,
// couleur) avec les variantes Shopify. Pur, testé dans invoice.test.ts. La lecture
// du PDF elle-même est faite par app/api/reorder/invoice.

export type InvoiceLine = { product: string; color: string; qty: number; unitPrice: number; kind: 'product' | 'other' }

export type ParsedInvoice = {
  supplier: string; number: string; date: string; currency: string
  subtotal: number; deposit: number; balance: number
  lines: InvoiceLine[]
}

export type MatchableVariant = { id: string; title: string; variantTitle: string | null }

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[™®]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const STOP = new Set(['a', 'de', 'la', 'le', 'les', 'du', 'des', 'et', 'the', 'for'])
const tokens = (s: string) => norm(s).split(' ').filter((t) => t && !STOP.has(t))

export const aliasKey = (l: Pick<InvoiceLine, 'product' | 'color'>) => `${norm(l.product)}|${norm(l.color)}`

// Couleur de la facture → couleur Shopify, avec les synonymes connus (« marron » → « brown aubergine »).
function colorTokens(color: string, aliases: Record<string, string>): string[] {
  const c = norm(color)
  if (aliases[c]) return tokens(aliases[c])
  return tokens(c).flatMap((t) => (aliases[t] ? tokens(aliases[t]) : [t]))
}

export function matchVariant(
  line: Pick<InvoiceLine, 'product' | 'color' | 'kind'>,
  variants: MatchableVariant[],
  s: { colorAliases: Record<string, string>; invoiceAliases: Record<string, string> },
): string | null {
  const remembered = s.invoiceAliases[aliasKey(line)]
  if (remembered && variants.some((v) => v.id === remembered)) return remembered
  if (line.kind !== 'product') return null

  const pt = new Set(tokens(line.product))
  const wantsStrap = pt.has('strap')
  const productScore = (v: MatchableVariant) => {
    const tt = tokens(v.title)
    if (!wantsStrap && tt.includes('strap')) return 0
    return tt.filter((t) => pt.has(t)).length
  }
  const best = Math.max(0, ...variants.map(productScore))
  if (best === 0) return null
  const candidates = variants.filter((v) => productScore(v) === best)

  const ct = colorTokens(line.color, s.colorAliases)
  if (!ct.length) return candidates.length === 1 ? candidates[0].id : null
  // 10 points par mot de couleur retrouvé, −1 par mot en trop dans la variante (« Kaki » avant « MumMoot Kaki »).
  const scored = candidates.map((v) => {
    const vt = tokens(v.variantTitle ?? '')
    const hit = ct.filter((t) => vt.includes(t)).length
    return { v, score: hit ? hit * 10 - (vt.length - hit) : 0 }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return null
  return scored[0].v.id
}
