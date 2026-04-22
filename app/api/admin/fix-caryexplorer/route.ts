import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// One-shot fix: write cost_price fetched live from Shopify for CaryExplorer variants.
// The cost (28.65) was confirmed via /api/debug/product-cost and the inventory_items
// endpoint called individually. The batch endpoint silently omits these items.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Fetch cost live from Shopify for this product's inventory items
  const SHOP  = process.env.SHOPIFY_MOOM_SHOP!
  const TOKEN = process.env.SHOPIFY_MOOM_ACCESS_TOKEN!
  const PRODUCT_ID = '10402307932506'

  const varRes = await fetch(
    `https://${SHOP}/admin/api/2024-01/products/${PRODUCT_ID}/variants.json?fields=id,inventory_item_id`,
    { headers: { 'X-Shopify-Access-Token': TOKEN } }
  )
  if (!varRes.ok) return NextResponse.json({ error: `Shopify variants: ${varRes.status}` }, { status: 500 })
  const { variants } = await varRes.json() as { variants: Array<{ id: number; inventory_item_id: number }> }

  // Fetch each inventory item individually (batch endpoint silently drops some)
  const results: { variantId: string; inventoryItemId: number; cost: number | null; updated: boolean }[] = []
  for (const v of variants) {
    const invRes = await fetch(
      `https://${SHOP}/admin/api/2024-01/inventory_items/${v.inventory_item_id}.json?fields=id,cost`,
      { headers: { 'X-Shopify-Access-Token': TOKEN } }
    )
    if (!invRes.ok) { results.push({ variantId: String(v.id), inventoryItemId: v.inventory_item_id, cost: null, updated: false }); continue }
    const { inventory_item } = await invRes.json() as { inventory_item: { id: number; cost?: string } }
    const cost = inventory_item.cost != null ? parseFloat(inventory_item.cost) : null
    if (cost == null) { results.push({ variantId: String(v.id), inventoryItemId: v.inventory_item_id, cost: null, updated: false }); continue }

    const { error } = await supabase
      .from('product_variants')
      .update({ cost_price: cost })
      .eq('shopify_variant_id', String(v.id))
      .eq('brand', 'moom')

    results.push({ variantId: String(v.id), inventoryItemId: v.inventory_item_id, cost, updated: !error })
  }

  // Also update products table
  const firstCost = results.find(r => r.cost != null)?.cost ?? null
  if (firstCost != null) {
    await supabase
      .from('products')
      .update({ cost_price: firstCost })
      .eq('shopify_id', PRODUCT_ID)
      .eq('brand', 'moom')
  }

  return NextResponse.json({ product_id: PRODUCT_ID, variants: results })
}
