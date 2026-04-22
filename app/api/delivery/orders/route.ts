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

interface ShopifyLineItem {
  id: string
  title: string
  variant_title: string | null
  quantity: number
  sku: string
  variant_id: number | null
}

interface ShopifyShippingAddress {
  first_name: string
  last_name: string
  address1: string
  address2: string
  city: string
  zip: string
}

interface ShopifyOrder {
  id: string
  name: string
  email: string
  created_at: string
  tags: string
  shipping_address: ShopifyShippingAddress | null
  line_items: ShopifyLineItem[]
}

// Fetch inventory_quantity AND sku for a batch of variant IDs (max 250)
async function fetchVariantData(
  shop: string,
  token: string,
  variantIds: number[]
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
    const { variants } = await res.json() as { variants?: { id: number; sku: string; inventory_quantity: number }[] }
    for (const v of variants ?? []) {
      stock.set(v.id, v.inventory_quantity)
      if (v.sku?.trim()) skus.set(v.id, v.sku.trim())
    }
  }))

  return { stock, skus }
}

export async function GET() {
  try {
    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // Fetch unfulfilled orders with pagination
    const allOrders: ShopifyOrder[] = []
    let url: string | null =
      `https://${shop}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&limit=250&fields=id,name,email,created_at,tags,shipping_address,line_items`

    while (url) {
      const fetchRes: Response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token },
      })

      if (!fetchRes.ok) throw new Error(`Shopify API error: ${fetchRes.status}`)

      const data = await fetchRes.json()
      allOrders.push(...(data.orders ?? []))

      const linkHeader: string | null = fetchRes.headers.get('Link')
      if (linkHeader) {
        const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
        url = nextMatch ? nextMatch[1] : null
      } else {
        url = null
      }
    }

    // Get already-assigned order_names from Supabase
    // A stop is "assigned" if it's in a non-cancelled tour AND its status is not 'failed'
    const admin = getAdmin()
    const [{ data: assignedStops }, { data: failedStops }] = await Promise.all([
      admin.from('delivery_stops')
        .select('order_name, delivery_tours!inner(status)')
        .neq('delivery_tours.status', 'cancelled')
        .neq('status', 'failed'),
      admin.from('delivery_stops')
        .select('order_name')
        .eq('status', 'failed'),
    ])

    const assignedOrderNames = new Set(
      (assignedStops ?? []).map((s: { order_name: string }) => s.order_name)
    )
    const replanOrderNames = new Set(
      (failedStops ?? []).map((s: { order_name: string }) => s.order_name)
    )

    const isSample = (title: string) => /échantillon|echantillon|sample/i.test(title)

    // First pass: build order objects and identify pre-orders + their variant IDs
    type OrderDraft = {
      order_name: string
      shopify_order_id: string
      customer_name: string
      email: string
      created_at: string | null
      is_preorder: boolean
      needs_replan: boolean
      address1: string
      address2: string
      city: string
      zip: string
      zone: Zone
      panel_count: number
      panel_details: { sku: string; title: string; qty: number }[]
      _variantIds: number[]  // temp, removed before response
    }

    const drafts: OrderDraft[] = []
    for (const order of allOrders) {
      if (assignedOrderNames.has(order.name)) continue

      const addr = order.shipping_address
      const customer_name = addr
        ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
        : order.email ?? ''
      const zip  = addr?.zip ?? ''
      const zone = detectZone(zip)

      const panelLineItems = order.line_items.filter((li) => !isSample(li.title))
      const panel_details = panelLineItems.map((li) => ({
        sku: li.sku?.trim() ?? '',
        variant_title: li.variant_title?.trim() ?? '',
        title: li.title,
        qty: li.quantity,
        _variant_id: li.variant_id,  // temp, for SKU resolution
      }))
      const panel_count = panel_details.reduce((sum, p) => sum + p.qty, 0)
      if (panel_count === 0) continue

      const is_preorder = /pr[eé].?(order|commande)/i.test(order.tags ?? '')
      // Collect all variant_ids (preorder check + SKU resolution for empty-SKU items)
      const _variantIds = order.line_items
        .map((li) => li.variant_id)
        .filter((id): id is number => id != null && id > 0)

      drafts.push({
        order_name: order.name,
        shopify_order_id: String(order.id),
        customer_name,
        email: order.email ?? '',
        created_at: order.created_at ?? null,
        is_preorder,
        needs_replan: replanOrderNames.has(order.name),
        address1: addr?.address1 ?? '',
        address2: addr?.address2 ?? '',
        city: addr?.city ?? '',
        zip,
        zone,
        panel_count,
        panel_details,
        _variantIds,
      })
    }

    // Batch-fetch inventory + SKU from variant catalog for all variant IDs
    const allVariantIds = [...new Set(drafts.flatMap((d) => d._variantIds))]
    const { stock: stockMap, skus: variantSkuMap } = await fetchVariantData(shop, token, allVariantIds)

    // Build final response — resolve missing SKUs from variant catalog
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

    return NextResponse.json({ orders })
  } catch (err) {
    console.error('[delivery/orders]', err)
    return NextResponse.json({ orders: [], error: String(err) }, { status: 500 })
  }
}
