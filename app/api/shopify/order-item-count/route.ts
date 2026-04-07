import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

const MOOM_SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const MOOM_TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!

// Bulk fetch: return item counts for all orders in a month (2–3 API calls)
async function fetchMonthItemCounts(month: string): Promise<Record<string, number>> {
  const [year, m] = month.split('-')
  const from = `${year}-${m.padStart(2, '0')}-01T00:00:00Z`
  // First day of next month
  const nextMonth = new Date(parseInt(year), parseInt(m), 1)
  const to = nextMonth.toISOString().slice(0, 10) + 'T00:00:00Z'

  const results: Record<string, number> = {}
  let pageInfo: string | null = null
  let firstPage = true

  do {
    let url: string
    if (firstPage) {
      const params = new URLSearchParams({
        status: 'any',
        created_at_min: from,
        created_at_max: to,
        limit: '250',
        fields: 'name,line_items',
      })
      url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?${params}`
      firstPage = false
    } else {
      url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?limit=250&page_info=${pageInfo}&fields=name,line_items`
    }

    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': MOOM_TOKEN },
    })
    if (!res.ok) break

    const { orders } = await res.json() as { orders: Array<{ name: string; line_items: Array<{ quantity?: number }> }> }
    for (const order of (orders ?? [])) {
      const count = (order.line_items ?? []).reduce((s, li) => s + (li.quantity ?? 1), 0)
      results[order.name] = count
    }

    // Cursor-based pagination via Link header
    const link = res.headers.get('Link') ?? ''
    const next = link.match(/<[^>]+[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    pageInfo = next ? next[1] : null
  } while (pageInfo)

  return results
}

// Fallback: single order lookup
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

// POST { order_names: string[], month?: string }
// Returns { results: Record<string, number> }  — sum of line_item quantities per order
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const order_names: string[] = body.order_names ?? []
  const month: string         = body.month ?? ''

  if (!order_names.length) return NextResponse.json({ results: {} })

  // Preferred: bulk fetch all orders for the month (2–3 API calls)
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const bulk = await fetchMonthItemCounts(month)
    // Ensure every requested name has an entry; fall back to individual lookup only if missing
    const missing = order_names.filter(n => bulk[n] === undefined)
    if (missing.length > 0) {
      // Batch missing in groups of 5 to avoid rate limits
      for (let i = 0; i < missing.length; i += 5) {
        const batch = missing.slice(i, i + 5)
        const fetched = await Promise.all(batch.map(async n => ({ n, count: await fetchItemCount(n) })))
        for (const { n, count } of fetched) bulk[n] = count
      }
    }
    const results: Record<string, number> = {}
    for (const name of order_names) results[name] = bulk[name] ?? 0
    return NextResponse.json({ results })
  }

  // Fallback: individual lookups (legacy, no month provided)
  const fetched = await Promise.all(
    order_names.map(async (name) => ({ name, count: await fetchItemCount(name) }))
  )
  const results: Record<string, number> = {}
  for (const { name, count } of fetched) results[name] = count
  return NextResponse.json({ results })
}
