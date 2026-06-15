// GET /api/sav-defects/order-lookup?brand=moom&order=<num>
// Récupère les articles d'une commande Shopify et les enrichit (couleur/SKU/image)
// via la table product_variants, pour la sélection du SKU concerné.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  bowa: { shop: process.env.SHOPIFY_BOWA_SHOP!, token: process.env.SHOPIFY_BOWA_ACCESS_TOKEN! },
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

interface ShopifyLineItem {
  variant_id: number | null
  title: string
  quantity: number
  sku?: string | null
  variant_title?: string | null
}

export async function GET(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get('brand') ?? 'moom'
  const raw   = (req.nextUrl.searchParams.get('order') ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'n° de commande requis' }, { status: 400 })

  const creds = SHOPIFY[brand]
  if (!creds?.shop || !creds?.token) {
    return NextResponse.json({ error: 'Marque non configurée' }, { status: 400 })
  }

  // Normalise en #1234
  const num  = raw.replace(/[^0-9]/g, '')
  const name = `#${num}`

  try {
    const url = `https://${creds.shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(name)}&status=any&fields=id,name,line_items`
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': creds.token },
      next: { revalidate: 0 },
    })
    if (!res.ok) return NextResponse.json({ error: `Shopify ${res.status}` }, { status: res.status })
    const { orders } = await res.json()
    const order = orders?.[0]
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })

    const items: ShopifyLineItem[] = order.line_items ?? []
    const variantIds = items.map(li => li.variant_id?.toString()).filter(Boolean) as string[]

    // Enrichissement catalogue (couleur / image / SKU)
    const byVariant: Record<string, { variant_title: string | null; image_url: string | null; sku: string | null; product_title: string | null }> = {}
    if (variantIds.length) {
      const admin = createAdminClient()
      const { data } = await admin
        .from('product_variants')
        .select('shopify_variant_id, product_title, variant_title, image_url, sku_fr, sku_cn')
        .in('shopify_variant_id', variantIds)
        .eq('brand', brand)
      for (const v of data ?? []) {
        byVariant[v.shopify_variant_id] = {
          variant_title: v.variant_title,
          image_url:     v.image_url,
          sku:           v.sku_fr ?? v.sku_cn ?? null,
          product_title: v.product_title,
        }
      }
    }

    const line_items = items.map(li => {
      const vid = li.variant_id?.toString() ?? ''
      const cat = byVariant[vid]
      return {
        variant_id:    vid || null,
        product_name:  cat?.product_title ?? li.title,
        variant_title: cat?.variant_title ?? li.variant_title ?? null,
        sku:           cat?.sku ?? li.sku ?? null,
        image_url:     cat?.image_url ?? null,
        quantity:      li.quantity ?? 1,
      }
    })

    return NextResponse.json({ order_name: order.name, line_items })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
