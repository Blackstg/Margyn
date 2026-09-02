// POST /api/delivery/order-dates
// Body: { ids: string[] }  (shopify_order_id des arrêts)
// → { dates: { [shopify_order_id]: created_at ISO } }
// Sert au planificateur (carte) pour afficher la date de commande d'un arrêt
// déjà planifié — la date Shopify n'est pas stockée sur delivery_stops.
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { ids } = (await req.json()) as { ids?: (string | number)[] }
    const clean = [...new Set((ids ?? []).map(String).map(s => s.trim()).filter(Boolean))]
    if (clean.length === 0) return NextResponse.json({ dates: {} })

    const shop  = process.env.SHOPIFY_BOWA_SHOP
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN
    if (!shop || !token) return NextResponse.json({ dates: {} })

    const dates: Record<string, string> = {}
    // Shopify accepte jusqu'à 250 ids par requête
    for (let i = 0; i < clean.length; i += 250) {
      const chunk = clean.slice(i, i + 250)
      const url = `https://${shop}/admin/api/2024-01/orders.json?ids=${chunk.join(',')}&status=any&limit=250&fields=id,created_at`
      const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' })
      if (!res.ok) continue
      const data = await res.json() as { orders?: { id: number; created_at: string }[] }
      for (const o of data.orders ?? []) dates[String(o.id)] = o.created_at
    }

    return NextResponse.json({ dates })
  } catch (err) {
    console.error('[delivery/order-dates POST]', err)
    return NextResponse.json({ dates: {}, error: String(err) }, { status: 500 })
  }
}
