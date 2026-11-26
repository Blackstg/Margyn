// Assemble le plan de toutes les variantes à partir des données chargées
// (lib/reorder/data.ts). Pur : la page le recalcule à chaque réglage modifié.
import {
  addDays, planVariant, receiptProposals, recentEstimate, ruptureKpis, stockJumps, velocity,
  type OpenLine, type ReceiptProposal, type ReorderSettings, type SalesHistory, type VariantPlan, type Velocity,
} from './plan'

export type ReorderVariant = {
  id: string; productId: string; title: string; variantTitle: string | null; sku: string | null
  image: string | null; stock: number; price: number; cost: number
}

export type ReorderOrderLine = {
  id: string; variantId: string; title: string; variantTitle: string | null; sku: string | null
  qty: number; unitCost: number; receivedQty: number
}

export type ReorderOrder = {
  id: string; orderedOn: string; prodDoneOn: string; arrivalOn: string
  status: 'open' | 'received' | 'cancelled'; source: 'validated' | 'declared' | 'after_the_fact' | 'invoice'
  totalCost: number; receivedOn: string | null; note: string | null
  invoice: { supplier: string | null; number: string | null; currency: string; total: number; deposit: number; balance: number } | null
  lines: ReorderOrderLine[]
}

export type ReorderInputs = {
  today: string
  variants: ReorderVariant[]
  sales: Record<string, Record<string, number>>      // variante → jour → unités
  firstSale: Record<string, string>                   // première vente connue
  snapshots: Record<string, Record<string, number>>  // variante → jour → stock (tous entrepôts)
  earliestSnapshot: string | null
  orders: ReorderOrder[]
  snoozes: Record<string, string>                     // variante → relance après cette date
  manual: Record<string, number>                      // « En prod. » saisi à la main (secours)
  settings: ReorderSettings
}

export type ReorderRow = ReorderVariant & { velocity: Velocity; plan: VariantPlan; open: OpenLine[] }

export function openLinesByVariant(orders: ReorderOrder[]): Record<string, OpenLine[]> {
  const out: Record<string, OpenLine[]> = {}
  for (const o of orders) {
    if (o.status !== 'open') continue
    for (const l of o.lines) {
      const remaining = l.qty - l.receivedQty
      if (remaining <= 0) continue
      ;(out[l.variantId] ??= []).push({ orderId: o.id, orderedOn: o.orderedOn, prodDoneOn: o.prodDoneOn, arrivalOn: o.arrivalOn, remaining })
    }
  }
  return out
}

export function history(inp: ReorderInputs, v: ReorderVariant): SalesHistory {
  const sales = inp.sales[v.id] ?? {}
  const days = Object.keys(sales)
  return {
    sales, stock: inp.snapshots[v.id] ?? {}, stockNow: v.stock,
    firstSale: inp.firstSale[v.id] ?? null,
    lastSale: days.length ? days.reduce((a, b) => (a > b ? a : b)) : null,
  }
}

export function computeReorder(inp: ReorderInputs, settings: ReorderSettings = inp.settings) {
  const { today } = inp
  const openBy = openLinesByVariant(inp.orders)
  const histories = new Map(inp.variants.map((v) => [v.id, history(inp, v)]))

  const base = new Map(inp.variants.map((v) => [v.id, velocity(histories.get(v.id)!, settings, today)]))
  // Variantes récentes : estimation à partir des autres couleurs du produit (ou de toute la marque).
  const settled = (v: ReorderVariant) => (base.get(v.id)!.usefulDays >= settings.minUsefulDays ? [{ h: histories.get(v.id)!, daily: base.get(v.id)!.daily }] : [])
  const vels = new Map(inp.variants.map((v) => {
    const vel = base.get(v.id)!
    const sameProduct = inp.variants.filter((o) => o.productId === v.productId && o.id !== v.id).flatMap(settled)
    const est = recentEstimate(histories.get(v.id)!, vel, sameProduct, settings, today)
      ?? recentEstimate(histories.get(v.id)!, vel, inp.variants.filter((o) => o.id !== v.id).flatMap(settled), settings, today)
    return [v.id, est ?? vel]
  }))

  const rows: ReorderRow[] = inp.variants.map((v) => {
    const vel = vels.get(v.id)!
    const open = openBy[v.id] ?? []
    const plan = planVariant({
      stock: v.stock, daily: vel.daily, open, manual: inp.manual[v.id] ?? 0,
      snoozedUntil: inp.snoozes[v.id] ?? null, rule: settings.products[v.productId], today,
    }, settings)
    return { ...v, velocity: vel, plan, open }
  })

  const since = addDays(today, -21)
  const jumps = rows.flatMap((r) => stockJumps(r.id, histories.get(r.id)!, r.velocity.daily, since))
  const proposals: ReceiptProposal[] = receiptProposals(jumps, openBy, settings.dismissedJumps)

  const engaged = inp.orders.filter((o) => o.status === 'open')
    .reduce((a, o) => a + o.lines.reduce((b, l) => b + Math.max(0, l.qty - l.receivedQty) * l.unitCost, 0), 0)
  const kpis = {
    ...ruptureKpis(rows.map((r) => ({ h: histories.get(r.id)!, daily: r.velocity.daily, price: r.price })), today, inp.earliestSnapshot),
    engaged,
  }
  return { rows, proposals, kpis }
}
