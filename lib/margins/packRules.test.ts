// npm test — ce qu'il reste par produit et verdicts (Marges › Par commande).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aloneOutcome, addOutcomes, verdictOf, takeaways, priceExVat, PACK_RULES, type ProductEconomics } from './packRules'

const ctx = { pubPerOrder: 24.47, feeRate: 0.017, portAlone: 5.52 }
// Ordres de grandeur de novembre 2026 (prix catalogue, coûts d'envoi/d'ajout du modèle)
const mumEssential: ProductEconomics = { key: 'me', title: 'MumEssential', image: null, price: 77.5, purchase: 15.45, sendAlone: 32.43, addCost: 26.9, sold: 105 }
const mumCaddy: ProductEconomics = { key: 'mc', title: 'MumCaddy', image: null, price: 48.3, purchase: 11.44, sendAlone: 25.99, addCost: 20.46, sold: 86 }
const cary: ProductEconomics = { key: 'ce', title: 'CaryExplorer', image: null, price: 122.4, purchase: 20.8, sendAlone: 21.2, addCost: 15.66, sold: 127 }
const kit: ProductEconomics = { key: 'ke', title: 'KitExplorer', image: null, price: 27.3, purchase: 3.14, sendAlone: 8.46, addCost: 2.93, sold: 35 }
const near = (a: number, b: number, tol = 0.1) => assert.ok(Math.abs(a - b) <= tol, `${a.toFixed(2)} ≠ ${b}`)

test('vendu seul : prix − achat − envoi − frais − pub, et avec le port payé', () => {
  const o = aloneOutcome(mumEssential, ctx)
  near(o.left, 3.8)
  near(o.leftWithPort, 9.4)
  assert.equal(o.verdict, 'limite')
})

test('ajouté dans un colis : 4 cas de remise, sans pub', () => {
  const at15 = (p: ProductEconomics) => addOutcomes(p).find(a => a.pct === 0.15)!.left
  near(at15(mumCaddy), 9.2)
  near(at15(cary), 67.6)
  near(at15(kit), 17.1)
  const all = addOutcomes(kit)
  assert.deepEqual(all.map(a => a.pct), [0, 0.1, 0.12, 0.15])
  near(all[0].left, 27.3 - 3.14 - 2.93)
})

test('verdict : rentable ≥ 5 €, limite entre 0 et 5 €, à perte en dessous de 0', () => {
  assert.equal(verdictOf(5), 'rentable')
  assert.equal(verdictOf(4.99), 'limite')
  assert.equal(verdictOf(0), 'limite')
  assert.equal(verdictOf(-0.01), 'perte')
  assert.equal(verdictOf(7, 10), 'limite')   // seuil modifiable
})

test('TVA : 0 % par défaut (prix payé = CA), réglable', () => {
  assert.equal(PACK_RULES.vatRate, 0)
  assert.equal(priceExVat(120), 120)
  assert.equal(priceExVat(120, 0.2), 100)
})

test('bandeau « À retenir » : à perte, à sortir du pack, panier idéal', () => {
  const products = [mumEssential, mumCaddy, cary, kit].map(p => ({ p, alone: aloneOutcome(p, ctx), add: addOutcomes(p) }))
  const t = takeaways(products, [
    { items: 1, label: '1 article', afterPub: 9.99, count: 755 },
    { items: 3, label: '3 articles', afterPub: 54.65, count: 45 },
  ])
  assert.match(t[0].title, /2 produits vendus à perte/)          // MumCaddy et KitExplorer seuls
  assert.equal(t[0].tone, 'perte')
  assert.match(t[1].title, /Tous les produits ont leur place/)  // −15 % : tous ≥ 5 €
  assert.match(t[2].title, /Panier idéal : 3 articles/)
  assert.ok(t.length <= 4)
})
