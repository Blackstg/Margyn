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

// Fetch inventory_quantity for a batch of variant IDs (max 250)
async function fetchVariantStock(
  shop: string,
  token: string,
  variantIds: number[]
): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (variantIds.length === 0) return map

  // Shopify allows up to 250 IDs per request
  const chunks: number[][] = []
  for (let i = 0; i < variantIds.length; i += 250) {
    chunks.push(variantIds.slice(i, i + 250))
  }

  await Promise.all(chunks.map(async (chunk) => {
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/variants.json?ids=${chunk.join(',')}&fields=id,inventory_quantity`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )
    if (!res.ok) return
    const { variants } = await res.json() as { variants?: { id: number; inventory_quantity: number }[] }
    for (const v of variants ?? []) {
      map.set(v.id, v.inventory_quantity)
    }
  }))

  return map
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
    const admin = getAdmin()
    const { data: assignedStops } = await admin
      .from('delivery_stops')
      .select('order_name, delivery_tours!inner(status)')
      .neq('delivery_tours.status', 'cancelled')

    const assignedOrderNames = new Set(
      (assignedStops ?? []).map((s: { order_name: string }) => s.order_name)
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

      const panel_details = order.line_items
        .filter((li) => !isSample(li.title))
        .map((li) => ({ sku: li.sku ?? '', title: li.title, qty: li.quantity }))
      const panel_count = panel_details.reduce((sum, p) => sum + p.qty, 0)
      if (panel_count === 0) continue

      const is_preorder = /pre.?order/i.test(order.tags ?? '')
      const _variantIds = is_preorder
        ? order.line_items
            .map((li) => li.variant_id)
            .filter((id): id is number => id != null && id > 0)
        : []

      drafts.push({
        order_name: order.name,
        shopify_order_id: String(order.id),
        customer_name,
        email: order.email ?? '',
        created_at: order.created_at ?? null,
        is_preorder,
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

    // Batch-fetch inventory for all pre-order variants
    const allPreorderVariantIds = [...new Set(
      drafts.flatMap((d) => d._variantIds)
    )]
    const stockMap = await fetchVariantStock(shop, token, allPreorderVariantIds)

    // Build final response
    const orders = drafts.map(({ _variantIds, ...order }) => {
      if (!order.is_preorder) return { ...order, preorder_ready: false }

      // Ready = all variants with known stock have qty >= 0
      // Variants with no variant_id (custom items) are ignored
      const ready = _variantIds.length === 0
        ? false
        : _variantIds.every((id) => {
            const qty = stockMap.get(id)
            return qty === undefined || qty > 0  // unknown = don't block
          })

      return { ...order, preorder_ready: ready }
    })

    return NextResponse.json({ orders })
  } catch (err) {
    console.error('[delivery/orders]', err)
    return NextResponse.json({ orders: [], error: String(err) }, { status: 500 })
  }
}
