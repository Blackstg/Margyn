import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Zone = 'nord-est' | 'nord-ouest' | 'sud-est' | 'sud-ouest'

const ZONE_MAP: Record<string, Zone> = {
  '08':'nord-est','10':'nord-est','51':'nord-est','52':'nord-est','54':'nord-est',
  '55':'nord-est','57':'nord-est','67':'nord-est','68':'nord-est','88':'nord-est',
  '70':'nord-est','90':'nord-est','25':'nord-est','39':'nord-est','71':'nord-est',
  '21':'nord-est','89':'nord-est','58':'nord-est','02':'nord-est','60':'nord-est',
  '80':'nord-est','59':'nord-est','62':'nord-est',
  '75':'nord-ouest','77':'nord-ouest','78':'nord-ouest','91':'nord-ouest','92':'nord-ouest',
  '93':'nord-ouest','94':'nord-ouest','95':'nord-ouest','27':'nord-ouest','76':'nord-ouest',
  '14':'nord-ouest','50':'nord-ouest','61':'nord-ouest','72':'nord-ouest','53':'nord-ouest',
  '44':'nord-ouest','49':'nord-ouest','85':'nord-ouest','56':'nord-ouest','29':'nord-ouest',
  '22':'nord-ouest','35':'nord-ouest','45':'nord-ouest','28':'nord-ouest','41':'nord-ouest',
  '37':'nord-ouest','36':'nord-ouest','18':'nord-ouest','03':'nord-ouest',
  '01':'sud-est','38':'sud-est','73':'sud-est','74':'sud-est','69':'sud-est',
  '42':'sud-est','43':'sud-est','63':'sud-est','15':'sud-est','07':'sud-est',
  '26':'sud-est','84':'sud-est','04':'sud-est','05':'sud-est','06':'sud-est',
  '83':'sud-est','13':'sud-est','30':'sud-est','34':'sud-est','48':'sud-est',
  '12':'sud-est','81':'sud-est','82':'sud-est','31':'sud-est','09':'sud-est',
  '66':'sud-est','11':'sud-est',
  '64':'sud-ouest','65':'sud-ouest','32':'sud-ouest','40':'sud-ouest','47':'sud-ouest',
  '33':'sud-ouest','24':'sud-ouest','46':'sud-ouest','19':'sud-ouest','23':'sud-ouest',
  '87':'sud-ouest','16':'sud-ouest','17':'sud-ouest','86':'sud-ouest','79':'sud-ouest',
}

function detectZone(zip: string): Zone {
  const dept = (zip || '').replace(/\D/g, '').slice(0, 2).padStart(2, '0')
  return ZONE_MAP[dept] ?? 'nord-ouest'
}

// ─── Orders to log for diagnostic purposes ───────────────────────────────────
const DEBUG_ORDER_NAMES = new Set(['#9997', '#9917', '#9767', '#9759', '#9740', '#9728', '#9718'])

// ─── Internal / sample order detection ───────────────────────────────────────
// Bug 1 fix: filter orders tagged "echantillons"/"interne" or belonging to Bowa/Steero staff
const INTERNAL_TAGS   = /[eé]chantillons?|interne/i
const INTERNAL_NAMES  = /m[oō]om|mooom|steero/i

function isInternalOrder(tags: string, customerName: string, email: string): boolean {
  if (INTERNAL_TAGS.test(tags))        return true
  if (INTERNAL_NAMES.test(customerName)) return true
  if (INTERNAL_NAMES.test(email))      return true
  return false
}

// ─── Line-item filters ────────────────────────────────────────────────────────
const isSample = (title: string) => /échantillon|echantillon|sample/i.test(title)

// ─── Shopify types ─────────────────────────────────────────────────────────────

interface ShopifyFulfillmentLineItem {
  id: string
  quantity: number
}

interface ShopifyFulfillment {
  id:         string
  status:     string
  line_items: ShopifyFulfillmentLineItem[]
}

