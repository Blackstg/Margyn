import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  fetchOrders,
  fetchProducts,
  computeMetrics,
  normalizeProducts,
  normalizeVariants,
  aggregateProductSales,
  type ShopifyConfig,
} from '@/lib/shopify'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ─── Store configs ────────────────────────────────────────────────────────────

const STORES: Record<string, ShopifyConfig> = {
  moom: {
    shop: process.env.SHOPIFY_MOOM_SHOP!,
    accessToken: process.env.SHOPIFY_MOOM_ACCESS_TOKEN!,
    brand: 'moom',
  },
  bowa: {
    shop: process.env.SHOPIFY_BOWA_SHOP!,
    accessToken: process.env.SHOPIFY_BOWA_ACCESS_TOKEN!,
    brand: 'bowa',
  },
  krom: {
    shop: process.env.SHOPIFY_KROM_SHOP!,
    accessToken: process.env.SHOPIFY_KROM_ACCESS_TOKEN!,
    brand: 'krom',
  },
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Split [from, to] into month-sized chunks so we never timeout on a single fetch
function monthChunks(from: string, to: string): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = []
  let cur = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')

  while (cur <= end) {
    const chunkFrom = cur.toISOString().slice(0, 10)
    const lastDay = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0))
    const chunkTo = (lastDay <= end ? lastDay : end).toISOString().slice(0, 10)
    chunks.push({ from: chunkFrom, to: chunkTo })
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1))
  }
  return chunks
}

