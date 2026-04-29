// POST /api/delivery/stops/:id/sync-shopify
// Refetches the Shopify order for this stop and updates panel_details + panel_count.
// Useful when the customer modifies their order after it was already planned.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Panel helpers (mirrors delivery/orders/route.ts) ─────────────────────────

const isSample     = (t: string) => /échantillon|echantillon|sample/i.test(t)
const isPanel      = (t: string) => /panneau/i.test(t)
const isExtPanel   = (t: string) => /extpanel|ext[_\s-]?panel/i.test(t)
const isAkupanel60 = (t: string) => /akupanel.{0,10}60/i.test(t)
const panelSlots   = (t: string, qty: number) => {
  if (isExtPanel(t))   return Math.ceil(qty / 4)
  if (isAkupanel60(t)) return Math.ceil(qty / 2)
  return qty
}

interface ShopifyLineItem {
  id:               string
  title:            string
  variant_title:    string | null
  quantity:         number
  current_quantity: number  // remaining after refunds + fulfillments — use this
  sku:              string
  variant_id:       number | null
}

interface ShopifyOrder {
  id:           string
  name:         string
  line_items:   ShopifyLineItem[]
  fulfillments: never[]  // kept for API compat but not needed
}

// current_quantity is provided by Shopify and already accounts for both
// partial fulfillments AND refunds. Using it avoids the bug where a
// refund (e.g. qty 5 → 4) was ignored because it doesn't appear in
// fulfillments[], only in refunds[].
function remainingLineItems(order: ShopifyOrder): ShopifyLineItem[] {
  return order.line_items
    .map(li => ({ ...li, quantity: li.current_quantity }))
    .filter(li => li.quantity > 0)
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = getAdmin()
    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // 1. Fetch the stop to get shopify_order_id
    const { data: stop, error: stopErr } = await admin
      .from('delivery_stops')
      .select('id, order_name, shopify_order_id, panel_details, panel_count')
      .eq('id', params.id)
      .single()

    if (stopErr || !stop) throw stopErr ?? new Error('Stop not found')
    if (!stop.shopify_order_id) {
      return NextResponse.json({ error: 'No shopify_order_id on this stop' }, { status: 400 })
    }

    // 2. Fetch the Shopify order
    const shopifyRes = await fetch(
      `https://${shop}/admin/api/2024-01/orders/${stop.shopify_order_id}.json?fields=id,name,line_items,fulfillments`,
      { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' }
    )
    if (!shopifyRes.ok) throw new Error(`Shopify ${shopifyRes.status}: ${await shopifyRes.text()}`)
    const { order } = await shopifyRes.json() as { order: ShopifyOrder }

    // 3. Recompute panel_details (remaining unfulfilled, non-sample items)
    const unfulfilled  = remainingLineItems(order)
    const panelItems   = unfulfilled.filter((li) => !isSample(li.title))

    // Fetch SKUs for variant IDs that have no inline SKU
    const variantIds = panelItems
      .map((li) => li.variant_id)
      .filter((id): id is number => id != null && id > 0 && !panelItems.find(li => li.variant_id === id)?.sku?.trim())

    const skuMap = new Map<number, string>()
    if (variantIds.length > 0) {
      const vRes = await fetch(
        `https://${shop}/admin/api/2024-01/variants.json?ids=${[...new Set(variantIds)].join(',')}&fields=id,sku`,
        { headers: { 'X-Shopify-Access-Token': token } }
      )
      if (vRes.ok) {
        const { variants } = await vRes.json() as { variants?: { id: number; sku: string }[] }
        for (const v of variants ?? []) { if (v.sku?.trim()) skuMap.set(v.id, v.sku.trim()) }
      }
    }

    const panel_details = panelItems.map((li) => ({
      sku:           li.sku?.trim() || (li.variant_id ? skuMap.get(li.variant_id) ?? '' : ''),
      variant_title: li.variant_title?.trim() ?? '',
      title:         li.title,
      qty:           li.quantity,
    }))

    const panel_count = panel_details
      .filter((p) => isPanel(p.title))
      .reduce((sum, p) => sum + panelSlots(p.title, p.qty), 0)

    // 4. Update the stop
    const { data: updated, error: updateErr } = await admin
      .from('delivery_stops')
      .update({ panel_details, panel_count })
      .eq('id', params.id)
      .select()
      .single()

    if (updateErr) throw updateErr

    const prevCount = (stop.panel_details as { qty?: number }[] ?? []).reduce((s, p) => s + (p.qty ?? 0), 0)
    const newCount  = panel_details.reduce((s, p) => s + p.qty, 0)

    return NextResponse.json({
      stop:     updated,
      changed:  prevCount !== newCount,
      prev_total_qty: prevCount,
      new_total_qty:  newCount,
    })

  } catch (err) {
    console.error('[delivery/stops/:id/sync-shopify POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
