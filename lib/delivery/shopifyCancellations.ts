// Commandes annulées / remboursées sur Shopify APRÈS leur mise en tournée.
// Un arrêt figé dans une tournée ne « voyait » pas l'annulation : en sept.–oct. 2026,
// #10619 et #10620 (annulées + remboursées) ont quand même été livrées. On revérifie
// Shopify au chargement des tournées (alerte livreur/planificateur) et au moment du
// « livré » (blocage côté serveur).

export type ShopifyAlert = {
  state: 'cancelled' | 'refunded' | 'items_refunded'
  at: string | null                              // date d'annulation / dernier remboursement
  refundedItems?: { title: string; qty: number }[] // articles retirés de la commande
}

type StopLike = {
  shopify_order_id?: string | null
  panel_details?: { sku?: string; title?: string; qty?: number }[] | null
}

type ShopifyOrder = {
  id: number
  cancelled_at: string | null
  financial_status: string | null
  line_items: { sku?: string | null; title: string; current_quantity?: number; quantity: number }[]
  refunds?: { created_at: string }[]
}

// Petit cache par instance : la liste des tournées est rechargée souvent (app livreur).
const TTL_MS = 3 * 60 * 1000
const cache = new Map<string, { at: number; order: ShopifyOrder | null }>()

async function fetchOrders(ids: string[]): Promise<Map<string, ShopifyOrder | null>> {
  const out = new Map<string, ShopifyOrder | null>()
  const now = Date.now()
  const missing: string[] = []
  for (const id of ids) {
    const c = cache.get(id)
    if (c && now - c.at < TTL_MS) out.set(id, c.order)
    else missing.push(id)
  }
  const shop = process.env.SHOPIFY_BOWA_SHOP
  const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN
  if (!shop || !token) return out
  for (let i = 0; i < missing.length; i += 250) {
    const chunk = missing.slice(i, i + 250)
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/orders.json?status=any&limit=250&ids=${chunk.join(',')}&fields=id,cancelled_at,financial_status,line_items,refunds`,
      { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`Shopify ${res.status}`)
    const { orders } = await res.json() as { orders: ShopifyOrder[] }
    const byId = new Map(orders.map(o => [String(o.id), o]))
    for (const id of chunk) {
      const o = byId.get(id) ?? null
      cache.set(id, { at: now, order: o })
      out.set(id, o)
    }
  }
  return out
}

function alertFor(stop: StopLike, o: ShopifyOrder | null): ShopifyAlert | null {
  if (!o) return null
  const lastRefund = (o.refunds ?? []).map(r => r.created_at).sort().pop() ?? null
  if (o.cancelled_at) return { state: 'cancelled', at: o.cancelled_at }
  if (o.financial_status === 'refunded' || o.financial_status === 'voided') return { state: 'refunded', at: lastRefund }
  // Articles remboursés après la mise en tournée : la qté prévue dépasse ce qui reste
  const refundedItems: { title: string; qty: number }[] = []
  for (const item of stop.panel_details ?? []) {
    const planned = item.qty ?? 0
    const lines = o.line_items.filter(li => (item.sku && li.sku?.trim() === item.sku.trim()) || li.title === item.title)
    if (!lines.length || planned <= 0) continue
    const remaining = lines.reduce((s, li) => s + (li.current_quantity ?? li.quantity), 0)
    if (remaining < planned) refundedItems.push({ title: item.title ?? item.sku ?? '', qty: planned - remaining })
  }
  return refundedItems.length ? { state: 'items_refunded', at: lastRefund, refundedItems } : null
}

// Alertes pour une liste d'arrêts (clé = shopify_order_id). En cas d'erreur Shopify,
// renvoie une map vide : on n'empêche jamais l'affichage des tournées.
export async function shopifyAlerts(stops: StopLike[]): Promise<Map<string, ShopifyAlert>> {
  const alerts = new Map<string, ShopifyAlert>()
  const ids = [...new Set(stops.map(s => String(s.shopify_order_id ?? '')).filter(Boolean))]
  if (!ids.length) return alerts
  try {
    const orders = await fetchOrders(ids)
    for (const s of stops) {
      const id = String(s.shopify_order_id ?? '')
      const a = id ? alertFor(s, orders.get(id) ?? null) : null
      if (a) alerts.set(id, a)
    }
  } catch (e) {
    console.error('[shopifyAlerts]', e)
  }
  return alerts
}

// Vérification au moment du « livré » : relit Shopify sans cache.
export async function blockingAlert(stop: StopLike): Promise<ShopifyAlert | null> {
  const id = String(stop.shopify_order_id ?? '')
  if (!id) return null
  cache.delete(id)
  try {
    const a = alertFor(stop, (await fetchOrders([id])).get(id) ?? null)
    return a && a.state !== 'items_refunded' ? a : null
  } catch (e) {
    console.error('[blockingAlert]', e)   // Shopify injoignable : on ne bloque pas le livreur
    return null
  }
}

export function alertMessage(a: ShopifyAlert): string {
  const d = a.at ? ` le ${new Date(a.at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''
  if (a.state === 'cancelled') return `Commande ANNULÉE sur Shopify${d} : ne pas livrer, garder la marchandise.`
  if (a.state === 'refunded') return `Commande REMBOURSÉE sur Shopify${d} : ne pas livrer, garder la marchandise.`
  return `Articles remboursés${d} : ne pas livrer ${(a.refundedItems ?? []).map(i => `${i.qty}× ${i.title}`).join(', ')}.`
}
