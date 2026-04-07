import { NextRequest, NextResponse } from 'next/server'

const MOOM_SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const MOOM_TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!


async function fetchOrderShipping(orderName: string): Promise<{
  country: string
  country_code: string
  customer_paid: number
} | null> {
  const url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,shipping_address,shipping_lines`
  try {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': MOOM_TOKEN },
    })
    if (!res.ok) return null
    const { orders } = await res.json()
    const order = orders?.[0]
    if (!order) return null

    const addr          = order.shipping_address ?? {}
    const shipping_line = order.shipping_lines?.[0]

    return {
      country:       addr.country      ?? '—',
      country_code:  addr.country_code ?? '',
      customer_paid: parseFloat(shipping_line?.price ?? '0') || 0,
    }
  } catch {
    return null
  }
}

// POST { order_names: string[] }
// Returns { results: Record<string, { country, country_code }> }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const order_names: string[] = body.order_names ?? []

  if (!order_names.length) return NextResponse.json({ results: {} })

  const fetched = await Promise.all(
    order_names.map(async (name) => ({ name, data: await fetchOrderShipping(name) }))
  )

  const results: Record<string, { country: string; country_code: string }> = {}

  for (const { name, data } of fetched) {
    if (!data) continue
    results[name] = { country: data.country, country_code: data.country_code }
  }

  return NextResponse.json({ results })
}
