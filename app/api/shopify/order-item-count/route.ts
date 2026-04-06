import { NextRequest, NextResponse } from 'next/server'

const MOOM_SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const MOOM_TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!

async function fetchItemCount(orderName: string): Promise<number> {
  const url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,line_items`
  try {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': MOOM_TOKEN } })
    if (!res.ok) return 0
    const { orders } = await res.json()
    const order = orders?.[0]
    if (!order) return 0
    return (order.line_items ?? []).reduce(
      (s: number, li: { quantity?: number }) => s + (li.quantity ?? 1),
      0
    )
  } catch {
    return 0
  }
}

// POST { order_names: string[] }
// Returns { results: Record<string, number> }  — sum of line_item quantities per order
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const order_names: string[] = body.order_names ?? []
  if (!order_names.length) return NextResponse.json({ results: {} })

  const fetched = await Promise.all(
    order_names.map(async (name) => ({ name, count: await fetchItemCount(name) }))
  )

  const results: Record<string, number> = {}
  for (const { name, count } of fetched) {
    results[name] = count
  }

  return NextResponse.json({ results })
}
