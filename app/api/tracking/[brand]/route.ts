import { NextRequest, NextResponse } from 'next/server'

const SHOPIFY: Record<string, { shop: string; token: string }> = {
  moom: { shop: process.env.SHOPIFY_MOOM_SHOP!, token: process.env.SHOPIFY_MOOM_ACCESS_TOKEN! },
  krom: { shop: process.env.SHOPIFY_KROM_SHOP!, token: process.env.SHOPIFY_KROM_ACCESS_TOKEN! },
}

const STATUS_LABELS: Record<string, string> = {
  label_printed:      'Étiquette créée',
  label_purchased:    'Étiquette achetée',
  confirmed:          'Expédition confirmée',
  in_transit:         'En transit',
  out_for_delivery:   'En cours de livraison',
  attempt_failure:    'Tentative de livraison échouée',
  delivered:          'Livré',
  failure:            'Incident de livraison',
  picked_up:          'Pris en charge',
  ready_for_pickup:   'Prêt à être récupéré',
}

interface ShopifyFulfillment {
  id:              number
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
  id:               number
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
  id:       number
  image?:   { src: string }
  images?:  { src: string; variant_ids: number[] }[]
  variants: { id: number }[]
}

interface FulfillmentEvent {
  status:       string
  message:      string | null
  happened_at:  string
  city:         string | null
  country:      string | null
}

function computeStep(order: ShopifyOrder): number {
  const fulfillment = order.fulfillments?.[0] ?? null
  if (!fulfillment) {
    const daysSince = (Date.now() - new Date(order.created_at).getTime()) / 86_400_000
    if (daysSince >= 2) return 2
    return 1
  }
  const s = fulfillment.shipment_status ?? ''
  if (s === 'delivered')        return 5
  if (s === 'out_for_delivery') return 4
  if (s === 'in_transit')       return 4
  const daysSince = (Date.now() - new Date(fulfillment.created_at).getTime()) / 86_400_000
  if (daysSince >= 10) return 4
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
      `https://${creds.shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(normalizedName)}&status=any&fields=id,name,email,created_at,shipping_address,line_items,fulfillments`,
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

    const fulfillment = order.fulfillments?.[0] ?? null

    // Fetch product images + fulfillment events in parallel
    const productIds = [...new Set(order.line_items.map((li) => li.product_id).filter(Boolean))]

    const [imageMap, trackingEvents] = await Promise.all([
      // Product images
      productIds.length > 0
        ? fetch(`https://${creds.shop}/admin/api/2024-01/products.json?ids=${productIds.join(',')}&fields=id,image,images,variants`, { headers, cache: 'no-store' })
            .then((r) => r.ok ? r.json() as Promise<{ products: ShopifyProduct[] }> : { products: [] })
            .then(({ products }) => {
              const map: Record<number, string> = {}
              for (const p of products) {
                const variantImageMap: Record<number, string> = {}
                for (const img of p.images ?? []) {
                  for (const vid of img.variant_ids) {
                    if (!variantImageMap[vid]) variantImageMap[vid] = img.src
                  }
                }
                for (const v of p.variants) {
                  map[v.id] = variantImageMap[v.id] ?? p.image?.src ?? ''
                }
                if (p.image?.src) map[p.id] = p.image.src
              }
              return map
            })
            .catch(() => ({} as Record<number, string>))
        : Promise.resolve({} as Record<number, string>),

      // Fulfillment events (only if fulfillment exists)
      fulfillment
        ? fetch(`https://${creds.shop}/admin/api/2024-01/orders/${order.id}/fulfillments/${fulfillment.id}/events.json`, { headers, cache: 'no-store' })
            .then((r) => r.ok ? r.json() as Promise<{ fulfillment_events: FulfillmentEvent[] }> : { fulfillment_events: [] })
            .then(({ fulfillment_events }) =>
              [...fulfillment_events]
                .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime())
                .map((e) => ({
                  label:   STATUS_LABELS[e.status] ?? e.status,
                  message: e.message ?? null,
                  date:    e.happened_at,
                  location: [e.city, e.country].filter(Boolean).join(', ') || null,
                }))
            )
            .catch(() => [])
        : Promise.resolve([]),
    ])

    const addr = order.shipping_address

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
      tracking_number: fulfillment?.tracking_number ?? null,
      tracking_events: trackingEvents,
      step:            computeStep(order),
    })
  } catch (err) {
    console.error(`[tracking/${brand}]`, err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
