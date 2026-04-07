import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function detectZone(zip: string): 'nord' | 'sud' {
  const dept = parseInt((zip || '00').replace(/\D/g, '').slice(0, 2))
  return dept >= 1 && dept <= 59 ? 'nord' : 'sud'
}

interface ShopifyLineItem {
  id: string
  title: string
  quantity: number
  sku: string
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
  shipping_address: ShopifyShippingAddress | null
  line_items: ShopifyLineItem[]
}

export async function GET() {
  try {
    const shop = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // Fetch unfulfilled orders with pagination
    const allOrders: ShopifyOrder[] = []
    let url: string | null =
      `https://${shop}/admin/api/2024-01/orders.json?status=any&fulfillment_status=unfulfilled&limit=250&fields=id,name,email,shipping_address,line_items`

    while (url) {
      const fetchRes: Response = await fetch(url, {
        headers: { 'X-Shopify-Access-Token': token },
      })

      if (!fetchRes.ok) {
        throw new Error(`Shopify API error: ${fetchRes.status}`)
      }

      const data = await fetchRes.json()
      allOrders.push(...(data.orders ?? []))

      // Parse Link header for pagination
      const linkHeader: string | null = fetchRes.headers.get('Link')
      if (linkHeader) {
        const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
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

    // Transform and filter orders
    const orders = allOrders
      .filter((order) => !assignedOrderNames.has(order.name))
      .map((order) => {
        const addr = order.shipping_address
        const customer_name = addr
          ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
          : order.email ?? ''
        const zip = addr?.zip ?? ''
        const zone = detectZone(zip)

        const panel_details = order.line_items.map((li) => ({
          sku: li.sku ?? '',
          title: li.title,
          qty: li.quantity,
        }))
        const panel_count = panel_details.reduce((sum, p) => sum + p.qty, 0)

        return {
          order_name: order.name,
          shopify_order_id: String(order.id),
          customer_name,
          email: order.email ?? '',
          address1: addr?.address1 ?? '',
          address2: addr?.address2 ?? '',
          city: addr?.city ?? '',
          zip,
          zone,
          panel_count,
          panel_details,
        }
      })

    return NextResponse.json({ orders })
  } catch (err) {
    console.error('[delivery/orders]', err)
    return NextResponse.json({ orders: [], error: String(err) }, { status: 500 })
  }
}
