// npm test — ce qu'il reste par produit et verdicts (Marges › Par commande).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aloneOutcome, addOutcomes, verdictOf, takeaways, priceExVat, PACK_RULES, type ProductEconomics } from './packRules'

const ctx = { pubPerOrder: 24.47, feeRate: 0.017, portAlone: 5.52 }
// Ordres de grandeur de novembre 2026 (prix catalogue, coûts d'envoi/d'ajout du modèle)
const mumEssential: ProductEconomics = { key: 'me', title: 'MumEssential', image: null, price: 77.5, purchase: 15.45, sendAlone: 32.43, addCost: 26.9, soloOrders: 43 }
const mumCaddy: ProductEconomics = { key: 'mc', title: 'MumCaddy', image: null, price: 48.3, purchase: 11.44, sendAlone: 25.99, addCost: 20.46, soloOrders: 25 }
const cary: ProductEconomics = { key: 'ce', title: 'CaryExplorer', image: null, price: 122.4, purchase: 20.8, sendAlone: 21.2, addCost: 15.66, soloOrders: 40 }
const kit: ProductEconomics = { key: 'ke', title: 'KitExplorer', image: null, price: 27.3, purchase: 3.14, sendAlone: 8.46, addCost: 2.93, soloOrders: 4 }
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

test('bandeau « À retenir » : plus gros impact total, produits rarement seuls ignorés', () => {
  const walk: ProductEconomics = { key: 'we', title: 'WalkExplorer', image: null, price: 48.49, purchase: 9.5, sendAlone: 15.73, addCost: 10.2, soloOrders: 249 }
  const products = [mumEssential, mumCaddy, cary, kit, walk].map(p => ({ p, alone: aloneOutcome(p, ctx), add: addOutcomes(p) }))
  assert.equal(products.find(x => x.p.key === 'ke')!.alone.rare, true)              // 4 commandes seul : rare
  near(products.find(x => x.p.key === 'mc')!.alone.impact, 25 * products.find(x => x.p.key === 'mc')!.alone.left, 1e-9)
  const t = takeaways(products, [
    { items: 1, label: '1 article', afterPub: 9.99, count: 755 },
    { items: 3, label: '3 articles', afterPub: 54.65, count: 45 },
  ])
  // MumCaddy : −14 € × 25 = −360 € ; WalkExplorer : −1,8 € × 249 ≈ −460 € → Walk en avant
  assert.match(t[0].title, /^WalkExplorer seul : 249 commandes à −\d,\d\d € \(\+\d,\d\d € avec le port\)/)
  assert.equal(t[0].tone, 'perte')
  assert.match(t[0].text, /MumCaddy/)
  assert.doesNotMatch(t[0].text, /KitExplorer/)                                     // rare : ignoré
  assert.match(t[2].title, /Panier idéal : 3 articles/)
  assert.ok(t.length <= 4)
})

test('bandeau : carte verte si aucun produit vendu seul n’est à perte', () => {
  const t = takeaways([cary].map(p => ({ p, alone: aloneOutcome(p, ctx), add: addOutcomes(p) })), [])
  assert.equal(t[0].tone, 'rentable')
  assert.match(t[0].title, /Aucun produit vendu seul à perte/)
})
