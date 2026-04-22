import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = (searchParams.get('brand') ?? 'moom') as string
  const title = searchParams.get('title') ?? 'CaryExplorer'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. product_variants in DB
  const { data: variants, error: varErr } = await supabase
    .from('product_variants')
    .select('shopify_variant_id, shopify_product_id, product_title, variant_title, cost_price, sell_price')
    .eq('brand', brand)
    .ilike('product_title', `%${title}%`)

  if (varErr) return NextResponse.json({ error: varErr.message }, { status: 500 })

  // 2. products in DB
  const { data: products } = await supabase
    .from('products')
    .select('shopify_id, title, cost_price, sell_price')
    .eq('brand', brand)
    .ilike('title', `%${title}%`)

  // 3. product_sales shopify_product_id for this title
  const { data: sales } = await supabase
    .from('product_sales')
    .select('product_title, shopify_product_id')
    .eq('brand', brand)
    .ilike('product_title', `%${title}%`)
    .limit(5)

  // 4. Call Shopify inventory_items directly if variants exist
  let shopifyInventory: unknown = null
  if (variants && variants.length > 0) {
    const shopConfig = brand === 'moom'
      ? { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! }
      : brand === 'bowa'
      ? { shop: process.env.SHOPIFY_BOWA_SHOP!, token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN! }
      : { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! }

    // Fetch variant details from Shopify to get inventory_item_id
    const productId = variants[0].shopify_product_id
    if (productId) {
      try {
        const productRes = await fetch(
          `https://${shopConfig.shop}/admin/api/2024-01/products/${productId}/variants.json?fields=id,title,price,inventory_item_id`,
          { headers: { 'X-Shopify-Access-Token': shopConfig.token } }
        )
        const productData = await productRes.json() as { variants?: Array<{ id: number; title: string; price: string; inventory_item_id: number }> }
        const inventoryItemIds = (productData.variants ?? []).map((v) => v.inventory_item_id)

        if (inventoryItemIds.length > 0) {
          const invRes = await fetch(
            `https://${shopConfig.shop}/admin/api/2024-01/inventory_items.json?ids=${inventoryItemIds.join(',')}&fields=id,cost`,
            { headers: { 'X-Shopify-Access-Token': shopConfig.token } }
          )
          const invData = await invRes.json()
          shopifyInventory = {
            variants: productData.variants,
            inventory_items: (invData as { inventory_items?: unknown[] }).inventory_items,
          }
        }
      } catch (e) {
        shopifyInventory = { error: String(e) }
      }
    }
  }

  return NextResponse.json({
    search: { brand, title },
    db: {
      product_variants: variants,
      products,
      product_sales_sample: sales,
    },
    shopify_live: shopifyInventory,
  }, { status: 200 })
}
