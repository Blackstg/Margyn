export interface ShopifyConfig {
  shop: string
  accessToken: string
  brand: string
}

// ─── Raw Shopify types ────────────────────────────────────────────────────────

interface ShopifyMoneySet {
  shop_money: { amount: string; currency_code: string }
}

interface ShopifyRefundLineItem {
  quantity: number
  subtotal: string
  line_item: { variant_id: number; price: string }
}

interface ShopifyRefundTransaction {
  kind: string
  status: string
  amount: string
}

interface ShopifyRefund {
  refund_line_items: ShopifyRefundLineItem[]
  transactions: ShopifyRefundTransaction[]
}

interface ShopifyLineItem {
  variant_id: number
  title: string        // product title at time of order (present even for deleted variants)
  quantity: number
  price: string
  total_discount: string
}

export interface ShopifyOrder {
  id: number
  created_at: string
  financial_status: string
  cancel_reason: string | null
  total_price: string
  subtotal_price: string
  total_discounts: string
  total_shipping_price_set: ShopifyMoneySet
  line_items: ShopifyLineItem[]
  refunds: ShopifyRefund[]
}

interface ShopifyVariant {
  id: number
  title: string
  sku: string
  price: string
  inventory_item_id: number
  inventory_quantity: number
}

export interface ShopifyProduct {
  id: number
  title: string
  status: string
  image?: { src: string }
  images?: Array<{ src: string; variant_ids: number[] }>
  variants: ShopifyVariant[]
}

interface ShopifyInventoryItem {
  id: number
  cost?: string
}

// ─── Computed types ───────────────────────────────────────────────────────────

export interface DailyMetrics {
  date: string
  brand: string
  total_sales: number
  gross_profit: number
  gross_margin: number
  order_count: number
  cogs: number
  fulfillment_cost: number
  returns: number
  discounts: number
  gifting_count: number
  gifting_cogs: number
}

export interface NormalizedProduct {
  shopify_id: string
  brand: string
  title: string
  sku: string | null
  cost_price: number | null
  sell_price: number | null
  stock_quantity: number
  image_url: string | null
}

