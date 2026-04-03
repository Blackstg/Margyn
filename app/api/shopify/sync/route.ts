import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60
import {
  fetchOrders,
  fetchProducts,
  computeMetrics,
  normalizeProducts,
  normalizeVariants,
  aggregateProductSales,
  type ShopifyConfig,
} from '@/lib/shopify'

// ─── Supabase admin client (service role) ────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Store configs ────────────────────────────────────────────────────────────

const STORES: ShopifyConfig[] = [
  {
    shop: process.env.SHOPIFY_BOWA_SHOP!,
    accessToken: process.env.SHOPIFY_BOWA_ACCESS_TOKEN!,
    brand: 'bowa',
  },
  {
    shop: process.env.SHOPIFY_MOOM_SHOP!,
    accessToken: process.env.SHOPIFY_MOOM_ACCESS_TOKEN!,
    brand: 'moom',
  },
  {
    shop: process.env.SHOPIFY_KROM_SHOP!,
    accessToken: process.env.SHOPIFY_KROM_ACCESS_TOKEN!,
    brand: 'krom',
  },
]

// ─── Auth guard ───────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : header
  return token === process.env.CRON_SECRET
}

// ─── Cron entry-point (GET) ───────────────────────────────────────────────────

// Vercel cron jobs send GET requests — sync the last 48 h (yesterday + today)
export async function GET(req: NextRequest) {
  const today      = new Date()
  const twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 1)

  const url = new URL(req.url)
  url.searchParams.set('from', fmtDate(twoDaysAgo))
  url.searchParams.set('to',   fmtDate(today))

  return POST(new NextRequest(url, { headers: req.headers }))
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // date range: default to yesterday, override with ?date=YYYY-MM-DD or ?from=...&to=...
  const { searchParams } = new URL(req.url)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const dateFrom    = searchParams.get('from') ?? searchParams.get('date') ?? fmtDate(yesterday)
  const dateTo      = searchParams.get('to')   ?? searchParams.get('date') ?? fmtDate(yesterday)
  const brandFilter = searchParams.get('brand') // optional: 'bowa' | 'moom'

  const stores  = brandFilter ? STORES.filter((s) => s.brand === brandFilter) : STORES
  const supabase = getSupabase()
  const results: Record<string, { snapshots: number; products: number; product_sales?: number; error?: string }> = {}

  // Load shipping rates from brand_settings (ignore errors — table may not exist yet)
  const shippingRates: Record<string, number> = {}
  try {
    const { data: settingsRows } = await supabase
      .from('brand_settings')
      .select('brand, shipping_cost_per_order')
    for (const row of settingsRows ?? []) {
      if (row.shipping_cost_per_order > 0) shippingRates[row.brand] = row.shipping_cost_per_order
    }
  } catch { /* table not yet created — fall back to Shopify shipping */ }

  for (const store of stores) {
    try {
      // ── 1. Fetch raw data ──────────────────────────────────────────────────
      const [orders, products] = await Promise.all([
        fetchOrders(store, dateFrom, dateTo),
        fetchProducts(store),
      ])

      // ── 2. Compute metrics ─────────────────────────────────────────────────
      const shippingRate = shippingRates[store.brand] ?? 0
      const [metrics, normalizedProducts, variantRows] = await Promise.all([
        computeMetrics(store, orders, products, shippingRate),
        normalizeProducts(store, products),
        normalizeVariants(store, products),
      ])

      // ── 3. Upsert daily_snapshots ──────────────────────────────────────────
      let snapshotCount = 0
      if (metrics.length > 0) {
        const { error } = await supabase
          .from('daily_snapshots')
          .upsert(metrics, { onConflict: 'date,brand' })
        if (error) throw new Error(`daily_snapshots upsert: ${error.message}`)
        snapshotCount = metrics.length
      }

      // ── 4. Upsert products ─────────────────────────────────────────────────
      let productCount = 0
      if (normalizedProducts.length > 0) {
        const rows = normalizedProducts.map((p) => ({
          ...p,
          updated_at: new Date().toISOString(),
        }))
        const { error } = await supabase
          .from('products')
          .upsert(rows, { onConflict: 'shopify_id' })
        if (error) throw new Error(`products upsert: ${error.message}`)
        productCount = normalizedProducts.length
      }

      // ── 5. Upsert product_sales ────────────────────────────────────────────
      const productSalesRows = aggregateProductSales(store, orders, products)
      let productSalesCount = 0
      if (productSalesRows.length > 0) {
        const { error: delError } = await supabase
          .from('product_sales')
          .delete()
          .eq('brand', store.brand)
          .gte('date', dateFrom)
          .lte('date', dateTo)
        if (delError) throw new Error(`product_sales delete: ${delError.message}`)

        const { error: insError } = await supabase
          .from('product_sales')
          .insert(productSalesRows)
        if (insError) throw new Error(`product_sales insert: ${insError.message}`)
        productSalesCount = productSalesRows.length
      }

      // ── 6. Upsert product_variants ─────────────────────────────────────────
      if (variantRows.length > 0) {
        const rows = variantRows.map((v) => ({ ...v, updated_at: new Date().toISOString() }))
        const { error } = await supabase
          .from('product_variants')
          .upsert(rows, { onConflict: 'shopify_variant_id' })
        if (error) throw new Error(`product_variants upsert: ${error.message}`)
      }

      results[store.brand] = { snapshots: snapshotCount, products: productCount, product_sales: productSalesCount }
    } catch (err) {
      results[store.brand] = {
        snapshots: 0,
        products: 0,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const hasErrors = Object.values(results).some((r) => r.error)

  return NextResponse.json(
    {
      ok: !hasErrors,
      range: { from: dateFrom, to: dateTo },
      results,
    },
    { status: hasErrors ? 207 : 200 }
  )
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
