import { NextRequest, NextResponse } from 'next/server'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

interface ShopifyFulfillment {
  id:              number
  created_at:      string
  tracking_number: string | null
  tracking_url:    string | null
  shipment_status: string | null
}

interface ShopifyOrder {
  id:               number
  name:             string
  email:            string
  created_at:       string
  financial_status: string
  shipping_address: {
    first_name?: string
    last_name?:  string
    address1?:   string
    address2?:   string
    city?:       string
    zip?:        string
  } | null
  line_items: {
    title:         string
    variant_title: string | null
    quantity:      number
  }[]
  fulfillments: ShopifyFulfillment[]
}

function computeStep(order: ShopifyOrder): number {
  const fulfillment = order.fulfillments?.[0] ?? null

  if (!fulfillment) {
    const daysSince = (Date.now() - new Date(order.created_at).getTime()) / 86_400_000
    if (daysSince >= 2) return 2  // still processing
    return 1                      // just confirmed
  }

  const shipStatus = fulfillment.shipment_status ?? ''
  if (shipStatus === 'delivered') return 5

  if (shipStatus === 'out_for_delivery') return 4

  if (shipStatus === 'in_transit') return 4

  // Fallback: use age of fulfillment to estimate step
  const daysSinceFulfillment = (Date.now() - new Date(fulfillment.created_at).getTime()) / 86_400_000
  if (daysSinceFulfillment >= 10) return 4
  return 3  // shipped, in transit soon
}

export async function POST(
  req: NextRequest,
  { params }: { params: { brand: string } }
) {
  const { brand } = params
  const creds = SHOPIFY[brand]
  if (!creds) {
    return NextResponse.json({ error: 'Brand non supportée' }, { status: 400 })
  }

  try {
    const body = await req.json() as { email?: string; order_name?: string }
    const { email, order_name } = body

    if (!email?.trim() || !order_name?.trim()) {
      return NextResponse.json({ error: 'Email et numéro de commande requis' }, { status: 400 })
    }

    const normalizedName = order_name.trim().startsWith('#')
      ? order_name.trim()
      : `#${order_name.trim()}`

    const res = await fetch(
      `https://${creds.shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(normalizedName)}&status=any&fields=id,name,email,created_at,financial_status,shipping_address,line_items,fulfillments`,
      { headers: { 'X-Shopify-Access-Token': creds.token }, cache: 'no-store' }
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'Erreur lors de la récupération de la commande' }, { status: 500 })
    }

    const { orders } = await res.json() as { orders: ShopifyOrder[] }

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

    const fulfillment    = order.fulfillments?.[0] ?? null
    const trackingNumber = fulfillment?.tracking_number ?? null
    const addr           = order.shipping_address

    return NextResponse.json({
      order_name:      order.name,
      created_at:      order.created_at,
      email:           order.email,
      customer_name:   addr
        ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
        : email.trim(),
      products: order.line_items.map((li) => ({
        title:         li.title,
        variant_title: li.variant_title ?? null,
        qty:           li.quantity,
      })),
      address: addr
        ? {
            address1: addr.address1 ?? '',
            address2: addr.address2 ?? '',
            city:     addr.city     ?? '',
            zip:      addr.zip      ?? '',
          }
        : null,
      tracking_number: trackingNumber,
      step:            computeStep(order),
    })
  } catch (err) {
    console.error(`[tracking/${brand}]`, err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
