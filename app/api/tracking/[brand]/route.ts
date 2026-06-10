import { NextRequest, NextResponse } from 'next/server'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

interface ShopifyFulfillment {
  created_at:      string
  tracking_number: string | null
  shipment_status: string | null
}

interface ShopifyLineItem {
  title:         string
  variant_title: string | null
  quantity:      number
  product_id:    number | null
  variant_id:    number | null
}

interface ShopifyOrder {
  name:             string
  email:            string
  created_at:       string
  shipping_address: {
    first_name?: string
    last_name?:  string
    address1?:   string
    address2?:   string
    city?:       string
    zip?:        string
  } | null
  line_items:   ShopifyLineItem[]
  fulfillments: ShopifyFulfillment[]
}

interface ShopifyProduct {
  id:      number
  image?:  { src: string }
  images?: { src: string; variant_ids: number[] }[]
  variants: { id: number }[]
}

function computeStep(order: ShopifyOrder): number {
  const fulfillment = order.fulfillments?.[0] ?? null

  if (!fulfillment) {
    const daysSince = (Date.now() - new Date(order.created_at).getTime()) / 86_400_000
    if (daysSince >= 2) return 2
    return 1
  }

  const shipStatus = fulfillment.shipment_status ?? ''
  if (shipStatus === 'delivered')          return 5
  if (shipStatus === 'out_for_delivery')   return 4
  if (shipStatus === 'in_transit')         return 4

  const daysSinceFulfillment = (Date.now() - new Date(fulfillment.created_at).getTime()) / 86_400_000
  if (daysSinceFulfillment >= 10) return 4
  return 3
}

export async function POST(
  req: NextRequest,
  { params }: { params: { brand: string } }
) {
  const { brand } = params
  const creds = SHOPIFY[brand]
  if (!creds) return NextResponse.json({ error: 'Brand non supportée' }, { status: 400 })

  try {
    const body = await req.json() as { email?: string; order_name?: string }
    const { email, order_name } = body

    if (!email?.trim() || !order_name?.trim()) {
      return NextResponse.json({ error: 'Email et numéro de commande requis' }, { status: 400 })
    }

    const normalizedName = order_name.trim().startsWith('#')
      ? order_name.trim()
      : `#${order_name.trim()}`

    const headers = { 'X-Shopify-Access-Token': creds.token }

    // Fetch order
    const orderRes = await fetch(
      `https://${creds.shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(normalizedName)}&status=any&fields=name,email,created_at,shipping_address,line_items,fulfillments`,
      { headers, cache: 'no-store' }
    )
    if (!orderRes.ok) return NextResponse.json({ error: 'Erreur Shopify' }, { status: 500 })

    const { orders } = await orderRes.json() as { orders: ShopifyOrder[] }

    const order = orders.find(
      (o) =>
        o.name.toLowerCase() === normalizedName.toLowerCase() &&
        o.email.toLowerCase() === email.trim().toLowerCase()
    )
    if (!order) {
      return NextResponse.json(
        { error: 'Commande introuvable. Vérifiez votre email et votre numéro de commande.' },
        { status: 404 }
      )
    }

    // Fetch product images — one call with all unique product IDs
    const productIds = [...new Set(order.line_items.map((li) => li.product_id).filter(Boolean))]
    let imageMap: Record<number, string> = {}

    if (productIds.length > 0) {
      try {
        const prodRes = await fetch(
          `https://${creds.shop}/admin/api/2024-01/products.json?ids=${productIds.join(',')}&fields=id,image,images,variants`,
          { headers, cache: 'no-store' }
        )
        if (prodRes.ok) {
          const { products } = await prodRes.json() as { products: ShopifyProduct[] }
          for (const p of products) {
            // Build variant → image map first (variant-specific images)
            const variantImageMap: Record<number, string> = {}
            for (const img of p.images ?? []) {
              for (const vid of img.variant_ids) {
                if (!variantImageMap[vid]) variantImageMap[vid] = img.src
              }
            }
            // For each variant, prefer variant-specific image, fallback to product image
            for (const v of p.variants) {
              imageMap[v.id] = variantImageMap[v.id] ?? p.image?.src ?? ''
            }
            // Also store product-level fallback
            if (!imageMap[p.id] && p.image?.src) imageMap[p.id] = p.image.src
          }
        }
      } catch {
        // Images are best-effort — don't fail the whole request
      }
    }

    const fulfillment    = order.fulfillments?.[0] ?? null
    const trackingNumber = fulfillment?.tracking_number ?? null
    const addr           = order.shipping_address

    return NextResponse.json({
      order_name:    order.name,
      created_at:    order.created_at,
      customer_name: addr
        ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
        : email.trim(),
      products: order.line_items.map((li) => ({
        title:         li.title,
        variant_title: li.variant_title ?? null,
        qty:           li.quantity,
        image_url:     (li.variant_id && imageMap[li.variant_id])
                         ? imageMap[li.variant_id]
                         : (li.product_id && imageMap[li.product_id])
                           ? imageMap[li.product_id]
                           : null,
      })),
      address: addr ? {
        address1: addr.address1 ?? '',
        address2: addr.address2 ?? '',
        city:     addr.city     ?? '',
        zip:      addr.zip      ?? '',
      } : null,
      tracking_number: trackingNumber,
      step:            computeStep(order),
    })
  } catch (err) {
    console.error(`[tracking/${brand}]`, err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
