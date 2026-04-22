import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// One-time admin script — raise limit to handle batched Shopify calls
export const maxDuration = 60

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface PanelDetail {
  sku: string
  variant_title?: string
  title: string
  qty: number
}

interface DeliveryStop {
  id: string
  shopify_order_id: string
  panel_details: PanelDetail[]
}

interface ShopifyLineItem {
  title: string
  sku: string
  variant_title: string | null
  quantity: number
  variant_id: number | null
  product_id: number | null
}

async function fetchShopifyOrder(shop: string, token: string, orderId: string): Promise<ShopifyLineItem[] | null> {
  const res = await fetch(
    `https://${shop}/admin/api/2024-01/orders/${orderId}.json?fields=id,line_items`,
    { headers: { 'X-Shopify-Access-Token': token } }
  )
  if (!res.ok) return null
  const data = await res.json() as { order?: { line_items: ShopifyLineItem[] } }
  return data.order?.line_items ?? null
}

// Fetch SKU by variant_id (fast, but fails if variant was deleted/recreated)
async function fetchSkusByVariantId(shop: string, token: string, variantIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  if (variantIds.length === 0) return map

  const chunks: number[][] = []
  for (let i = 0; i < variantIds.length; i += 250) chunks.push(variantIds.slice(i, i + 250))

  await Promise.all(chunks.map(async (chunk) => {
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/variants.json?ids=${chunk.join(',')}&fields=id,sku`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )
    if (!res.ok) return
    const { variants } = await res.json() as { variants?: { id: number; sku: string }[] }
    for (const v of variants ?? []) {
      if (v.sku?.trim()) map.set(v.id, v.sku.trim())
    }
  }))

  return map
}

// Fetch SKU by product_id + variant title — handles stale variant_ids
// Returns map keyed by `${product_id}::${variant_title}`
async function fetchSkusByProduct(
  shop: string,
  token: string,
  productIds: number[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (productIds.length === 0) return map

  await Promise.all(productIds.map(async (productId) => {
    const res = await fetch(
      `https://${shop}/admin/api/2024-01/products/${productId}/variants.json?fields=id,title,sku`,
      { headers: { 'X-Shopify-Access-Token': token } }
    )
    if (!res.ok) return
    const { variants } = await res.json() as { variants?: { id: number; title: string; sku: string }[] }
    for (const v of variants ?? []) {
      if (v.sku?.trim()) map.set(`${productId}::${v.title}`, v.sku.trim())
    }
  }))

  return map
}

export async function POST() {
  try {
    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!
    const admin = getAdmin()

    const { data: stops, error } = await admin
      .from('delivery_stops')
      .select('id, shopify_order_id, panel_details')
      .not('shopify_order_id', 'is', null)

    if (error) throw error

    const allStops = (stops ?? []) as DeliveryStop[]
    const needsPatch = allStops.filter((s) => s.shopify_order_id)

    if (needsPatch.length === 0) {
      return NextResponse.json({ message: 'Nothing to patch', patched: 0 })
    }

    // Fetch all Shopify orders
    const orderCache = new Map<string, ShopifyLineItem[]>()
    const uniqueOrderIds = [...new Set(needsPatch.map((s) => s.shopify_order_id))]

    let shopifyFetched = 0, shopifyFailed = 0
    for (const orderId of uniqueOrderIds) {
      const lineItems = await fetchShopifyOrder(shop, token, orderId)
      if (lineItems) { orderCache.set(orderId, lineItems); shopifyFetched++ }
      else shopifyFailed++
      await new Promise((r) => setTimeout(r, 200))
    }

    // Pass 1: try to resolve SKU by variant_id from the catalog
    const missingSkuVariantIds = new Set<number>()
    const missingSkuProductIds = new Set<number>()
    for (const lineItemsList of orderCache.values()) {
      for (const li of lineItemsList) {
        if (!li.sku?.trim()) {
          if (li.variant_id) missingSkuVariantIds.add(li.variant_id)
          if (li.product_id) missingSkuProductIds.add(li.product_id)
        }
      }
    }

    const variantSkuMap = await fetchSkusByVariantId(shop, token, [...missingSkuVariantIds])

    // Pass 2: for variant_ids not found in catalog, resolve by product_id + variant_title
    const unresolvedProductIds = new Set<number>()
    for (const lineItemsList of orderCache.values()) {
      for (const li of lineItemsList) {
        if (!li.sku?.trim() && li.variant_id && !variantSkuMap.has(li.variant_id) && li.product_id) {
          unresolvedProductIds.add(li.product_id)
        }
      }
    }

    const productVariantSkuMap = await fetchSkusByProduct(shop, token, [...unresolvedProductIds])

    // Build updated panel_details
    const updates: { id: string; panel_details: PanelDetail[] }[] = []
    let skuFromVariantId = 0, skuFromProduct = 0, skuUnresolved = 0

    for (const stop of needsPatch) {
      const lineItems = orderCache.get(stop.shopify_order_id)
      if (!lineItems) continue

      // Build lookup maps: prefer title+variant_title match, fall back to title-only
      const byExact = new Map<string, ShopifyLineItem>()
      const byTitle = new Map<string, ShopifyLineItem>()
      for (const li of lineItems) {
        const vt = li.variant_title?.trim() || ''
        byExact.set(li.title + '::' + vt, li)
        byTitle.set(li.title, li)
      }

      let changed = false
      const newDetails = (stop.panel_details ?? []).map((d) => {
        const vt = d.variant_title?.trim() || ''
        const li = (vt ? byExact.get(d.title + '::' + vt) : null) ?? byTitle.get(d.title)
        if (!li) return d

        let resolvedSku = li.sku?.trim() || ''

        if (!resolvedSku && li.variant_id) {
          const fromCatalog = variantSkuMap.get(li.variant_id)
          if (fromCatalog) { resolvedSku = fromCatalog; skuFromVariantId++ }
        }

        if (!resolvedSku && li.product_id && li.variant_title) {
          const key = `${li.product_id}::${li.variant_title.trim()}`
          const fromProduct = productVariantSkuMap.get(key)
          if (fromProduct) { resolvedSku = fromProduct; skuFromProduct++ }
        }

        if (!resolvedSku) {
          resolvedSku = d.sku || ''  // keep existing if still unresolved
          if (!resolvedSku) skuUnresolved++
        }

        const resolvedVt = li.variant_title?.trim() || d.variant_title || ''

        if (resolvedSku !== d.sku || resolvedVt !== (d.variant_title || '')) {
          changed = true
          return { ...d, sku: resolvedSku, variant_title: resolvedVt }
        }
        return d
      })

      if (changed) updates.push({ id: stop.id, panel_details: newDetails })
    }

    let patched = 0
    for (const { id, panel_details } of updates) {
      const { error: updateErr } = await admin
        .from('delivery_stops')
        .update({ panel_details })
        .eq('id', id)
      if (!updateErr) patched++
    }

    return NextResponse.json({
      message: 'Backfill complete',
      stops_checked: needsPatch.length,
      shopify_orders_fetched: shopifyFetched,
      shopify_orders_failed: shopifyFailed,
      sku_resolved_by_variant_id: skuFromVariantId,
      sku_resolved_by_product_search: skuFromProduct,
      sku_still_unresolved: skuUnresolved,
      stops_patched: patched,
    })
  } catch (err) {
    console.error('[backfill-variant-titles]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
