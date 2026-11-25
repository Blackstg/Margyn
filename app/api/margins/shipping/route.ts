// Coût de livraison par commande (Moom) pour la page Marges — même calcul que le
// tableau de bord (lib/shippingCost.ts) : réel facturé, sinon prévision selon le
// contenu du colis. La page le répartit ensuite sur les produits.
//   GET ?brand=moom&from=YYYY-MM-DD&to=YYYY-MM-DD
//   → { byOrder: {order_id: { cost, source, port }}, counts, note, model, typical, grid }
import { NextRequest, NextResponse } from 'next/server'
import { orderShippingCosts, costNote } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const c = from && to ? await orderShippingCosts(brand, from, to) : null
  if (!c) return NextResponse.json({ byOrder: {}, counts: null, note: null, model: null, typical: [], grid: null })

  const byOrder: Record<string, { cost: number; source: string; port: number }> = {}
  for (const [oid, o] of c.byOrder) byOrder[oid] = { cost: Math.round(o.cost * 100) / 100, source: o.source, port: o.port }
  return NextResponse.json({ byOrder, counts: c.counts, note: costNote(c), model: c.summary, typical: c.typical, grid: c.grid })
}
