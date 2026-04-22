import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

const STORE_CONFIG: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  bowa: { shop: process.env.SHOPIFY_BOWA_SHOP!, token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

async function shopifyGet(shop: string, token: string, path: string) {
  const res = await fetch(`https://${shop}/admin/api/2024-01/${path}`, {
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`)
  return res.json()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand') ?? 'moom'
  const store = STORE_CONFIG[brand]
  if (!store) return NextResponse.json({ error: 'Unknown brand' }, { status: 400 })

  const supabase = getAdmin()

  // 1. Find all variants with cost_price = null for this brand
  const { data: nullVariants, error: fetchErr } = await supabase
    .from('product_variants')
    .select('shopify_variant_id, shopify_product_id, product_title')
    .eq('brand', brand)
    .is('cost_price', null)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!nullVariants?.length) return NextResponse.json({ message: 'No null cost_price variants found', brand })

  // 2. Group by shopify_product_id
  const byProduct = new Map<string, string[]>()
  for (const v of nullVariants) {
    if (!v.shopify_product_id) continue
    const arr = byProduct.get(v.shopify_product_id) ?? []
    arr.push(v.shopify_variant_id)
    byProduct.set(v.shopify_product_id, arr)
  }

  // 3. For each product, fetch variant inventory_item_ids from Shopify
  const inventoryItemToVariant = new Map<number, string>() // inventory_item_id → shopify_variant_id
  for (const [productId] of byProduct.entries()) {
    const data = await shopifyGet(store.shop, store.token,
      `products/${productId}/variants.json?fields=id,inventory_item_id`)
    for (const v of (data.variants ?? []) as Array<{ id: number; inventory_item_id: number }>) {
      inventoryItemToVariant.set(v.inventory_item_id, String(v.id))
    }
  }

  // 4. Batch fetch costs from inventory_items (chunks of 100)
  const inventoryItemIds = Array.from(inventoryItemToVariant.keys())
  const costMap = new Map<number, number>() // inventory_item_id → cost

  for (let i = 0; i < inventoryItemIds.length; i += 100) {
    const chunk = inventoryItemIds.slice(i, i + 100)
    const data = await shopifyGet(store.shop, store.token,
      `inventory_items.json?ids=${chunk.join(',')}&fields=id,cost`)
    for (const item of (data.inventory_items ?? []) as Array<{ id: number; cost?: string }>) {
      if (item.cost != null) costMap.set(item.id, parseFloat(item.cost))
    }
  }

  // 5. Individual fallback: re-fetch items the batch silently omitted.
  //    Rate-limited to 1 call per 500 ms to stay within Shopify's leaky-bucket.
  const missingIds = inventoryItemIds.filter((id) => !costMap.has(id))
  const individualResults: { invId: number; variantId: string; cost: number | null }[] = []

  for (const id of missingIds) {
    await sleep(500) // stay safely under the 2 req/s bucket replenishment
    try {
      const data = await shopifyGet(store.shop, store.token,
        `inventory_items/${id}.json?fields=id,cost`)
      const cost = data.inventory_item?.cost != null ? parseFloat(data.inventory_item.cost) : null
      if (cost != null) costMap.set(id, cost)
      individualResults.push({ invId: id, variantId: inventoryItemToVariant.get(id) ?? '', cost })
    } catch {
      individualResults.push({ invId: id, variantId: inventoryItemToVariant.get(id) ?? '', cost: null })
    }
  }

  // 6. Update product_variants rows that now have a cost
  let updated = 0
  const skipped: string[] = []
  for (const [invId, variantId] of inventoryItemToVariant.entries()) {
    const cost = costMap.get(invId)
    if (cost == null) { skipped.push(variantId); continue }

    const { error } = await supabase
      .from('product_variants')
      .update({ cost_price: cost })
      .eq('shopify_variant_id', variantId)
      .eq('brand', brand)

    if (!error) updated++
  }

  return NextResponse.json({
    brand,
    null_variants_found:       nullVariants.length,
    inventory_items_fetched:   inventoryItemIds.length,
    costs_found_batch:         costMap.size - individualResults.filter(r => r.cost != null).length,
    costs_found_individual:    individualResults.filter(r => r.cost != null).length,
    costs_found_total:         costMap.size,
    updated,
    skipped_no_cost:           skipped.length,
  })
}
