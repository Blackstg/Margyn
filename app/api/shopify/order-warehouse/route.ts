import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MOOM_SHOP  = process.env.SHOPIFY_MOOM_SHOP!
const MOOM_TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!

async function fetchOrderVariantIds(orderName: string): Promise<string[]> {
  // Shopify matches on display name — encode # as %23
  const url = `https://${MOOM_SHOP}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderName)}&status=any&fields=id,name,line_items`
  try {
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': MOOM_TOKEN },
    })
    if (!res.ok) return []
    const { orders } = await res.json()
    const order = orders?.[0]
    if (!order) return []
    return (order.line_items ?? [])
      .map((li: { variant_id: number | null }) => li.variant_id?.toString())
      .filter((id: string | undefined): id is string => Boolean(id))
  } catch {
    return []
  }
}

// POST { order_names: string[] }
// Returns { results: Record<string, 'Les deux' | 'France' | 'Chine' | null> }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const order_names: string[] = body.order_names ?? []
  if (!order_names.length) return NextResponse.json({ results: {} })

  // Fetch all orders from Shopify in parallel
  const perOrder = await Promise.all(
    order_names.map(async (name) => ({
      name,
      variantIds: await fetchOrderVariantIds(name),
    }))
  )

  // Batch DB lookup for all variant IDs at once
  const allIds = [...new Set(perOrder.flatMap(o => o.variantIds))]
  const warehouseById: Record<string, string> = {}

  if (allIds.length > 0) {
    const admin = getAdmin()
    const { data } = await admin
      .from('product_variants')
      .select('shopify_variant_id, warehouse')
      .in('shopify_variant_id', allIds)
      .eq('brand', 'moom')
      .not('warehouse', 'is', null)
    for (const v of data ?? []) {
      warehouseById[v.shopify_variant_id] = v.warehouse
    }
  }

  // Determine warehouse per order
  const results: Record<string, string | null> = {}
  for (const { name, variantIds } of perOrder) {
    if (!variantIds.length) { results[name] = null; continue }
    const warehouses = variantIds.map(id => warehouseById[id]).filter(Boolean)
    if (warehouses.includes('Les deux')) results[name] = 'Les deux'
    else results[name] = warehouses[0] ?? null
  }

  return NextResponse.json({ results })
}
