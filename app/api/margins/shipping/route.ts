// Coût de livraison RÉEL par commande (Moom) à partir des factures logisticien.
//   GET ?brand=moom&from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { byOrder: {order_id: €}, matched, orders, real, cpo_fallback, est_label }
//
// Même coût par commande que le tableau de bord (lib/shippingCost.ts). La page Marges
// le répartit ensuite sur les produits (au prorata du CA, ou vue « Marginale »).
import { NextRequest, NextResponse } from 'next/server'
import { orderShippingCosts } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const c = from && to ? await orderShippingCosts(brand, from, to) : null
  if (!c) return NextResponse.json({ byOrder: {}, matched: 0, orders: 0, real: 0 })

  const byOrder: Record<string, number> = {}
  let total = 0
  for (const [oid, eur] of c.costByOrder) { byOrder[oid] = Math.round(eur * 100) / 100; total += eur }

  return NextResponse.json({
    byOrder,
    matched: c.matched,               // commandes avec coût RÉEL (facturé)
    orders: c.costByOrder.size,       // commandes totales sur la période
    real: Math.round(total),
    cpo_fallback: Math.round(c.fallbackCpo),
    est_label: c.estLabel,
  })
}
