// npm test — Réappro : ventes par jour glissantes, seuils, quantités, réceptions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS, addDays, velocity, planVariant, roundQty, ruptureDate, stockJumps, receiptProposals, ruptureKpis,
  triggerDays, targetDays, type SalesHistory, type ReorderSettings,
} from './plan'

const today = '2026-11-26'
const s: ReorderSettings = { ...DEFAULT_SETTINGS, promos: [] }
const hist = (perDay: (day: string) => number, days = 200, extra: Partial<SalesHistory> = {}): SalesHistory => {
  const sales: Record<string, number> = {}
  for (let i = 1; i <= days; i++) { const d = addDays(today, -i); const q = perDay(d); if (q) sales[d] = q }
  const ds = Object.keys(sales).sort()
  return { sales, stock: {}, stockNow: 50, firstSale: ds[0] ?? null, lastSale: ds.at(-1) ?? null, ...extra }
}

test('ventes par jour : 60 derniers jours, aujourd’hui exclu', () => {
  const v = velocity(hist(() => 2), s, today)
  assert.equal(v.usefulDays, 60)
  assert.equal(v.daily, 2)
  assert.equal(v.to, '2026-11-25')
})

test('périodes promo exclues comme les jours de rupture', () => {
  const promo = { ...s, promos: [{ from: '2026-11-06', to: '2026-11-30', label: 'BF' }] }
  const v = velocity(hist((d) => (d >= '2026-11-06' ? 10 : 2)), promo, today)
  assert.equal(v.promo, 20)
  assert.equal(v.usefulDays, 40)       // 60 − 20 jours de promo, assez pour ne pas élargir
  assert.equal(v.daily, 2)
})

test('moins de 30 jours utiles : on remonte jusqu’à 60 jours utiles', () => {
  const promo = { ...s, promos: [{ from: '2026-10-01', to: '2026-11-30', label: 'long' }] }
  const v = velocity(hist((d) => (d >= '2026-10-01' ? 10 : 3)), promo, today)
  assert.equal(v.usefulDays, 60)
  assert.equal(v.daily, 3)
  assert.equal(v.from, addDays('2026-10-01', -60))
})

test('rupture estimée : à 0 aujourd’hui → jours depuis la dernière vente exclus', () => {
  const h = hist((d) => (d <= '2026-11-12' ? 2 : 0), 200, { stockNow: 0 })
  const v = velocity(h, s, today)
  assert.equal(v.rupture, 13)          // du 13/11 au 25/11
  assert.equal(v.daily, 2)
})

test('rupture relevée : un relevé à 0 exclut le jour, même avec du stock aujourd’hui', () => {
  const h = hist(() => 1, 200, { stock: { '2026-11-20': 0, '2026-11-21': 0 } })
  assert.equal(velocity(h, s, today).rupture, 2)
})

test('pics plafonnés à 3× la moyenne (minimum 3 unités)', () => {
  const v = velocity(hist((d) => (d === '2026-11-01' ? 120 : 1)), s, today)
  assert.equal(v.capped, 1)
  assert.ok(v.daily < 1.2, `${v.daily}`)
})

test('arrondi : minimum de commande puis multiple de colisage supérieur', () => {
  assert.equal(roundQty(37), 37)
  assert.equal(roundQty(37, { pack: 20 }), 40)
  assert.equal(roundQty(37, { moq: 100, pack: 30 }), 120)
  assert.equal(roundQty(0, { moq: 100 }), 0)
})

test('seuil 100 j, objectif 130 j ; position = stock + production + transit', () => {
  assert.equal(triggerDays(s), 100)
  assert.equal(targetDays(s), 130)
  const open = [
    { orderId: 'a', orderedOn: '2026-11-10', prodDoneOn: '2026-12-10', arrivalOn: '2027-01-19', remaining: 40 },
    { orderId: 'b', orderedOn: '2026-10-01', prodDoneOn: '2026-10-31', arrivalOn: '2026-12-10', remaining: 60 },
  ]
  const p = planVariant({ stock: 50, daily: 2, open, manual: 0, snoozedUntil: null, today }, s)
  assert.equal(p.inProduction, 40)
  assert.equal(p.inTransit, 60)
  assert.equal(p.position, 150)        // 75 jours < 100 → à commander
  assert.equal(p.status, 'order')
  assert.equal(p.suggested, 2 * 130 - 150)
  assert.equal(p.orderBy, addDays(today, 75 - 100))
})

test('au-dessus du seuil : rien à commander, date limite dans le futur', () => {
  const p = planVariant({ stock: 400, daily: 2, open: [], manual: 0, snoozedUntil: null, today }, s)
  assert.equal(p.suggested, 0)
  assert.equal(p.status, 'ok')
  assert.equal(p.orderBy, addDays(today, 100))
  assert.equal(p.lateBy, 0)
})

test('« Pas maintenant » : plus de relance jusqu’à la date', () => {
  const p = planVariant({ stock: 10, daily: 2, open: [], manual: 0, snoozedUntil: addDays(today, 14), today }, s)
  assert.equal(p.status, 'snoozed')
})

test('date de rupture : les arrivées prévues repoussent la rupture ; retard réel', () => {
  assert.equal(ruptureDate(10, 2, [], today), addDays(today, 5))
  assert.equal(ruptureDate(10, 2, [{ orderId: 'a', orderedOn: today, prodDoneOn: today, arrivalOn: addDays(today, 3), remaining: 20 }], today), addDays(today, 15))
  const p = planVariant({ stock: 0, daily: 2, open: [], manual: 0, snoozedUntil: null, today }, s)
  assert.equal(p.ruptureOn, today)
  assert.equal(p.lateBy, 70)           // commandé aujourd'hui, arrive dans 70 j
})

test('réception détectée : hausse nette rattachée à la commande en cours', () => {
  const h: SalesHistory = { sales: { '2026-11-24': 3 }, stock: { '2026-11-22': 4, '2026-11-23': 2, '2026-11-24': 180 }, stockNow: 180, firstSale: '2026-01-01', lastSale: '2026-11-24' }
  const jumps = stockJumps('v1', h, 2, '2026-11-01')
  assert.deepEqual(jumps, [{ variantId: 'v1', day: '2026-11-24', qty: 181 }])
  const open = { v1: [{ orderId: 'o1', orderedOn: '2026-09-01', prodDoneOn: '2026-10-01', arrivalOn: '2026-11-10', remaining: 200 }] }
  const [p] = receiptProposals(jumps, open, [])
  assert.equal(p.kind, 'order')
  assert.equal(p.qty, 181)
  assert.equal(receiptProposals(jumps, {}, [])[0].kind, 'unplanned')
  assert.equal(receiptProposals(jumps, open, ['v1|2026-11-24']).length, 0)
})

test('indicateurs : rupture en cours et CA perdu sur le mois', () => {
  const h = hist((d) => (d <= '2026-11-12' ? 2 : 0), 200, { stockNow: 0 })
  const k = ruptureKpis([{ h, daily: 2, price: 25 }], today, null)
  assert.equal(k.ruptureNow, 1)
  assert.equal(k.daysWithoutRupture, 0)
  assert.equal(k.lostThisMonth, 14 * 2 * 25)   // du 13 au 26 novembre
})