interface ShopifyLineItem {
  id:            string
  title:         string
  variant_title: string | null
  quantity:      number
  sku:           string
  variant_id:    number | null
}

interface ShopifyShippingAddress {
  first_name: string
  last_name:  string
  address1:   string
  address2:   string
  city:       string
  zip:        string
}

interface ShopifyOrder {
  id:               string
  name:             string
  email:            string
  created_at:       string
  tags:             string
  shipping_address: ShopifyShippingAddress | null
  line_items:       ShopifyLineItem[]
  fulfillments:     ShopifyFulfillment[]
}

// ─── Shopify fetch (unfulfilled + partial in parallel) ────────────────────────
// Bug 3 fix: include fulfillment_status=partial so preorders with one shipped
// accessory don't disappear from the list.

async function fetchShopifyOrders(shop: string, token: string): Promise<ShopifyOrder[]> {
  const fields =
    'id,name,email,created_at,tags,shipping_address,line_items,fulfillments'

  async function paginate(fulfillmentStatus: string): Promise<ShopifyOrder[]> {
    const result: ShopifyOrder[] = []
    let url: string | null =
      `https://${shop}/admin/api/2024-01/orders.json` +
      `?status=open&fulfillment_status=${fulfillmentStatus}&limit=250&fields=${fields}`

    while (url) {
      const fetchRes: Response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token },
        cache: 'no-store',
      })
      if (!fetchRes.ok) throw new Error(`Shopify ${fulfillmentStatus} ${fetchRes.status}`)
      const data = await fetchRes.json() as { orders?: ShopifyOrder[] }
      result.push(...(data.orders ?? []))
      const linkHeader: string | null = fetchRes.headers.get('Link')
      url = linkHeader ? linkHeader.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null : null
    }
    return result
  }

  const [unfulfilled, partial] = await Promise.all([
    paginate('unfulfilled'),
    paginate('partial'),
  ])

  // Deduplicate (an order can't appear in both, but be safe)
  const seen = new Set<string>()
  return [...unfulfilled, ...partial].filter((o) =>
    seen.has(o.id) ? false : (seen.add(o.id), true)
  )
}

// ─── Remaining quantities after Shopify fulfillments ─────────────────────────
// Bug 2 fix (Shopify side): for partially-shipped orders, compute which
// line-item quantities haven't been fulfilled yet.

function remainingLineItems(order: ShopifyOrder): ShopifyLineItem[] {
  const fulfilledQty = new Map<string, number>()
  for (const f of (order.fulfillments ?? [])) {
    for (const li of (f.line_items ?? [])) {
      fulfilledQty.set(li.id, (fulfilledQty.get(li.id) ?? 0) + li.quantity)
    }
  }
  return order.line_items
    .map((li) => ({ ...li, quantity: li.quantity - (fulfilledQty.get(li.id) ?? 0) }))
    .filter((li) => li.quantity > 0)
}

// ─── Variant data batch fetch ─────────────────────────────────────────────────

