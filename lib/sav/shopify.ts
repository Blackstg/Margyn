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

// ─── Name matching helpers ────────────────────────────────────────────────────

/** Normalise un nom : minuscules, sans accents, sans ponctuation */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les diacritiques
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/**
 * Vérifie qu'au moins un mot du nom du client Shopify se retrouve
 * dans le texte du message (ou vice-versa). Tolérance sur accents/casse.
 */
function nameApproximatelyMatches(shopifyCustomer: ShopifyCustomer | undefined, messageText: string): boolean {
  if (!shopifyCustomer) return true // pas de client connu → on accepte
  const fullName = `${shopifyCustomer.first_name ?? ''} ${shopifyCustomer.last_name ?? ''}`.trim()
  if (!fullName) return true

  const normalizedMsg  = normalizeName(messageText)
  const normalizedName = normalizeName(fullName)

  // Un seul mot du nom suffit (prénom OU nom de famille)
  const words = normalizedName.split(/\s+/).filter(w => w.length >= 3)
  return words.some(word => normalizedMsg.includes(word))
}

/** Extrait le premier numéro de commande mentionné dans un texte (#28491, 28491…) */
function extractOrderNumber(text: string): string | null {
  const match = text.match(/#?(\d{4,6})\b/)
  return match ? match[1] : null
}

// ─── Order search ─────────────────────────────────────────────────────────────

const ORDER_FIELDS = 'order_number,fulfillment_status,financial_status,fulfillments,line_items,created_at,customer'

export async function getMostRecentOrder(
  email: string,
  messageBody?: string,
): Promise<MoomOrder | null> {
  // ── Tentative 1 : recherche par email ──────────────────────────────────────
  const url1 = `${base()}/orders.json?email=${encodeURIComponent(email)}&status=any&limit=1&fields=${ORDER_FIELDS}`
  const res1 = await fetch(url1, { headers: authHeaders(), cache: 'no-store' })
  if (!res1.ok) throw new Error(`[Shopify/SAV] getMostRecentOrder ${res1.status}: ${await res1.text()}`)

  const data1 = await res1.json() as { orders: ShopifyOrder[] }
  if (data1.orders && data1.orders.length > 0) {
    return formatOrder(data1.orders[0])
  }

  // ── Tentative 2 : recherche par numéro de commande (si mentionné) ──────────
  if (!messageBody) return null

  const orderNum = extractOrderNumber(messageBody)
  if (!orderNum) {
    console.log('[Shopify/SAV] Aucun numéro de commande détecté dans le message')
    return null
  }

  console.log(`[Shopify/SAV] Email introuvable — tentative par numéro de commande #${orderNum}`)

  const url2 = `${base()}/orders.json?name=${encodeURIComponent(`#${orderNum}`)}&status=any&limit=1&fields=${ORDER_FIELDS}`
  const res2 = await fetch(url2, { headers: authHeaders(), cache: 'no-store' })
  if (!res2.ok) {
    console.warn(`[Shopify/SAV] Recherche par numéro — ${res2.status}`)
    return null
  }

  const data2 = await res2.json() as { orders: ShopifyOrder[] }
  if (!data2.orders || data2.orders.length === 0) {
    console.log(`[Shopify/SAV] Commande #${orderNum} introuvable`)
    return null
  }

  const order = data2.orders[0]

  // Vérification approximative du nom client
  if (!nameApproximatelyMatches(order.customer, messageBody)) {
    console.warn(
      `[Shopify/SAV] Commande #${orderNum} trouvée mais nom client ne correspond pas` +
      ` (${order.customer?.first_name} ${order.customer?.last_name})`
    )
    return null
  }

  console.log(
    `[Shopify/SAV] Commande #${orderNum} trouvée via numéro` +
    ` (${order.customer?.first_name} ${order.customer?.last_name})`
  )
  return formatOrder(order)
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

interface ShopifyCustomer {
  first_name: string | null
  last_name:  string | null
  email:      string | null
}

interface ShopifyOrder {
  order_number:       number
  fulfillment_status: string | null
  financial_status:   string
  fulfillments:       ShopifyFulfillment[]
  line_items:         ShopifyLineItem[]
  created_at:         string
  customer?:          ShopifyCustomer
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
