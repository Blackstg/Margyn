import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Diagnostic: how much COGS is missing from daily_snapshots due to CaryExplorer's
// cost_price not being fetched via the batch inventory_items API.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand') ?? 'moom'
  const from  = searchParams.get('from')  ?? '2026-01-01'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 1. Get variants with cost_price set — these are the ones whose COGS was missed
  //    (we just fixed CaryExplorer; find all variants that have a cost now but
  //    whose cost was never included in snapshots because of the batch API bug)
  //
  //    Proxy: find distinct product_titles where products.cost_price is set BUT
  //    the cost was only just patched (i.e., we look at product_variants).
  //    For now, focus on all variants with a cost — this shows the full picture.

  // 2. Get daily sales per product_title since `from`
  const { data: sales, error: salesErr } = await supabase
    .from('product_sales')
    .select('date, product_title, quantity, shopify_product_id')
    .eq('brand', brand)
    .gte('date', from)
    .order('date')

  if (salesErr) return NextResponse.json({ error: salesErr.message }, { status: 500 })

  // 3. Get cost_price per product from product_variants (average per shopify_product_id)
  const { data: variants } = await supabase
    .from('product_variants')
    .select('shopify_product_id, cost_price')
    .eq('brand', brand)
    .not('cost_price', 'is', null)

  const costByProduct = new Map<string, number>()
  const countByProduct = new Map<string, number>()
  for (const v of variants ?? []) {
    const prev = costByProduct.get(v.shopify_product_id) ?? 0
    const cnt  = countByProduct.get(v.shopify_product_id) ?? 0
    costByProduct.set(v.shopify_product_id, prev + v.cost_price)
    countByProduct.set(v.shopify_product_id, cnt + 1)
  }
  // Average cost per product
  const avgCost = new Map<string, number>()
  for (const [pid, total] of costByProduct.entries()) {
    avgCost.set(pid, total / (countByProduct.get(pid) ?? 1))
  }

  // 4. Get existing COGS from daily_snapshots
  const { data: snapshots } = await supabase
    .from('daily_snapshots')
    .select('date, cogs, gross_profit')
    .eq('brand', brand)
    .gte('date', from)
    .order('date')

  const snapshotMap = new Map<string, { cogs: number; gross_profit: number }>()
  for (const s of snapshots ?? []) snapshotMap.set(s.date, s)

  // 5. Compute missing COGS per day
  const byDate = new Map<string, number>()
  const byProduct: Record<string, { units: number; cost: number; missing_cogs: number }> = {}

  for (const row of sales ?? []) {
    const cost = row.shopify_product_id ? avgCost.get(row.shopify_product_id) : undefined
    if (cost == null) continue

    const missing = cost * row.quantity
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + missing)

    if (!byProduct[row.product_title]) byProduct[row.product_title] = { units: 0, cost, missing_cogs: 0 }
    byProduct[row.product_title].units       += row.quantity
    byProduct[row.product_title].missing_cogs += missing
  }

  const dailyGap = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, missing_cogs]) => {
      const snap = snapshotMap.get(date)
      return {
        date,
        cogs_in_db:    snap?.cogs ?? null,
        missing_cogs:  Math.round(missing_cogs * 100) / 100,
        corrected_cogs: snap ? Math.round((snap.cogs + missing_cogs) * 100) / 100 : null,
      }
    })

  const totalMissingCogs = dailyGap.reduce((s, r) => s + r.missing_cogs, 0)

  return NextResponse.json({
    brand,
    from,
    total_missing_cogs_eur: Math.round(totalMissingCogs * 100) / 100,
    affected_products: byProduct,
    daily_gap: dailyGap,
  })
}