async function fetchVariantData(
  shop: string, token: string, variantIds: number[]
): Promise<{ stock: Map<number, number>; skus: Map<number, string> }> {
  const stock = new Map<number, number>()
  const skus  = new Map<number, string>()
  if (variantIds.length === 0) return { stock, skus }

  const chunks: number[][] = []
  for (let i = 0; i < variantIds.length; i += 250) chunks.push(variantIds.slice(i, i + 250))

  await Promise.all(chunks.map(async (chunk) => {
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/variants.json?ids=${chunk.join(',')}&fields=id,sku,inventory_quantity`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )
    if (!res.ok) return
    const { variants } = await res.json() as {
      variants?: { id: number; sku: string; inventory_quantity: number }[]
    }
    for (const v of variants ?? []) {
      stock.set(v.id, v.inventory_quantity)
      if (v.sku?.trim()) skus.set(v.id, v.sku.trim())
    }
  }))

  return { stock, skus }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // Parallel: Shopify orders + Supabase stop data
    const admin = getAdmin()
    const [allOrders, { data: assignedStops }, { data: failedStops }, { data: deliveredStops }] =
      await Promise.all([
        fetchShopifyOrders(shop, token),

        // Non-failed stops in non-cancelled tours → order is already being handled
        admin.from('delivery_stops')
          .select('order_name, delivery_tours!inner(status)')
          .neq('delivery_tours.status', 'cancelled')
          .neq('status', 'failed'),

        // Failed stops → needs replan
        admin.from('delivery_stops')
          .select('order_name')
          .eq('status', 'failed'),

        // Bug 2 fix (Supabase side): delivered stops with their panel_details so we
        // can subtract already-delivered quantities from the Shopify order total.
        // Includes stops in cancelled tours — if the driver delivered the goods,
        // the items should not reappear in "à planifier".
        admin.from('delivery_stops')
          .select('order_name, panel_details')
          .eq('status', 'delivered'),
      ])

    console.log(`[delivery/orders] Shopify: ${allOrders.length} orders fetched`)

    // Build sets for quick lookup
    const assignedOrderNames = new Set(
      (assignedStops ?? []).map((s: { order_name: string }) => s.order_name)
    )
    const replanOrderNames = new Set(
      (failedStops ?? []).map((s: { order_name: string }) => s.order_name)
    )

    // Bug 2 fix: map of order_name → { item_key → delivered_qty }
    // item_key = sku if available, else title
    const deliveredQtyMap = new Map<string, Map<string, number>>()
    for (const stop of (deliveredStops ?? [])) {
      const details = (stop.panel_details ?? []) as { sku?: string; title?: string; qty?: number }[]
      const byKey = deliveredQtyMap.get(stop.order_name) ?? new Map<string, number>()
      for (const item of details) {
        const key = item.sku?.trim() || item.title?.trim() || ''
        if (!key) continue
        byKey.set(key, (byKey.get(key) ?? 0) + (item.qty ?? 0))
      }
      deliveredQtyMap.set(stop.order_name, byKey)
    }

    // First pass: build drafts
    type OrderDraft = {
      order_name:       string
      shopify_order_id: string
      customer_name:    string
      email:            string
      created_at:       string | null
      is_preorder:      boolean
      needs_replan:     boolean
      address1:         string
      address2:         string
      city:             string
      zip:              string
      zone:             Zone
      panel_count:      number
      panel_details:    { sku: string; variant_title: string; title: string; qty: number }[]
      _variantIds:      number[]
    }

    // Bug 3 diagnostic: log the specific debug orders as soon as we see them
    const debugSeen = new Set<string>()

    const drafts: OrderDraft[] = []
    for (const order of allOrders) {
      const isDebug = DEBUG_ORDER_NAMES.has(order.name)
      if (isDebug) debugSeen.add(order.name)

      const addr          = order.shipping_address
      const customer_name = addr
        ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
        : order.email ?? ''

      // Bug 1 fix: skip internal/sample orders
      if (isInternalOrder(order.tags ?? '', customer_name, order.email ?? '')) {
        if (isDebug) console.log(`[delivery/orders] ${order.name} → SKIPPED (internal/sample) tags="${order.tags}"`)
        continue
      }

      if (assignedOrderNames.has(order.name)) {
        if (isDebug) console.log(`[delivery/orders] ${order.name} → SKIPPED (already assigned to active tour)`)
        continue
      }

      const zip  = addr?.zip ?? ''
      const zone = detectZone(zip)

      // Bug 2 fix: start from remaining (unshipped) Shopify line items
      const unfulfilled   = remainingLineItems(order)
      const panelUnfulfilled = unfulfilled.filter((li) => !isSample(li.title))

      // Bug 2 fix (Supabase): subtract quantities already delivered in Steero
      const deliveredByKey = deliveredQtyMap.get(order.name)
      const panelLineItems = panelUnfulfilled
        .map((li) => {
          const key        = li.sku?.trim() || li.title
          const alreadyQty = deliveredByKey?.get(key) ?? 0
          return { ...li, quantity: Math.max(0, li.quantity - alreadyQty) }
        })
        .filter((li) => li.quantity > 0)

      const panel_details = panelLineItems.map((li) => ({
        sku:           li.sku?.trim() ?? '',
        variant_title: li.variant_title?.trim() ?? '',
        title:         li.title,
        qty:           li.quantity,
        _variant_id:   li.variant_id,
      }))
      const panel_count = panel_details.reduce((sum, p) => sum + p.qty, 0)

      if (panel_count === 0) {
        if (isDebug) console.log(`[delivery/orders] ${order.name} → SKIPPED (panel_count=0 after subtraction)`)
        continue
      }

      // Bug 3 fix: broader preorder tag detection + logging
      const tagList   = (order.tags ?? '').split(',').map((t) => t.trim())
      const is_preorder = tagList.some((tag) =>
        /pr[eé][_\-\s]?commande|pre[_\-\s]?order|préco|preco/i.test(tag)
      )

      if (isDebug) {
        console.log(
          `[delivery/orders] ${order.name} → INCLUDED` +
          ` | tags="${order.tags}"` +
          ` | is_preorder=${is_preorder}` +
          ` | panel_count=${panel_count}` +
          ` | needs_replan=${replanOrderNames.has(order.name)}` +
          ` | fulfillments=${order.fulfillments?.length ?? 0}` +
          ` | delivered_qty_map=${deliveredByKey ? JSON.stringify(Object.fromEntries(deliveredByKey)) : 'none'}`
        )
      }

      const _variantIds = order.line_items
        .map((li) => li.variant_id)
        .filter((id): id is number => id != null && id > 0)

      drafts.push({
        order_name:       order.name,
        shopify_order_id: String(order.id),
        customer_name,
        email:            order.email ?? '',
        created_at:       order.created_at ?? null,
        is_preorder,
        needs_replan:     replanOrderNames.has(order.name),
        address1:         addr?.address1 ?? '',
        address2:         addr?.address2 ?? '',
        city:             addr?.city ?? '',
        zip,
        zone,
        panel_count,
        panel_details,
        _variantIds,
      })
    }

    // Log any debug orders that weren't found in Shopify at all
    for (const name of DEBUG_ORDER_NAMES) {
      if (!debugSeen.has(name)) {
        console.log(`[delivery/orders] ${name} → NOT FOUND in Shopify response (may be closed/fulfilled/archived)`)
      }
    }

    // Batch-fetch inventory + SKU
    const allVariantIds = [...new Set(drafts.flatMap((d) => d._variantIds))]
    const { stock: stockMap, skus: variantSkuMap } = await fetchVariantData(shop, token, allVariantIds)

    // Final response
    const orders = drafts.map(({ _variantIds, ...order }) => {
      const resolvedDetails = (order.panel_details as (typeof order.panel_details[0] & { _variant_id?: number | null })[])
        .map(({ _variant_id, ...d }) => {
          const sku = d.sku || (_variant_id ? variantSkuMap.get(_variant_id) ?? '' : '')
          return { ...d, sku }
        })

      if (!order.is_preorder) {
        return { ...order, panel_details: resolvedDetails, preorder_ready: false }
      }

      const preorderVariantIds = _variantIds.filter((id) => id > 0)
      const ready = preorderVariantIds.length === 0
        ? false
        : preorderVariantIds.every((id) => {
            const qty = stockMap.get(id)
            return qty === undefined || qty > 0
          })

      return { ...order, panel_details: resolvedDetails, preorder_ready: ready }
    })

    console.log(`[delivery/orders] Returning ${orders.length} orders (${orders.filter(o => o.is_preorder).length} preorders)`)
    return NextResponse.json({ orders })

  } catch (err) {
    console.error('[delivery/orders]', err)
    return NextResponse.json({ orders: [], error: String(err) }, { status: 500 })
  }
}
