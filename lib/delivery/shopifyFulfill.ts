// Marque comme « traitée » (fulfilled) dans Shopify ce que le livreur a livré.
// Avant : Satiana pointait chaque commande à la main après la tournée (22 commandes
// livrées en oct. 2026 étaient encore « non traitées »).
// Idempotent : on ne traite que la quantité encore « à traiter » (fulfillable) de
// chaque article, donc relancer ne double rien. Client NON notifié (l'email de
// satisfaction Bowa part déjà à la livraison).

const API = '2024-01'
// Repère posé sur nos envois (n° de suivi) : distingue « traité par Steero » de « à la main »
export const STEERO_TRACKING = 'Livraison Bowa (Steero)'
// Shopify retire les espaces du n° stocké (« LivraisonBowa(Steero) ») → on compare sur le mot
export const isSteeroTracking = (n?: string | null) => /steero/i.test(n ?? '')

type Item = { sku?: string | null; title?: string | null; variant_title?: string | null; qty: number }

export type FulfillStop = {
  order_name?: string | null
  shopify_order_id?: string | null
  status: string
  panel_details?: { sku?: string; title?: string; variant_title?: string; qty?: number }[] | null
  partial_delivered?: { sku?: string; title?: string; qty_delivered?: number }[] | null
}

export type FulfillResult = { order: string; fulfilled: { title: string; qty: number }[]; skipped?: string; error?: string }

type FOLine = { id: number; line_item_id: number; fulfillable_quantity: number }
type FO = { id: number; status: string; line_items: FOLine[] }
type LineItem = { id: number; sku: string | null; title: string; variant_title: string | null }

function creds() {
  const shop = process.env.SHOPIFY_BOWA_SHOP
  const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN
  if (!shop || !token) throw new Error('Shopify Bowa non configuré')
  return { shop, token }
}

async function shopify<T>(path: string, init?: RequestInit): Promise<T> {
  const { shop, token } = creds()
  const res = await fetch(`https://${shop}/admin/api/${API}/${path}`, {
    ...init,
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Shopify ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<T>
}

// Ce qui a réellement été livré par cet arrêt
function deliveredItems(stop: FulfillStop): Item[] {
  if (stop.status === 'partial') {
    const details = stop.panel_details ?? []
    return (stop.partial_delivered ?? []).map(p => {
      const d = details.find(x => (p.sku && x.sku === p.sku) || x.title === p.title)
      return { sku: p.sku, title: p.title, variant_title: d?.variant_title, qty: p.qty_delivered ?? 0 }
    }).filter(i => i.qty > 0)
  }
  if (stop.status === 'delivered') return (stop.panel_details ?? []).map(d => ({ ...d, qty: d.qty ?? 0 })).filter(i => i.qty > 0)
  return []
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()

// Toutes les livraisons Steero d'UNE commande → on marque « traité » dans Shopify
// exactement ce qui a été livré au total, moins ce qui est déjà traité. Calcul au
// niveau commande (pas arrêt) : un arrêt partiel relu au rattrapage ne doit pas
// re-traiter ses articles (bug du 30/10/2026 sur #10908, #11008, #10935).
export async function fulfillOrder(stops: FulfillStop[], opts: { dryRun?: boolean } = {}): Promise<FulfillResult> {
  const order = stops[0]?.order_name ?? String(stops[0]?.shopify_order_id ?? '')
  const id = String(stops[0]?.shopify_order_id ?? '')
  if (!id) return { order, fulfilled: [], skipped: 'pas de commande Shopify liée' }
  const items = stops.flatMap(deliveredItems)
  if (!items.length) return { order, fulfilled: [], skipped: 'rien de livré' }

  try {
    const { order: o } = await shopify<{ order: {
      cancelled_at: string | null; financial_status: string
      line_items: (LineItem & { quantity: number })[]
      fulfillments: { status: string; line_items: { id: number; quantity: number }[] }[]
    } }>(`orders/${id}.json?fields=cancelled_at,financial_status,line_items,fulfillments`)
    if (o.cancelled_at || o.financial_status === 'refunded' || o.financial_status === 'voided')
      return { order, fulfilled: [], skipped: 'commande annulée / remboursée' }

    // Livré au total, réparti sur les lignes Shopify correspondantes
    const delivered = new Map<number, number>()
    for (const it of items) {
      // Même article : SKU d'abord, sinon titre (+ variante si connue)
      const matches = o.line_items.filter(li =>
        (it.sku && norm(li.sku) === norm(it.sku)) ||
        (!it.sku && norm(li.title) === norm(it.title) && (!it.variant_title || norm(li.variant_title) === norm(it.variant_title))))
      let need = it.qty
      for (const li of matches) {
        const q = Math.min(need, li.quantity - (delivered.get(li.id) ?? 0))
        if (q <= 0) continue
        delivered.set(li.id, (delivered.get(li.id) ?? 0) + q)
        need -= q
      }
    }
    // Déjà traité dans Shopify (par Steero ou à la main)
    const done = new Map<number, number>()
    for (const f of o.fulfillments ?? []) if (f.status === 'success')
      for (const l of f.line_items) done.set(l.id, (done.get(l.id) ?? 0) + l.quantity)

    const { fulfillment_orders } = await shopify<{ fulfillment_orders: FO[] }>(`orders/${id}/fulfillment_orders.json`)
    const open = fulfillment_orders.filter(f => f.status === 'open' || f.status === 'in_progress')
    const byFo = new Map<number, { id: number; quantity: number }[]>()
    const fulfilled: { title: string; qty: number }[] = []
    for (const li of o.line_items) {
      let need = (delivered.get(li.id) ?? 0) - (done.get(li.id) ?? 0)
      const start = need
      for (const f of open) for (const l of f.line_items) {
        if (need <= 0 || l.line_item_id !== li.id) continue
        const q = Math.min(need, l.fulfillable_quantity)
        if (q <= 0) continue
        need -= q
        byFo.set(f.id, [...(byFo.get(f.id) ?? []), { id: l.id, quantity: q }])
      }
      if (start - need > 0) fulfilled.push({ title: li.title, qty: start - need })
    }
    if (!byFo.size) return { order, fulfilled: [], skipped: 'déjà traitée dans Shopify' }

    if (!opts.dryRun) {
      // Une expédition par fulfillment order (un FO = un lieu d'expédition)
      for (const [foId, lines] of byFo) {
        await shopify('fulfillments.json', {
          method: 'POST',
          body: JSON.stringify({ fulfillment: { notify_customer: false, tracking_info: { number: STEERO_TRACKING }, line_items_by_fulfillment_order: [{ fulfillment_order_id: foId, fulfillment_order_line_items: lines }] } }),
        })
      }
    }
    return { order, fulfilled }
  } catch (e) {
    return { order, fulfilled: [], error: e instanceof Error ? e.message : String(e) }
  }
}

// Commandes (ids Shopify) pas encore entièrement traitées, en un appel par 250
export async function notFulfilledIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 250) {
    const chunk = ids.slice(i, i + 250)
    const { orders } = await shopify<{ orders: { id: number; fulfillment_status: string | null; cancelled_at: string | null }[] }>(
      `orders.json?status=any&limit=250&ids=${chunk.join(',')}&fields=id,fulfillment_status,cancelled_at`)
    for (const o of orders) if (o.fulfillment_status !== 'fulfilled' && !o.cancelled_at) out.add(String(o.id))
  }
  return out
}
