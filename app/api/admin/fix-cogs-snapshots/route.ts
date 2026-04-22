import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Backfill daily_snapshots.cogs and gross_profit for days where product_sales
// exists and product_variants now has correct cost_price data.
//
// Uses gap approach: new_cogs = max(snap.cogs, product_variants_cogs)
// so we never double-count costs already included via the Shopify batch.
//
// Also supports title-based fallback for product_sales rows where
// shopify_product_id is null (common for historical orders whose variants
// are no longer in the current Shopify catalog).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand   = searchParams.get('brand') ?? 'moom'
  const from    = searchParams.get('from')  ?? '2026-01-01'
  const dry_run = searchParams.get('dry') !== 'false' // default: dry run

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 1. Build cost maps from product_variants (by shopify_product_id AND by product_title)
  const { data: variants } = await supabase
    .from('product_variants')
    .select('shopify_product_id, product_title, cost_price')
    .eq('brand', brand)
    .not('cost_price', 'is', null)

  // avgCost by shopify_product_id (primary key)
  const byPid = new Map<string, { sum: number; count: number }>()
  // avgCost by product_title (fallback for rows with null shopify_product_id)
  const byTitle = new Map<string, { sum: number; count: number }>()

  for (const v of variants ?? []) {
    if (v.shopify_product_id) {
      const prev = byPid.get(v.shopify_product_id) ?? { sum: 0, count: 0 }
      byPid.set(v.shopify_product_id, { sum: prev.sum + v.cost_price, count: prev.count + 1 })
    }
    if (v.product_title) {
      const prev = byTitle.get(v.product_title) ?? { sum: 0, count: 0 }
      byTitle.set(v.product_title, { sum: prev.sum + v.cost_price, count: prev.count + 1 })
    }
  }

  const avgCostByPid   = new Map<string, number>()
  const avgCostByTitle = new Map<string, number>()
  for (const [pid, { sum, count }] of byPid)     avgCostByPid.set(pid, sum / count)
  for (const [t,   { sum, count }] of byTitle)   avgCostByTitle.set(t, sum / count)

  // 2. Daily sales — fetch both pid and title columns so we can use either
  const { data: sales } = await supabase
    .from('product_sales')
    .select('date, shopify_product_id, product_title, quantity')
    .eq('brand', brand)
    .gte('date', from)

  // 3. Compute expected COGS per date (pid first, title fallback)
  const fromVariantsPerDate = new Map<string, number>()
  for (const row of sales ?? []) {
    let cost: number | undefined
    if (row.shopify_product_id) {
      cost = avgCostByPid.get(row.shopify_product_id)
    }
    // Title fallback: used when shopify_product_id is null (historical orders with deleted variants)
    if (cost == null && row.product_title && !row.product_title.startsWith('Variant ')) {
      cost = avgCostByTitle.get(row.product_title)
    }
    if (cost == null) continue
    fromVariantsPerDate.set(row.date, (fromVariantsPerDate.get(row.date) ?? 0) + cost * row.quantity)
  }

  // 4. Fetch existing snapshots for dates that have at least some expected COGS
  // Also include ALL snapshot dates in the range (even if no product_sales match)
  // so we can at least see them in the dry-run output
  const { data: allSnapshots } = await supabase
    .from('daily_snapshots')
    .select('date, cogs, gross_profit')
    .eq('brand', brand)
    .gte('date', from)
    .order('date')

  // 5. Compute corrections (gap approach: only add what's above the existing batch COGS)
  const corrections = (allSnapshots ?? []).map((snap) => {
    const fromVariants = fromVariantsPerDate.get(snap.date) ?? 0
    const gap = Math.max(0, Math.round((fromVariants - snap.cogs) * 100) / 100)
    return {
      date:             snap.date,
      old_cogs:         snap.cogs,
      from_variants:    Math.round(fromVariants * 100) / 100,
      gap,
      new_cogs:         Math.round((snap.cogs + gap) * 100) / 100,
      old_gross_profit: snap.gross_profit,
      new_gross_profit: Math.round((snap.gross_profit - gap) * 100) / 100,
    }
  }).filter((c) => c.gap > 0) // only rows that actually need a fix

  if (dry_run) {
    return NextResponse.json({ dry_run: true, brand, from, total: corrections.length, corrections })
  }

  // 6. Apply corrections
  const applied: typeof corrections = []
  for (const c of corrections) {
    const { error } = await supabase
      .from('daily_snapshots')
      .update({ cogs: c.new_cogs, gross_profit: c.new_gross_profit })
      .eq('brand', brand)
      .eq('date', c.date)
    if (!error) applied.push(c)
  }

  return NextResponse.json({ dry_run: false, brand, from, total: applied.length, applied })
}
