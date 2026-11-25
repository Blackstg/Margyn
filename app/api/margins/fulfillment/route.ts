// Coût de livraison d'une période de VENTES (Moom) : réel facturé par n° de commande,
// prévision selon le contenu du colis pour les commandes pas encore facturées.
//   GET ?brand=moom&from=YYYY-MM-01&to=YYYY-MM-DD
//   → { fulfillment: €, matched, orders, estimated, port, note }
// Calcul partagé avec la page Marges : lib/shippingCost.ts.
import { NextRequest, NextResponse } from 'next/server'
import { orderShippingCosts, costNote } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const c = from && to ? await orderShippingCosts(brand, from, to) : null
  const orders = c?.byOrder.size ?? 0
  if (!c || orders === 0) return NextResponse.json({ fulfillment: -1, matched: 0, orders: 0 })

  let total = 0, port = 0
  for (const o of c.byOrder.values()) { total += o.cost; port += o.port }
  return NextResponse.json({
    fulfillment: Math.round(total), matched: c.counts.réel, orders, estimated: orders - c.counts.réel,
    port: Math.round(port), note: costNote(c),
  })
}
