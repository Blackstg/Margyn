import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface ShopifyLineItem {
  title: string
  variant_title: string | null
  quantity: number
}

interface ShopifyShippingAddress {
  first_name: string
  last_name: string
  address1: string
  address2?: string
  city: string
  zip: string
}

interface ShopifyFulfillment {
  tracking_number: string | null
  tracking_company: string | null
}

interface ShopifyOrder {
  id: string
  name: string
  email: string
  created_at: string
  tags: string
  shipping_address: ShopifyShippingAddress | null
  line_items: ShopifyLineItem[]
  fulfillments: ShopifyFulfillment[]
}

function computeStep(
  tags: string[],
  tourStatus: string | null,
  stopStatus: string | null,
  createdAt: string
): number {
  // Steps 6–7: delivery outcome (highest priority)
  if (stopStatus === 'delivered') return 7
  if (stopStatus === 'failed' || tags.includes('avis-de-passage')) return 6

  // Steps 4–5: tour assignment / progression
  if (tourStatus === 'in_progress' || tourStatus === 'completed') return 5
  if (tourStatus && tourStatus !== 'cancelled') return 4

  // Steps 2–3: auto-progress by order age (systématique, no tag needed)
  const daysSince = (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  if (daysSince >= 2) return 4  // J+2 fully elapsed → steps 1-3 all done, waiting for tour
  if (daysSince >= 1) return 2  // J+1 elapsed → step 1 done, en préparation active
  return 1                      // same day → commande confirmée active

  return 1
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; order_name?: string }
    const { email, order_name } = body

    if (!email?.trim() || !order_name?.trim()) {
      return NextResponse.json(
        { error: 'Email et numéro de commande requis' },
        { status: 400 }
      )
    }

    const normalizedName = order_name.trim().startsWith('#')
      ? order_name.trim()
      : `#${order_name.trim()}`

    const shop  = process.env.SHOPIFY_BOWA_SHOP!
    const token = process.env.SHOPIFY_BOWA_ACCESS_TOKEN!

    // Fetch from Shopify — include fulfillments for tracking numbers
    const shopifyRes = await fetch(
      `https://${shop}/admin/api/2024-01/orders.json?name=${encodeURIComponent(normalizedName)}&status=any&fields=id,name,email,created_at,tags,shipping_address,line_items,fulfillments`,
      { headers: { 'X-Shopify-Access-Token': token }, cache: 'no-store' }
    )

    if (!shopifyRes.ok) {
      return NextResponse.json(
        { error: 'Erreur lors de la récupération de la commande' },
        { status: 500 }
      )
    }

    const { orders } = await shopifyRes.json() as { orders: ShopifyOrder[] }

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

    const tags = (order.tags ?? '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    const is_preorder = /pr[eé].?(order|commande)/i.test(order.tags ?? '')

    // Sample detection: tag "echantillon" or any product title contains "échantillon"
    const is_sample =
      tags.some((t) => /[eé]chantillon/i.test(t)) ||
      order.line_items.some((li) => /[eé]chantillon/i.test(li.title))

    // Extract first non-null tracking number from fulfillments
    const tracking_number = is_sample
      ? (order.fulfillments ?? [])
          .map((f) => f.tracking_number?.trim())
          .find((n) => !!n) ?? null
      : null

    const addr = order.shipping_address

    // Look up delivery stop + tour from Supabase (only needed for non-sample orders)
    const admin = getAdmin()

    type StopRow = {
      id: string
      status: string
      delivered_at: string | null
      delivery_tours: { id: string; status: string; planned_date: string | null; name: string } | null
    }

    const { data: stopRows } = await admin
      .from('delivery_stops')
      .select('id, status, delivered_at, delivery_tours(id, status, planned_date, name)')
      .eq('order_name', normalizedName)
      .order('created_at', { ascending: false })

    // Pick most relevant stop: delivered > active pending > failed > any
    const typedRows = (stopRows ?? []) as unknown as StopRow[]
    const delivered     = typedRows.find((s) => s.status === 'delivered')
    const activePending = typedRows.find(
      (s) => s.status === 'pending' && s.delivery_tours?.status !== 'cancelled'
    )
    const active = typedRows.find((s) => s.delivery_tours?.status !== 'cancelled')
    const best   = delivered ?? activePending ?? active ?? typedRows[0] ?? null

    const tourStatus  = best?.delivery_tours?.status       ?? null
    const tourName    = best?.delivery_tours?.name         ?? null
    const tourDate    = best?.delivery_tours?.planned_date ?? null
    const stopStatus  = best?.status                       ?? null
    const deliveredAt = best?.delivered_at                 ?? null

    const step = computeStep(tags, tourStatus, stopStatus, order.created_at)

    return NextResponse.json({
      order_name:   order.name,
      created_at:   order.created_at,
      email:        order.email,
      customer_name: addr
        ? `${addr.first_name ?? ''} ${addr.last_name ?? ''}`.trim()
        : order.email,
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
      tags,
      is_preorder,
      is_sample,
      tracking_number,
      tour_status:       tourStatus,
      tour_name:         tourName,
      tour_planned_date: tourDate,
      stop_status:       stopStatus,
      delivered_at:      deliveredAt,
      step,
    })
  } catch (err) {
    console.error('[tracking]', err)
    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    )
  }
}
