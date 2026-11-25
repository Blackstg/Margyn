// Coût de livraison RÉEL par produit (Moom) à partir des factures logisticien.
//   GET ?brand=moom&from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { byVariant: {variant_id: €}, byProduct: {product_id: €}, matched, orders, real, cpo_fallback, est_label }
//
// Même coût par commande que le tableau de bord (lib/shippingCost.ts), réparti sur
// les produits de chaque commande au prorata du CA.
import { NextRequest, NextResponse } from 'next/server'
import { orderShippingCosts } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const c = from && to ? await orderShippingCosts(brand, from, to) : null
  if (!c) return NextResponse.json({ byVariant: {}, byProduct: {}, matched: 0, orders: 0, real: 0 })

  const orderRevenue = new Map<string, number>()
  for (const s of c.sales) if (s.order_id) orderRevenue.set(String(s.order_id), (orderRevenue.get(String(s.order_id)) ?? 0) + (s.revenue || 0))

  const byVariant: Record<string, number> = {}
  const byProduct: Record<string, number> = {}
  let total = 0
  for (const s of c.sales) {
    if (!s.order_id) continue
    const oid = String(s.order_id)
    const tot = orderRevenue.get(oid) ?? 0
    const share = tot > 0 ? (c.costByOrder.get(oid) ?? 0) * ((s.revenue || 0) / tot) : 0
    if (s.variant_id) byVariant[String(s.variant_id)] = (byVariant[String(s.variant_id)] ?? 0) + share
    if (s.shopify_product_id) byProduct[String(s.shopify_product_id)] = (byProduct[String(s.shopify_product_id)] ?? 0) + share
    total += share
  }

  return NextResponse.json({
    byVariant, byProduct,
    matched: c.matched,               // commandes avec coût RÉEL (facturé)
    orders: c.costByOrder.size,       // commandes totales sur la période
    real: Math.round(total),
    cpo_fallback: Math.round(c.fallbackCpo),
    est_label: c.estLabel,
  })
}
