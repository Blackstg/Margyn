// ─── Shopify client — Mōom SAV ───────────────────────────────────────────────
// Env vars: SHOPIFY_MOOM_STORE, SHOPIFY_MOOM_TOKEN

function base() {
  return `https://${process.env.SHOPIFY_MOOM_SHOP}/admin/api/2024-01`
}

function authHeaders(): Record<string, string> {
  return {
    'X-Shopify-Access-Token': process.env.SHOPIFY_MOOM_ACCESS_TOKEN!,
    'Content-Type': 'application/json',
  }
}

export interface OrderProduct {
  name:     string
  quantity: number
  price:    string
}

export interface MoomOrder {
  order_number:       string
  status_fr:          string
  financial_status_fr: string
  carrier:            string | null
  tracking_number:    string | null
  tracking_url:       string | null
  estimated_delivery: string | null
  products:           OrderProduct[]
  created_at:         string
}

const FULFILLMENT_STATUS_FR: Record<string, string> = {
  fulfilled:   'Expédiée',
  partial:     'Partiellement expédiée',
  unfulfilled: 'En préparation',
  restocked:   'Remboursée / restockée',
}

const FINANCIAL_STATUS_FR: Record<string, string> = {
  paid:             'Payée',
  pending:          'En attente de paiement',
  refunded:         'Remboursée',
  partially_refunded: 'Partiellement remboursée',
  voided:           'Annulée',
  authorized:       'Autorisée',
}

// ─── Catalog search ───────────────────────────────────────────────────────────
// Searches Shopify products by title fragment. Returns up to 5 matches with
// their variants and prices — used to price-check modification requests.

export interface CatalogProduct {
  title:    string
  variants: Array<{ title: string; price: string }>
}

export async function searchCatalog(query: string): Promise<CatalogProduct[]> {
  if (!query.trim()) return []
  // Shopify title search does partial matching — send the first 100 chars
  const url = `${base()}/products.json?title=${encodeURIComponent(query.slice(0, 100))}&limit=5&fields=id,title,variants`
  try {
    const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
    if (!res.ok) {
      console.warn(`[Shopify/SAV] searchCatalog "${query}" — ${res.status}`)
      return []
    }
    const data = await res.json() as {
      products: Array<{ title: string; variants: Array<{ title: string; price: string }> }>
    }
    return (data.products ?? []).map(p => ({
      title:    p.title,
      variants: (p.variants ?? []).map(v => ({ title: v.title, price: v.price })),
    }))
  } catch (err) {
    console.warn('[Shopify/SAV] searchCatalog error:', err)
    return []
  }
}

export async function getMostRecentOrder(email: string): Promise<MoomOrder | null> {
  const url = `${base()}/orders.json?email=${encodeURIComponent(email)}&status=any&limit=1`
  const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' })
  if (!res.ok) throw new Error(`[Shopify/SAV] getMostRecentOrder ${res.status}: ${await res.text()}`)

  const data = await res.json() as { orders: ShopifyOrder[] }
  if (!data.orders || data.orders.length === 0) return null

  return formatOrder(data.orders[0])
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface ShopifyFulfillment {
  tracking_company: string | null
  tracking_number:  string | null
  tracking_url:     string | null
  estimated_delivery_at: string | null
}

interface ShopifyLineItem {
  title:    string
  quantity: number
  price:    string
}

interface ShopifyOrder {
  order_number:       number
  fulfillment_status: string | null
  financial_status:   string
  fulfillments:       ShopifyFulfillment[]
  line_items:         ShopifyLineItem[]
  created_at:         string
}

function formatOrder(o: ShopifyOrder): MoomOrder {
  const fulfillment = o.fulfillments?.[0] ?? null

  return {
    order_number:        `#${o.order_number}`,
    status_fr:           FULFILLMENT_STATUS_FR[o.fulfillment_status ?? 'unfulfilled'] ?? o.fulfillment_status ?? 'Inconnue',
    financial_status_fr: FINANCIAL_STATUS_FR[o.financial_status] ?? o.financial_status,
    carrier:             fulfillment?.tracking_company ?? null,
    tracking_number:     fulfillment?.tracking_number ?? null,
    tracking_url:        fulfillment?.tracking_url ?? null,
    estimated_delivery:  fulfillment?.estimated_delivery_at
      ? new Date(fulfillment.estimated_delivery_at).toLocaleDateString('fr-FR', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : null,
    products: o.line_items.map((li) => ({
      name:     li.title,
      quantity: li.quantity,
      price:    li.price,
    })),
    created_at: o.created_at,
  }
}