// Backfill daily_snapshots + product_sales for a given brand and date range.
// Processes month by month to stay within timeout limits.
//
// Usage:
//   GET /api/admin/backfill-history?brand=moom&from=2026-01-01
//   GET /api/admin/backfill-history?brand=moom&from=2026-01-01&to=2026-03-31
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand') ?? 'moom'
  const from  = searchParams.get('from')  ?? '2026-01-01'
  const to    = searchParams.get('to')    ?? new Date().toISOString().slice(0, 10)

  const store = STORES[brand]
  if (!store) return NextResponse.json({ error: 'Unknown brand' }, { status: 400 })

  const supabase = getSupabase()

  // Load shipping rate for this brand
  let shippingRate = 0
  try {
    const { data: settings } = await supabase
      .from('brand_settings')
      .select('shipping_cost_per_order')
      .eq('brand', brand)
      .single()
    if (settings?.shipping_cost_per_order != null) shippingRate = settings.shipping_cost_per_order
  } catch { /* table may not exist */ }

  // Fetch product catalog once (same for all months)
  const products = await fetchProducts(store)

  // Upsert products + variants with current cost data (includes individual fallback)
  const [normalizedProducts, variantRows] = await Promise.all([
    normalizeProducts(store, products),
    normalizeVariants(store, products),
  ])

  if (normalizedProducts.length > 0) {
    await supabase
      .from('products')
      .upsert(
        normalizedProducts.map((p) => ({ ...p, updated_at: new Date().toISOString() })),
        { onConflict: 'shopify_id' }
      )
  }

  if (variantRows.length > 0) {
    const withCost    = variantRows.filter((v) => v.cost_price != null)
      .map((v) => ({ ...v, updated_at: new Date().toISOString() }))
    const withoutCost = variantRows.filter((v) => v.cost_price == null)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ cost_price, ...v }) => ({ ...v, updated_at: new Date().toISOString() }))

    if (withCost.length > 0) {
      await supabase.from('product_variants').upsert(withCost, { onConflict: 'shopify_variant_id' })
    }
    if (withoutCost.length > 0) {
      await supabase.from('product_variants').upsert(withoutCost, { onConflict: 'shopify_variant_id' })
    }
  }

  // Process each month chunk
  const chunks = monthChunks(from, to)
  const results: Array<{
    chunk: string
    orders: number
    snapshots: number
    product_sales: number
    error?: string
  }> = []

  for (const chunk of chunks) {
    try {
      const orders  = await fetchOrders(store, chunk.from, chunk.to)
      const metrics = await computeMetrics(store, orders, products, shippingRate)

      // Upsert daily_snapshots (overwrites existing rows for these dates)
      if (metrics.length > 0) {
        const { error } = await supabase
          .from('daily_snapshots')
          .upsert(metrics, { onConflict: 'date,brand' })
        if (error) throw new Error(`daily_snapshots: ${error.message}`)
      }

      // Replace product_sales for this date range
      const salesRows = aggregateProductSales(store, orders, products)
      let salesCount  = 0
      if (salesRows.length > 0) {
        const { error: delErr } = await supabase
          .from('product_sales')
          .delete()
          .eq('brand', brand)
          .gte('date', chunk.from)
          .lte('date', chunk.to)
        if (delErr) throw new Error(`product_sales delete: ${delErr.message}`)

        const { error: insErr } = await supabase
          .from('product_sales')
          .insert(salesRows)
        if (insErr) throw new Error(`product_sales insert: ${insErr.message}`)
        salesCount = salesRows.length
      }

      // COGS gap correction: re-apply after upsert using product_variants as ground truth
      // (Shopify batch API silently omits some costs; product_variants may have more complete data)
      try {
        const { data: dbVariants } = await supabase
          .from('product_variants')
          .select('shopify_product_id, cost_price')
          .eq('brand', brand)
          .not('cost_price', 'is', null)

        const avgCostByPid = new Map<string, number>()
        const acc = new Map<string, { sum: number; count: number }>()
        for (const v of dbVariants ?? []) {
          if (!v.shopify_product_id) continue
          const prev = acc.get(v.shopify_product_id) ?? { sum: 0, count: 0 }
          acc.set(v.shopify_product_id, { sum: prev.sum + v.cost_price, count: prev.count + 1 })
        }
        for (const [pid, { sum, count }] of acc) avgCostByPid.set(pid, sum / count)

        const { data: salesForRange } = await supabase
          .from('product_sales')
          .select('date, shopify_product_id, quantity')
          .eq('brand', brand)
          .gte('date', chunk.from)
          .lte('date', chunk.to)
          .not('shopify_product_id', 'is', null)

        const expectedByDate = new Map<string, number>()
        for (const row of salesForRange ?? []) {
          const cost = avgCostByPid.get(row.shopify_product_id!)
          if (cost == null) continue
          expectedByDate.set(row.date, (expectedByDate.get(row.date) ?? 0) + cost * row.quantity)
        }

        const { data: currentSnaps } = await supabase
          .from('daily_snapshots')
          .select('date, cogs, gross_profit')
          .eq('brand', brand)
          .gte('date', chunk.from)
          .lte('date', chunk.to)

        for (const snap of currentSnaps ?? []) {
          const expected = expectedByDate.get(snap.date) ?? 0
          const gap = Math.max(0, Math.round((expected - snap.cogs) * 100) / 100)
          if (gap > 0) {
            await supabase
              .from('daily_snapshots')
              .update({
                cogs:         Math.round((snap.cogs + gap) * 100) / 100,
                gross_profit: Math.round((snap.gross_profit - gap) * 100) / 100,
              })
              .eq('brand', brand)
              .eq('date', snap.date)
          }
        }
      } catch { /* gap correction is best-effort */ }

      results.push({
        chunk:         `${chunk.from}→${chunk.to}`,
        orders:        orders.length,
        snapshots:     metrics.length,
        product_sales: salesCount,
      })
    } catch (err) {
      results.push({
        chunk:         `${chunk.from}→${chunk.to}`,
        orders:        0,
        snapshots:     0,
        product_sales: 0,
        error:         err instanceof Error ? err.message : String(err),
      })
    }
  }

  const totalSnapshots    = results.reduce((s, r) => s + r.snapshots, 0)
  const totalProductSales = results.reduce((s, r) => s + r.product_sales, 0)
  const hasErrors         = results.some((r) => r.error)

  return NextResponse.json(
    { brand, from, to, total_snapshots: totalSnapshots, total_product_sales: totalProductSales, chunks: results },
    { status: hasErrors ? 207 : 200 }
  )
}
