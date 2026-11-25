// Ce qu'il reste par produit, vendu seul ou ajouté dans un colis (pack), et le
// verdict qui en découle. Pur (sans I/O) : utilisé par Marges › Par commande et
// testé dans packRules.test.ts. Les coûts d'envoi et d'ajout viennent du calcul de
// livraison existant (lib/shippingCost.ts) ; rien n'est recalculé ici.

export const PACK_RULES = {
  // Mōom ne facture pas de TVA : prix payé par la cliente = CA (comme le reste de Steero).
  vatRate: 0,
  // Avec un sac dans le panier, remise sur les articles ajoutés (le sac n'est jamais remisé).
  discounts: [
    { added: 0, pct: 0,    label: 'Sans remise' },
    { added: 1, pct: 0.10, label: '−10 %' },
    { added: 2, pct: 0.12, label: '−12 %' },
    { added: 3, pct: 0.15, label: '−15 %' },
  ],
  // « Rentable » à partir de ce qu'il reste (€) ; entre 0 et ce seuil : « Limite ».
  verdictThreshold: 5,
}

export type Verdict = 'rentable' | 'limite' | 'perte'
export const VERDICT_LABEL: Record<Verdict, string> = { rentable: 'Rentable', limite: 'Limite', perte: 'À perte' }

export function verdictOf(left: number, threshold = PACK_RULES.verdictThreshold): Verdict {
  return left < 0 ? 'perte' : left < threshold ? 'limite' : 'rentable'
}

export const priceExVat = (paid: number, vatRate = PACK_RULES.vatRate) => paid / (1 + vatRate)

export type ProductEconomics = {
  key: string
  title: string
  image: string | null
  price: number        // prix catalogue payé par la cliente
  purchase: number     // coût d'achat
  sendAlone: number    // coût d'envoi du produit seul
  addCost: number      // coût d'ajout dans un colis qui part déjà
  sold: number         // articles vendus sur la période
}

export type Context = { pubPerOrder: number; feeRate: number; portAlone: number }

export type AloneOutcome = { price: number; purchase: number; shipping: number; pub: number; fees: number; left: number; leftWithPort: number; verdict: Verdict }

// Vendu seul : prix − achat − envoi − frais de paiement − pub moyenne par commande.
export function aloneOutcome(p: ProductEconomics, ctx: Context): AloneOutcome {
  const price = priceExVat(p.price)
  const fees = p.price * ctx.feeRate
  const left = price - p.purchase - p.sendAlone - fees - ctx.pubPerOrder
  return { price, purchase: p.purchase, shipping: p.sendAlone, pub: ctx.pubPerOrder, fees, left, leftWithPort: left + ctx.portAlone, verdict: verdictOf(left) }
}

export type AddOutcome = { label: string; pct: number; price: number; left: number; verdict: Verdict }

// Ajouté dans un colis : prix remisé − achat − coût d'ajout. Pas de pub : elle est
// déjà payée par le premier article de la commande.
export function addOutcomes(p: ProductEconomics): AddOutcome[] {
  return PACK_RULES.discounts.map(d => {
    const price = priceExVat(p.price) * (1 - d.pct)
    const left = price - p.purchase - p.addCost
    return { label: d.label, pct: d.pct, price, left, verdict: verdictOf(left) }
  })
}

export type Takeaway = { tone: Verdict; big: string; title: string; text: string }

const eur = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
const plural = (n: number, one: string, many: string) => (n > 1 ? many : one)

// Bandeau « À retenir » : 3 à 4 phrases courtes tirées des données.
export function takeaways(
  products: { p: ProductEconomics; alone: AloneOutcome; add: AddOutcome[] }[],
  baskets: { items: number; label: string; afterPub: number; count: number }[],
): Takeaway[] {
  const out: Takeaway[] = []
  if (!products.length) return out

  const losers = products.filter(x => x.alone.verdict === 'perte').sort((a, b) => a.alone.left - b.alone.left)
  if (losers.length) {
    const w = losers[0]
    out.push({ tone: 'perte', big: eur(w.alone.left), title: `${losers.length} ${plural(losers.length, 'produit vendu', 'produits vendus')} à perte quand ${plural(losers.length, 'il est seul', 'ils sont seuls')}`,
      text: `${losers.map(x => x.p.title).join(', ')}. Pire cas : ${w.p.title}, ${eur(w.alone.left)} par commande (${w.p.sold} vendus sur la période).` })
  } else {
    const worst = [...products].sort((a, b) => a.alone.left - b.alone.left)[0]
    out.push({ tone: worst.alone.verdict, big: eur(worst.alone.left), title: 'Aucun produit vendu à perte quand il est seul',
      text: `Le moins rentable seul : ${worst.p.title}, ${eur(worst.alone.left)} par commande après pub.` })
  }

  const last = PACK_RULES.discounts[PACK_RULES.discounts.length - 1]
  const atMax = (x: (typeof products)[number]) => x.add[x.add.length - 1]
  const out15 = products.filter(x => atMax(x).verdict !== 'rentable').sort((a, b) => atMax(a).left - atMax(b).left)
  if (out15.length) {
    out.push({ tone: atMax(out15[0]).verdict, big: eur(atMax(out15[0]).left), title: `${out15.length} ${plural(out15.length, 'produit', 'produits')} à sortir du pack`,
      text: `${out15.map(x => `${x.p.title} (${eur(atMax(x).left)} à ${last.label})`).join(', ')}.` })
  } else {
    const best = [...products].sort((a, b) => atMax(b).left - atMax(a).left)[0]
    out.push({ tone: 'rentable', big: eur(atMax(best).left), title: `Tous les produits ont leur place dans le pack, même à ${last.label}`,
      text: `Le meilleur à ajouter : ${best.p.title}, ${eur(atMax(best).left)} restants à ${last.label}.` })
  }

  const ideal = baskets.filter(b => b.count > 0).sort((a, b) => b.afterPub - a.afterPub)[0]
  if (ideal) out.push({ tone: verdictOf(ideal.afterPub), big: eur(ideal.afterPub), title: `Panier idéal : ${ideal.label}`,
    text: `${eur(ideal.afterPub)} de profit par commande après pub (${ideal.count} commandes sur la période).` })

  const single = baskets.find(b => b.items === 1)
  if (single && single.count > 0) out.push({ tone: verdictOf(single.afterPub), big: eur(single.afterPub), title: 'Commande d’un seul article',
    text: `${single.count} commandes sur la période, ${eur(single.afterPub)} de profit chacune après pub.` })

  return out.slice(0, 4)
}
