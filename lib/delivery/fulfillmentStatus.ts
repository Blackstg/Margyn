// État « traitée » Shopify de chaque commande Bowa récente, croisé avec les
// livraisons Steero (onglet « Traitement Shopify ») :
//   manual   : reste des articles à traiter À LA MAIN (La Poste, échantillons…)
//   waiting  : reste des articles qui partent en camion → traités auto à la livraison
//   auto     : entièrement traitée par Steero (au « livré »)
//   done     : entièrement traitée, au moins en partie à la main
import { createClient } from '@supabase/supabase-js'
import { isSteeroTracking } from './shopifyFulfill'

const isPanel = (t: string) => /panneau/i.test(t)
const isStone = (t: string) => /stonepanel|feuille\s*de\s*pierre/i.test(t)
const isBulky = (t: string) => /tasseau|profil[ée]?s?\b|baguette|plinthe|corniche|liteau|lambourde|angle/i.test(t)
const isSample = (t: string) => /échantillon|echantillon|sample/i.test(t)
const needsTruck = (t: string) => !isSample(t) && (isPanel(t) || isStone(t) || isBulky(t))

type LI = { id: number; title: string; variant_title: string | null; sku: string | null; quantity: number; current_quantity?: number; fulfillable_quantity: number }
type F = { created_at: string; status: string; tracking_number: string | null; tracking_company: string | null; line_items: { id: number; quantity: number }[] }
type O = {
  id: number; name: string; created_at: string; cancelled_at: string | null; financial_status: string; fulfillment_status: string | null
  shipping_address?: { first_name?: string; last_name?: string; city?: string; zip?: string } | null
  customer?: { first_name?: string; last_name?: string } | null
  line_items: LI[]; fulfillments: F[]
}

async function fetchOrders(sinceIso: string): Promise<O[]> {
  const shop = process.env.SHOPIFY_BOWA_SHOP!
  const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!
  const out: O[] = []
  let url: string | null = `https://${shop}/admin/api/2024-01/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(sinceIso)}` +
    `&fields=id,name,created_at,cancelled_at,financial_status,fulfillment_status,shipping_address,customer,line_items,fulfillments`
  while (url) {
    const res: Response = await fetch(url, { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' })
    if (!res.ok) throw new Error(`Shopify ${res.status}`)
    out.push(...((await res.json()) as { orders: O[] }).orders)
    const next = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)
    url = next ? next[1] : null
  }
  return out
}

export async function fulfillmentStatus(days: number) {
  const orders = (await fetchOrders(new Date(Date.now() - days * 86400_000).toISOString()))
    .filter(o => !o.cancelled_at && o.financial_status !== 'refunded' && o.financial_status !== 'voided')

  // Livraisons Steero de ces commandes
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  type Stop = { shopify_order_id: string; status: string; delivered_at: string | null; panel_details: { title?: string; qty?: number }[] | null; delivery_tours: { planned_date: string; driver_name: string; status: string } | null }
  const stops: Stop[] = []
  const ids = orders.map(o => String(o.id))
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('delivery_stops')
      .select('shopify_order_id, status, delivered_at, panel_details, delivery_tours(planned_date, driver_name, status)')
      .in('shopify_order_id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
    stops.push(...((data ?? []) as unknown as Stop[]))
  }
  const stopsByOrder = new Map<string, Stop[]>()
  for (const s of stops) stopsByOrder.set(s.shopify_order_id, [...(stopsByOrder.get(s.shopify_order_id) ?? []), s])

  const rows = orders.map(o => {
    const os = stopsByOrder.get(String(o.id)) ?? []
    const success = (o.fulfillments ?? []).filter(f => f.status === 'success')
    const remaining = o.line_items
      .filter(li => li.fulfillable_quantity > 0 && (li.current_quantity ?? li.quantity) > 0)
      .map(li => ({ title: li.title, variant: li.variant_title, qty: li.fulfillable_quantity, truck: needsTruck(li.title), sample: isSample(li.title) }))
    // Arrêt encore à livrer dans une tournée active
    const active = os.find(s => s.status !== 'delivered' && s.delivery_tours && ['draft', 'planned', 'in_progress'].includes(s.delivery_tours.status))
    const activeTitles = new Set((active?.panel_details ?? []).map(p => p.title ?? ''))
    const lastDelivery = os.filter(s => s.delivered_at && (s.status === 'delivered' || s.status === 'partial')).map(s => s.delivered_at!).sort().pop() ?? null

    let state: 'manual' | 'waiting' | 'auto' | 'done'
    if (!remaining.length) state = success.length && success.every(f => isSteeroTracking(f.tracking_number)) ? 'auto' : 'done'
    else {
      // Reste un article camion → toute la commande part en tournée (colle, vis
      // voyagent avec les panneaux) et sera traitée au « livré ». Sinon, ce qui
      // n'est pas dans une tournée prévue est à traiter à la main (La Poste…).
      const truckLeft = remaining.some(r => r.truck)
      const allPlanned = remaining.every(r => activeTitles.has(r.title))
      state = truckLeft || (active && allPlanned) ? 'waiting' : 'manual'
    }
    const name = [o.shipping_address?.first_name ?? o.customer?.first_name, o.shipping_address?.last_name ?? o.customer?.last_name].filter(Boolean).join(' ')
    return {
      id: o.id, name: o.name, created_at: o.created_at, customer: name, city: o.shipping_address?.city ?? null,
      state, remaining,
      fulfillments: success.map(f => ({ at: f.created_at, by: isSteeroTracking(f.tracking_number) ? 'steero' : 'manual', tracking: [f.tracking_company, f.tracking_number].filter(Boolean).join(' · ') || null, qty: f.line_items.reduce((s, l) => s + l.quantity, 0) })),
      delivery: active
        ? { kind: 'planned', date: active.delivery_tours!.planned_date, driver: active.delivery_tours!.driver_name }
        : lastDelivery ? { kind: 'delivered', date: lastDelivery, driver: null } : null,
    }
  }).sort((a, b) => b.created_at.localeCompare(a.created_at))

  const counts = { manual: 0, waiting: 0, auto: 0, done: 0 }
  for (const r of rows) counts[r.state]++
  return { days, counts, rows }
}