export interface NormalizedVariant {
  shopify_variant_id: string
  shopify_product_id: string
  brand: string
  product_title: string
  variant_title: string | null
  sku: string | null
  cost_price: number | null
  sell_price: number | null
  stock_quantity: number
  image_url: string | null
  product_status: string
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function parseNextPageInfo(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
  return match ? match[1] : null
}

async function shopifyFetch<T>(
  config: ShopifyConfig,
  path: string
): Promise<{ data: T; nextPageInfo: string | null }> {
  const res = await fetch(`https://${config.shop}/admin/api/2024-01/${path}`, {
    headers: {
      'X-Shopify-Access-Token': config.accessToken,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Shopify API error ${res.status} on ${path}: ${body}`)
  }
  return {
    data: await res.json(),
    nextPageInfo: parseNextPageInfo(res.headers.get('link')),
  }
}

// ─── Timezone helper (Europe/Paris) ──────────────────────────────────────────

/**
 * Convert a local Paris date+time to a UTC ISO string.
 * Works correctly through CET (UTC+1) / CEST (UTC+2) transitions.
 *
 * Strategy: start with the naive UTC interpretation, format it back in
 * Europe/Paris to measure the offset, then subtract the offset.
 * One pass is sufficient for daily boundaries (no ambiguous fold at midnight).
 */
function parisLocalToUTC(dateStr: string, time: string): string {
  const approx = new Date(`${dateStr}T${time}Z`)
  // Format approx UTC in Paris timezone → reveals what local time it represents
  const parisStr = approx.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' })
  // parisStr: "YYYY-MM-DD HH:MM:SS"
  const parisAsUTC = new Date(parisStr.replace(' ', 'T') + 'Z')
  const offsetMs = parisAsUTC.getTime() - approx.getTime()
  return new Date(approx.getTime() - offsetMs).toISOString()
}

/** Returns the Paris local date (YYYY-MM-DD) for a given UTC ISO string. */
function utcToParisDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
}

// ─── fetchOrders ─────────────────────────────────────────────────────────────

export async function fetchOrders(
  config: ShopifyConfig,
  dateFrom: string,
  dateTo: string
): Promise<ShopifyOrder[]> {
  // Convert Paris day boundaries to UTC so Shopify returns the right orders
  const createdAtMin = parisLocalToUTC(dateFrom, '00:00:00')
  const createdAtMax = parisLocalToUTC(dateTo, '23:59:59')

  console.log(
    `[${config.brand}] fetchOrders ${dateFrom}→${dateTo}` +
    ` | UTC window: ${createdAtMin} → ${createdAtMax}`
  )

  const orders: ShopifyOrder[] = []
  let path =
    `orders.json?status=any&limit=250` +
    `&created_at_min=${encodeURIComponent(createdAtMin)}` +
    `&created_at_max=${encodeURIComponent(createdAtMax)}` +
    `&fields=id,created_at,financial_status,total_price,subtotal_price,` +
    `total_discounts,total_shipping_price_set,line_items,refunds,cancel_reason`

  while (true) {
    const { data, nextPageInfo } = await shopifyFetch<{ orders: ShopifyOrder[] }>(
      config,
      path
    )
    orders.push(...data.orders)
    if (!nextPageInfo) break
    path = `orders.json?limit=250&page_info=${nextPageInfo}`
  }

  console.log(`[${config.brand}] Orders received: ${orders.length}`)

  return orders
}

// ─── fetchProducts ────────────────────────────────────────────────────────────

export async function fetchProducts(config: ShopifyConfig): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = []
  let path = `products.json?limit=250&status=active&fields=id,title,status,image,images,variants`

  while (true) {
    const { data, nextPageInfo } = await shopifyFetch<{ products: ShopifyProduct[] }>(
      config,
      path
    )
    products.push(...data.products)
    if (!nextPageInfo) break
    path = `products.json?limit=250&page_info=${nextPageInfo}`
  }

  return products
}

// ─── fetchInventoryCosts ──────────────────────────────────────────────────────

async function fetchInventoryCosts(
  config: ShopifyConfig,
  inventoryItemIds: number[]
): Promise<Map<number, number>> {
  const costMap = new Map<number, number>()
  // Shopify allows up to 100 IDs per request
  const chunks: number[][] = []
  for (let i = 0; i < inventoryItemIds.length; i += 100) {
    chunks.push(inventoryItemIds.slice(i, i + 100))
  }
  for (const chunk of chunks) {
    const { data } = await shopifyFetch<{ inventory_items: ShopifyInventoryItem[] }>(
      config,
      `inventory_items.json?ids=${chunk.join(',')}&fields=id,cost`
    )
    for (const item of data.inventory_items) {
      if (item.cost != null) costMap.set(item.id, parseFloat(item.cost))
    }
  }

  return costMap
}

// ─── computeMetrics ───────────────────────────────────────────────────────────

export async function computeMetrics(
  config: ShopifyConfig,
  orders: ShopifyOrder[],
  products: ShopifyProduct[],
  shippingRatePerOrder = 0
): Promise<DailyMetrics[]> {
  // Build variant_id → inventory_item_id map from products
  const variantToInventoryItem = new Map<number, number>()
  for (const product of products) {
    for (const variant of product.variants) {
      variantToInventoryItem.set(variant.id, variant.inventory_item_id)
    }
  }

  // Fetch COGS from inventory items
  const inventoryItemIds = Array.from(new Set(Array.from(variantToInventoryItem.values())))
  const costMap = await fetchInventoryCosts(config, inventoryItemIds)

  // variant_id → cost
  const variantCostMap = new Map<number, number>()
  for (const [variantId, inventoryItemId] of Array.from(variantToInventoryItem.entries())) {
    const cost = costMap.get(inventoryItemId)
    if (cost != null) variantCostMap.set(variantId, cost)
  }

  // Aggregate by date
  const byDate = new Map<
    string,
    {
      total_sales: number
      order_count: number
      cogs: number
      fulfillment_cost: number
      returns: number
      discounts: number
      gifting_count: number
      gifting_cogs: number
    }
  >()

  // Log raw totals before aggregation
  const rawTotal = orders
    .filter((o) => o.financial_status !== 'voided')
    .reduce((s, o) => s + parseFloat(o.total_price), 0)
  console.log(
    `[${config.brand}] computeMetrics: ${orders.length} orders` +
    ` | raw total_price sum: ${round(rawTotal)}€` +
    ` | voided: ${orders.filter((o) => o.financial_status === 'voided').length}`
  )

  for (const order of orders) {
    if (order.financial_status === 'voided' || order.financial_status === 'cancelled') continue

    // Bucket by Paris local date, not UTC date
    const date = utcToParisDate(order.created_at)
    const entry = byDate.get(date) ?? {
      total_sales: 0,
      order_count: 0,
      cogs: 0,
      fulfillment_cost: 0,
      returns: 0,
      discounts: 0,
      gifting_count: 0,
      gifting_cogs: 0,
    }

    const orderTotal = parseFloat(order.total_price)
    const shipping = parseFloat(
      order.total_shipping_price_set.shop_money.amount
    )
    const discounts = parseFloat(order.total_discounts)

    // COGS from line items
    let orderCogs = 0
    for (const item of order.line_items) {
      const cost = variantCostMap.get(item.variant_id)
      if (cost != null) orderCogs += cost * item.quantity
    }

    // Returns: sum refund transactions (authoritative amount returned to customer)
    let orderReturns = 0
    for (const refund of order.refunds) {
      for (const t of refund.transactions ?? []) {
        if (t.kind === 'refund' && t.status === 'success') {
          orderReturns += parseFloat(t.amount)
        }
      }
    }

    // total_sales = total_price − returns, matching Shopify Analytics "Ventes totales"
    // total_price already includes shipping, taxes, and has discounts baked in
    // 0€ orders are gifting/influencer sends — they contribute 0 to total_sales naturally
    entry.total_sales += orderTotal - orderReturns
    entry.order_count += 1
    entry.cogs += orderCogs
    entry.fulfillment_cost += shippingRatePerOrder > 0 ? shippingRatePerOrder : shipping
    entry.returns += orderReturns
    entry.discounts += discounts

    if (orderTotal === 0) {
      entry.gifting_count += 1
      entry.gifting_cogs += orderCogs
    }

    byDate.set(date, entry)
  }

  const metrics: DailyMetrics[] = []
  for (const [date, data] of Array.from(byDate.entries())) {
    const gross_profit =
      data.total_sales - data.cogs
    const gross_margin =
      data.total_sales > 0 ? (gross_profit / data.total_sales) * 100 : 0

    metrics.push({
      date,
      brand: config.brand,
      total_sales: round(data.total_sales),
      gross_profit: round(gross_profit),
      gross_margin: round(gross_margin),
      order_count: data.order_count,
      cogs: round(data.cogs),
      fulfillment_cost: round(data.fulfillment_cost),
      returns: round(data.returns),
      discounts: round(data.discounts),
      gifting_count: data.gifting_count,
      gifting_cogs: round(data.gifting_cogs),
    })
  }

  metrics.sort((a, b) => a.date.localeCompare(b.date))

  for (const m of metrics) {
    console.log(
      `[${config.brand}] ${m.date}: ${m.order_count} orders` +
      ` | sales: ${m.total_sales}€ | gross: ${m.gross_profit}€` +
      ` | cogs: ${m.cogs}€ | fulfillment: ${m.fulfillment_cost}€`
    )
  }

  return metrics
}

// ─── normalizeProducts ────────────────────────────────────────────────────────

export async function normalizeProducts(
  config: ShopifyConfig,
  products: ShopifyProduct[]
): Promise<NormalizedProduct[]> {
  const inventoryItemIds = products.flatMap((p) =>
    p.variants.map((v) => v.inventory_item_id)
  )
  const costMap = await fetchInventoryCosts(config, Array.from(new Set(inventoryItemIds)))

  const normalized: NormalizedProduct[] = []
  for (const product of products) {
    // Use first variant as representative
    const variant = product.variants[0]
    if (!variant) continue
    const cost = costMap.get(variant.inventory_item_id)

    normalized.push({
      shopify_id: String(product.id),
      brand: config.brand,
      title: product.title,
      sku: variant.sku || null,
      cost_price: cost != null ? round(cost) : null,
      sell_price: round(parseFloat(variant.price)),
      stock_quantity: variant.inventory_quantity,
      image_url: product.image?.src ?? null,
    })
  }

  return normalized
}

// ─── aggregateProductSales ────────────────────────────────────────────────────

export interface ProductDailySales {
  date: string
  brand: string
  order_id: string
  product_title: string
  variant_id: string
  variant_title: string | null
  shopify_product_id: string | null
  quantity: number
  revenue: number
}

export function aggregateProductSales(
  config: ShopifyConfig,
  orders: ShopifyOrder[],
  products: ShopifyProduct[]
): ProductDailySales[] {
  const variantMap = new Map<number, {
    product_id: string
    product_title: string
    variant_title: string | null
  }>()
  for (const product of products) {
    for (const variant of product.variants) {
      variantMap.set(variant.id, {
        product_id:    String(product.id),
        product_title: product.title,
        variant_title: variant.title !== 'Default Title' ? variant.title : null,
      })
    }
  }

  type Entry = {
    date: string
    brand: string
    order_id: string
    product_title: string
    variant_id: string
    variant_title: string | null
    shopify_product_id: string | null
    quantity: number
    revenue: number
  }
  // Key: order_id|variant_id — one row per (order, variant), preserving order identity
  const byKey = new Map<string, Entry>()

  for (const order of orders) {
    if (order.financial_status === 'voided' || order.financial_status === 'cancelled') continue
    const date     = utcToParisDate(order.created_at)
    const order_id = String(order.id)

    for (const item of order.line_items) {
      const info               = variantMap.get(item.variant_id)
      // Use the order's line_item.title as product_title when the variant is no longer
      // in the current Shopify catalog (deleted/archived). This preserves the product name
      // for historical orders, enabling cost lookups via title-based fallback.
      const product_title      = info?.product_title  ?? item.title ?? `Variant ${item.variant_id}`
      const shopify_product_id = info?.product_id     ?? null
      const variant_title      = info?.variant_title  ?? null
      const variant_id         = item.variant_id ? String(item.variant_id) : ''
      const revenue            = parseFloat(item.price) * item.quantity - parseFloat(item.total_discount)
      const key                = `${order_id}|${variant_id || product_title}`

      const prev = byKey.get(key) ?? {
        date, brand: config.brand, order_id, product_title, variant_id, variant_title,
        shopify_product_id, quantity: 0, revenue: 0,
      }
      byKey.set(key, { ...prev, quantity: prev.quantity + item.quantity, revenue: prev.revenue + revenue })
    }
  }

  const result: ProductDailySales[] = []
  for (const entry of byKey.values()) {
    result.push({
      date:                entry.date,
      brand:               entry.brand,
      order_id:            entry.order_id,
      product_title:       entry.product_title,
      variant_id:          entry.variant_id,
      variant_title:       entry.variant_title,
      shopify_product_id:  entry.shopify_product_id,
      quantity:            entry.quantity,
      revenue:             round(entry.revenue, 2),
    })
  }
  return result
}

// ─── normalizeVariants ────────────────────────────────────────────────────────

export async function normalizeVariants(
  config: ShopifyConfig,
  products: ShopifyProduct[]
): Promise<NormalizedVariant[]> {
  const inventoryItemIds = products.flatMap((p) => p.variants.map((v) => v.inventory_item_id))
  const costMap = await fetchInventoryCosts(config, Array.from(new Set(inventoryItemIds)))

  const result: NormalizedVariant[] = []
  for (const product of products) {
    // Build variant_id → image src map from product.images[].variant_ids
    const variantImageMap = new Map<number, string>()
    for (const img of product.images ?? []) {
      for (const vid of img.variant_ids) {
        if (!variantImageMap.has(vid)) variantImageMap.set(vid, img.src)
      }
    }

    for (const variant of product.variants) {
      const image_url = variantImageMap.get(variant.id) ?? product.image?.src ?? null
      result.push({
        shopify_variant_id: String(variant.id),
        shopify_product_id: String(product.id),
        brand:              config.brand,
        product_title:      product.title,
        variant_title:      variant.title !== 'Default Title' ? variant.title : null,
        sku:                variant.sku || null,
        cost_price:         costMap.has(variant.inventory_item_id) ? round(costMap.get(variant.inventory_item_id)!) : null,
        sell_price:         round(parseFloat(variant.price)),
        stock_quantity:     variant.inventory_quantity,
        image_url,
        product_status:     product.status,
      })
    }
  }
  return result
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals
}
