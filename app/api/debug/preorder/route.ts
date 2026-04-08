import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // Fetch first 5 open unfulfilled orders with ALL fields to inspect metadata
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/orders.json?status=open&fulfillment_status=unfulfilled&limit=10&fields=id,name,tags,note,note_attributes,line_items,created_at`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )

    if (!res.ok) {
      return NextResponse.json({ error: `Shopify ${res.status}` }, { status: 500 })
    }

    const { orders } = await res.json()

    // Find pre-orders
    const preorders = (orders ?? []).filter((o: { tags: string }) =>
      /pre.?order/i.test(o.tags ?? '')
    )

    if (preorders.length === 0) {
      return NextResponse.json({
        message: 'No pre-orders found in first 10 open unfulfilled orders',
        all_tags: (orders ?? []).map((o: { name: string; tags: string }) => ({ name: o.name, tags: o.tags })),
      })
    }

    // Return full metadata for first pre-order
    const sample = preorders[0]
    return NextResponse.json({
      order_name:       sample.name,
      tags:             sample.tags,
      note:             sample.note,
      note_attributes:  sample.note_attributes,
      created_at:       sample.created_at,
      line_items: (sample.line_items ?? []).map((li: {
        title: string
        sku: string
        properties: { name: string; value: string }[]
      }) => ({
        title:      li.title,
        sku:        li.sku,
        properties: li.properties,
      })),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
