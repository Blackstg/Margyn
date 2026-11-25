// Coût de livraison RÉEL d'un mois de VENTES (Moom), rapproché PAR NUMÉRO DE COMMANDE.
//   GET ?brand=moom&from=YYYY-MM-01&to=YYYY-MM-DD
//   → { fulfillment: €, matched, orders, estimated, cpo_fallback, note }
// Calcul partagé avec la page Marges : lib/shippingCost.ts.
import { NextRequest, NextResponse } from 'next/server'
import { orderShippingCosts } from '@/lib/shippingCost'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? ''
  const from  = req.nextUrl.searchParams.get('from') ?? ''
  const to    = req.nextUrl.searchParams.get('to')   ?? ''
  const c = from && to ? await orderShippingCosts(brand, from, to) : null
  const orders = c?.costByOrder.size ?? 0
  if (!c || orders === 0) return NextResponse.json({ fulfillment: -1, matched: 0, orders: 0 })

  const total = Array.from(c.costByOrder.values()).reduce((s, v) => s + v, 0)
  const { matched, estimated, fallbackCpo, estLabel } = c
  const note = matched === 0
    ? `Estimé — ${estLabel} (${Math.round(fallbackCpo)} €/cmd, aucune facture rapprochée)`
    : `Réel — ${matched}/${orders} commandes rapprochées par n°` +
      (estimated > 0 ? ` (${estimated} au ${estLabel} ${Math.round(fallbackCpo)} €/cmd, pas encore facturées)` : '')

  return NextResponse.json({ fulfillment: Math.round(total), matched, orders, estimated, cpo_fallback: Math.round(fallbackCpo), note })
}
