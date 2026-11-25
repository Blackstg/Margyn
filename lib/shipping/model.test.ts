// npm test — modèle de prévision du coût de livraison.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trainModel, predict, orderCost, extraItemCost, backtest, basketProducts, gridCost, shippingKey, type OrderFeatures, type ShippingGrid } from './model'

// Barème synthétique connu : 7 € par colis + 2 € hors France + 9 € par sac, 3 € par
// tapis, 0,5 € par attache offerte.
const truth = (f: OrderFeatures) =>
  7 + (f.zone === 'X' ? 2 : 0) + 9 * (f.products.sac ?? 0) + 3 * (f.products.tapis ?? 0) + 0.5 * (f.products['attache:offert'] ?? 0)

function sample(i: number): OrderFeatures {
  const sac = i % 3 === 0 ? 2 : 1
  const tapis = i % 2
  const products: Record<string, number> = { sac }
  if (tapis) products.tapis = tapis
  if (i % 4 === 0) products['attache:offert'] = 1
  return { zone: i % 7 === 0 ? 'X' : 'FR', paidItems: sac + tapis, products }
}

const train = Array.from({ length: 300 }, (_, i) => ({ features: sample(i), cost: truth(sample(i)) }))

test('niveau 2 : retrouve base et supplément par produit', () => {
  const m = trainModel(train)
  assert.ok(Math.abs(m.base - 7) < 0.3, `base ${m.base}`)
  assert.ok(Math.abs(m.intlExtra - 2) < 0.3, `hors FR ${m.intlExtra}`)
  assert.ok(Math.abs(m.products.sac.coef - 9) < 0.3)
  assert.ok(Math.abs(m.products.tapis.coef - 3) < 0.3)
  const f: OrderFeatures = { zone: 'FR', paidItems: 2, products: { sac: 1, tapis: 1 } }
  const p = predict(m, f)
  assert.equal(p.method, 'produit')
  assert.ok(Math.abs(p.cost - 19) < 0.5, `prévu ${p.cost}`)
})

test('repli niveau 2 → niveau 1 quand un produit a moins de 30 commandes', () => {
  const rare = { features: { zone: 'FR' as const, paidItems: 1, products: { nouveau: 1 } }, cost: 16 }
  const m = trainModel([...train, rare])
  assert.equal(m.products.nouveau.orders, 1)
  const p = predict(m, { zone: 'FR', paidItems: 2, products: { sac: 1, nouveau: 1 } })
  assert.equal(p.method, 'taille')
  assert.ok(Math.abs(p.cost - m.bySize['2FR'].avg) < 1e-9)
  // Vue marginale : produit inconnu du modèle → réglage manuel
  assert.equal(extraItemCost(m, 'nouveau', 1.5), 1.5)
  assert.ok(Math.abs(extraItemCost(m, 'tapis', 1.5) - 3) < 0.3)
})

test('niveau 1 : moyenne par taille, France / hors France seulement si échantillon suffisant', () => {
  // Produits tous différents → aucun n'atteint 30 commandes → niveau 1 seul.
  const m = trainModel(train.map((t, i) => ({ ...t, features: { ...t.features, products: { [`p${i}`]: 1 } } })))
  const fr = predict(m, { zone: 'FR', paidItems: 1, products: { p0: 1 } })
  assert.equal(fr.method, 'taille')
  assert.ok(Math.abs(fr.cost - m.bySize['1FR'].avg) < 1e-9)        // assez de commandes FR
  assert.ok(m.bySize['3X'].orders < 20)
  const x = predict(m, { zone: 'X', paidItems: 3, products: { p0: 1 } })
  assert.ok(Math.abs(x.cost - m.bySize['3'].avg) < 1e-9)           // trop peu hors FR → moyenne de la taille
})

test('bascule prévision → réel : la facture remplace toujours la prévision', () => {
  const m = trainModel(train)
  const f = sample(1)
  assert.deepEqual(orderCost(42.5, m, f, 21), { cost: 42.5, source: 'réel' })
  const prev = orderCost(undefined, m, f, 21)
  assert.equal(prev.source, 'produit')
  assert.ok(Math.abs(prev.cost - truth(f)) < 0.5)
  assert.deepEqual(orderCost(undefined, null, f, 21), { cost: 21, source: 'moyenne' })
})

test('avoirs logisticien (coût ≤ 0) exclus de l’apprentissage', () => {
  const m = trainModel([...train, { features: sample(5), cost: -40 }])
  assert.equal(m.orders, train.length)
})

test('contrôle qualité : écart nul sur un barème exact', () => {
  const m = trainModel(train)
  const r = backtest(m, train.slice(0, 60))
  assert.ok(Math.abs(r.total.errorPct ?? 1) < 0.01)
  for (const s of r.bySize) if (s.orders) assert.ok(Math.abs(s.errorPct ?? 1) < 0.03)
})

test('attaches offertes fusionnées dans leur sac ; version offerte = même produit', () => {
  const p = basketProducts([
    { title: 'MumExplorer™ Sac à Langer', qty: 1, free: false },
    { title: 'Strap MumExplorer™ Attaches poussette', qty: 1, free: true },
    { title: 'WalkExplorer™ Porte-bébé hanche', qty: 1, free: true },
    { title: 'WalkExplorer™ Porte-bébé hanche', qty: 1, free: false },
  ])
  assert.deepEqual(p, { [shippingKey('MumExplorer™ Sac à Langer')]: 1, [shippingKey('WalkExplorer™ Porte-bébé hanche')]: 2 })
  // Attache sans son sac : reste à part
  const seule = basketProducts([{ title: 'Strap MumEssential™ Attaches poussette', qty: 1, free: true }, { title: 'MatExplorer™ Tapis', qty: 1, free: false }])
  assert.equal(Object.keys(seule).length, 2)
})

test('grille : utilisée seulement si tous les poids sont connus, la facture reste prioritaire', () => {
  const grid: ShippingGrid = { importedAt: '2026-11-25', prepPerOrder: 1, rows: [
    { country: 'FR', maxKg: 1, price: 6 }, { country: 'FR', maxKg: 3, price: 9 }, { country: '*', maxKg: 3, price: 15 },
  ] }
  assert.equal(gridCost(grid, 'FR', { sac: 1, tapis: 1 }, { sac: 1800, tapis: 650 }), 10)     // 2,45 kg → 9 + 1
  assert.equal(gridCost(grid, 'BE', { tapis: 1 }, { tapis: 650 }), 16)                        // pays absent → '*'
  assert.equal(gridCost(grid, 'FR', { sac: 1, cary: 1 }, { sac: 1800 }), null)                // poids manquant
  assert.equal(gridCost(grid, 'FR', { sac: 2 }, { sac: 1800 }), null)                         // 3,6 kg : hors grille
  const m = trainModel(train)
  assert.deepEqual(orderCost(undefined, m, sample(1), 21, 10), { cost: 10, source: 'grille' })
  assert.deepEqual(orderCost(30, m, sample(1), 21, 10), { cost: 30, source: 'réel' })
  assert.equal(orderCost(undefined, m, sample(1), 21, null).source, 'produit')
})
